import { createHash, randomUUID } from "node:crypto";
import { acceptQuizItems, compareStoryMemories, estimateTokens, measureAuxiliaryPrompt, isScene, sceneNumbers, QUIZ_BATCH_SIZE, QUIZ_MIN_SCENES, QUIZ_MIX, QUIZ_REFILL_BELOW,
  type LeasedJob, type MemoryLanguage, type RpProfile, type QuizJobMeta, type QuizAnswerResponse, type QuizDraftItem, type QuizNextResponse, type QuizQuestion, type QuizStats } from "@rcm/shared";
import { now, type RcmDatabase } from "./db.js";

export interface QuizSceneRow {
  id: string; memory_key: string; type: string; title: string; content: string;
  story_time: string | null; locations_json: string; participants_json: string;
  landmark: number; capsule_parent_id: string | null; created_revision: number; source_ordinal: number | null;
  sourceOnly?: boolean;
}
export interface QuizMaterial {
  scenes: Array<{ ref: string; memoryId: string; rich: boolean; text: string; excerpt: string; questions: string[] }>;
  sceneCount: number;
  targetCount?: number;
}

const PROMPT_CAP = 40_000;
const INPUT_TOKEN_CAP = 10_000;
const EXCERPT_CAP = 1_200;
const PLAIN_CAP = 900;
const RICH_CAP = 3_200;

export function quizSceneRows(db: RcmDatabase, chatId: string): QuizSceneRow[] {
  const rows = db.prepare(`SELECT m.id,m.memory_key,m.type,m.title,m.content,m.story_time,m.locations_json,m.participants_json,m.landmark,m.capsule_parent_id,m.created_revision,
      (SELECT MIN(msg.ordinal) FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id) AS source_ordinal
    FROM memories m WHERE m.chat_id=? AND m.active=1`).all(chatId) as QuizSceneRow[];
  return rows.filter(isScene).sort(compareStoryMemories);
}

interface QuizStateRow {
  enabled: number; streak: number; best_streak: number; answered: number; correct: number; last_batch_scene_count: number;
}
interface QuizItemRow {
  id: string; format: QuizDraftItem["format"]; difficulty: QuizDraftItem["difficulty"]; question: string;
  options_json: string; answer_index: number; explanation: string; quote: string | null; memory_id: string;
  answered_at: number | null; chosen_index: number | null; correct: number | null;
  retry_after: number | null;
}

function sceneFingerprint(scene: Pick<QuizSceneRow, "title" | "content">): string {
  return createHash("sha256").update(JSON.stringify([scene.title, scene.content])).digest("hex");
}

// A typed source reference in the existing quiz reference column; never a memory record.
const SOURCE_REF = "source-message:";
const QUIZ_SOURCE_LAG = 2;
const QUIZ_SOURCE_REFILL_TURNS = 3;
const QUIZ_MEMORY_ONLY_SCENES = 6;

function sourceProgress(db: RcmDatabase, chatId: string): { cutoff: number | null; turns: number } {
  const replies = db.prepare(`SELECT COUNT(*) n FROM messages WHERE chat_id=? AND role='assistant'
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).get(chatId) as { n: number };
  const boundary = db.prepare(`SELECT ordinal FROM messages WHERE chat_id=? AND role='assistant'
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal DESC LIMIT 1 OFFSET ?`).get(chatId, QUIZ_SOURCE_LAG) as { ordinal: number } | undefined;
  return { cutoff: boundary?.ordinal ?? null, turns: Math.max(0, replies.n - QUIZ_SOURCE_LAG) };
}

function quizContentRows(db: RcmDatabase, chatId: string, scenes = quizSceneRows(db, chatId)): QuizSceneRow[] {
  const { cutoff } = sourceProgress(db, chatId);
  // Include old source-backed questions for validation even after the early-game window closes.
  const rows = db.prepare(`SELECT message_id,ordinal,content FROM messages WHERE chat_id=? AND content IS NOT NULL
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
    AND (message_id IN (SELECT substr(memory_id,?) FROM quiz_items WHERE chat_id=? AND memory_id LIKE 'source-message:%' AND retired_at IS NULL)
      OR (? < ? AND ordinal IN (SELECT ordinal FROM messages WHERE chat_id=? AND ordinal<=? AND role IN ('user','assistant')
        AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal DESC LIMIT 12)))
    ORDER BY ordinal`).all(chatId, SOURCE_REF.length + 1, chatId, scenes.length, QUIZ_MEMORY_ONLY_SCENES, chatId, cutoff) as Array<{ message_id: string; ordinal: number; content: string }>;
  return [...scenes, ...rows.map(row => ({ id: SOURCE_REF + row.message_id, memory_key: SOURCE_REF + row.message_id,
    type: "source", title: "Earlier conversation", content: row.content, sourceOnly: true, story_time: null,
    locations_json: "[]", participants_json: "[]", landmark: 0, capsule_parent_id: null, created_revision: 0, source_ordinal: row.ordinal }))];
}

function ensureState(db: RcmDatabase, chatId: string): void {
  db.prepare("INSERT OR IGNORE INTO quiz_state(chat_id,updated_at) VALUES(?,?)").run(chatId, now());
}

function quizState(db: RcmDatabase, chatId: string): QuizStateRow {
  return db.prepare("SELECT enabled,streak,best_streak,answered,correct,last_batch_scene_count FROM quiz_state WHERE chat_id=?").get(chatId) as QuizStateRow;
}

function quizStats(db: RcmDatabase, chatId: string): QuizStats {
  const state = quizState(db, chatId);
  return { streak: state.streak, bestStreak: state.best_streak, answered: state.answered, correct: state.correct };
}

// The answer counter includes retries. A wrong attempt at N becomes eligible at N + 3.
const ELIGIBLE_QUIZ = `retired_at IS NULL AND (answered_at IS NULL OR (correct=0 AND
  retry_after <= (SELECT answered FROM quiz_state WHERE chat_id=quiz_items.chat_id)))`;

function openQuizCount(db: RcmDatabase, chatId: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM quiz_items WHERE chat_id=? AND ${ELIGIBLE_QUIZ}`).get(chatId) as { n: number }).n;
}

function retireInvalidQuizItems(db: RcmDatabase, chatId: string, scenes: QuizSceneRow[]): void {
  db.prepare(`UPDATE quiz_items SET retired_at=? WHERE chat_id=? AND retired_at IS NULL
    AND memory_id NOT IN (SELECT value FROM json_each(?))`).run(now(), chatId, JSON.stringify(scenes.map(scene => scene.id)));
  const retireChanged = db.prepare(`UPDATE quiz_items SET retired_at=? WHERE chat_id=? AND memory_id=? AND retired_at IS NULL
    AND memory_fingerprint IS NOT NULL AND memory_fingerprint<>?`);
  for (const scene of scenes) retireChanged.run(now(), chatId, scene.id, sceneFingerprint(scene));
}

function quizGenerating(db: RcmDatabase, chatId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='quiz' AND status IN ('queued','leased') LIMIT 1").get(chatId));
}

export function setQuizEnabled(db: RcmDatabase, chatId: string, enabled: boolean): void {
  db.transaction(() => {
    ensureState(db, chatId);
    db.prepare("UPDATE quiz_state SET enabled=?,updated_at=? WHERE chat_id=?").run(enabled ? 1 : 0, now(), chatId);
    if (enabled) maybeEnqueueQuiz(db, chatId);
    else db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE chat_id=? AND type='quiz' AND status='queued'").run(now(), chatId);
  })();
}

export function disableAllQuizzes(db: RcmDatabase): void {
  db.transaction(() => {
    db.prepare("UPDATE quiz_state SET enabled=0,updated_at=?").run(now());
    db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE type='quiz' AND status='queued'").run(now());
  })();
}

export function maybeEnqueueQuiz(db: RcmDatabase, chatId: string): boolean {
  return db.transaction(() => {
    ensureState(db, chatId);
    const state = quizState(db, chatId);
    if (!state.enabled) return false;
    const scenes = quizSceneRows(db, chatId);
    const content = quizContentRows(db, chatId, scenes);
    retireInvalidQuizItems(db, chatId, content);
    const sceneCount = scenes.length;
    if ((sceneCount < QUIZ_MIN_SCENES && !content.some(row => row.sourceOnly)) || openQuizCount(db, chatId) > QUIZ_REFILL_BELOW || quizGenerating(db, chatId)) return false;
    const latest = db.prepare(`SELECT status,payload_json FROM jobs
      WHERE chat_id=? AND type='quiz' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(chatId) as { status: string; payload_json: string } | undefined;
    const progress = sourceProgress(db, chatId);
    const previous = latest ? JSON.parse(latest.payload_json) : undefined;
    if (previous && latest?.status !== "superseded") {
      const newTurns = progress.turns - (previous.sourceTurns ?? 0);
      const newScenes = sceneCount > (previous.sceneCount ?? 0);
      if (sceneCount < QUIZ_MEMORY_ONLY_SCENES && newTurns < QUIZ_SOURCE_REFILL_TURNS) return false;
      if ((latest?.status === "failed" || previous.exhausted) && !newScenes && newTurns < QUIZ_SOURCE_REFILL_TURNS) return false;
    }
    const timestamp = now();
    db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at)
      VALUES(?,?,'quiz','queued',?,0,?,?)`).run(randomUUID(), chatId, JSON.stringify({ sceneCount, sourceTurns: progress.turns }), timestamp, timestamp);
    return true;
  })();
}

/** Items have already passed the shared shape-only acceptance contract. */
export function storeQuizBatch(db: RcmDatabase, chatId: string, batchId: string, items: QuizDraftItem[], refs: Record<string, string>, sceneCount: number, fingerprints?: Record<string, string>): number {
  return db.transaction(() => {
    ensureState(db, chatId);
    const timestamp = now();
    const insert = db.prepare(`INSERT INTO quiz_items(id,chat_id,batch_id,format,difficulty,question,options_json,answer_index,explanation,quote,memory_id,memory_fingerprint,position,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const scenes = new Map(quizContentRows(db, chatId).map(scene => [scene.id, scene]));
    let accepted = 0;
    for (const [position, item] of items.entries()) {
      const scene = scenes.get(refs[item.memoryRef]!);
      if (!scene || (fingerprints?.[item.memoryRef] && fingerprints[item.memoryRef] !== sceneFingerprint(scene))) continue;
      insert.run(randomUUID(), chatId, batchId, item.format, item.difficulty, item.question, JSON.stringify(item.options),
        item.answerIndex, item.explanation, item.quote ?? null, refs[item.memoryRef], scene ? sceneFingerprint(scene) : null, position, timestamp);
      accepted++;
    }
    db.prepare("UPDATE quiz_state SET last_batch_scene_count=?,updated_at=? WHERE chat_id=?").run(sceneCount, timestamp, chatId);
    return accepted;
  })();
}

/** Drops English glosses the model adds after Korean text, e.g. "비장(spleen)" → "비장". Parentheses after names or other Latin text stay. */
export function stripQuizGlosses(item: QuizDraftItem): QuizDraftItem {
  const strip = (text: string): string => text.replace(/(?<=[가-힣])\s*\((?=[^)]*[A-Za-z])[A-Za-z0-9\s'’\-/.,]+\)/g, "");
  return { ...item, question: strip(item.question), options: item.format === "ox" ? item.options : item.options.map(strip), explanation: strip(item.explanation) };
}

export function shuffleQuizOptions(item: QuizDraftItem, random: () => number = Math.random): QuizDraftItem {
  if (item.format === "ox") return item;
  const entries = item.options.map((text, index) => ({ text, index }));
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [entries[index], entries[swapIndex]] = [entries[swapIndex]!, entries[index]!];
  }
  return { ...item, options: entries.map(entry => entry.text), answerIndex: entries.findIndex(entry => entry.index === item.answerIndex) };
}

export function nextQuiz(db: RcmDatabase, chatId: string, random: () => number = Math.random): QuizNextResponse {
  return db.transaction(() => {
    ensureState(db, chatId);
    const scenes = quizContentRows(db, chatId);
    retireInvalidQuizItems(db, chatId, scenes);
    const remaining = openQuizCount(db, chatId);
    const item = remaining ? db.prepare(`SELECT * FROM quiz_items WHERE chat_id=? AND ${ELIGIBLE_QUIZ}
      ORDER BY rowid LIMIT 1 OFFSET ?`).get(chatId, Math.floor(random() * remaining)) as QuizItemRow : undefined;
    let question: QuizQuestion | null = null;
    if (item) {
      const scene = scenes.find(scene => scene.id === item.memory_id)!;
      question = { id: item.id, attemptToken: String(item.answered_at ?? 0), retry: item.answered_at !== null, format: item.format, difficulty: item.difficulty, question: item.question,
        options: JSON.parse(item.options_json) as string[], ...(scene.story_time ? { storyTime: scene.story_time } : {}) };
    }
    if (remaining <= QUIZ_REFILL_BELOW) maybeEnqueueQuiz(db, chatId);
    const enabled = quizState(db, chatId).enabled === 1;
    return { enabled, available: enabled && question !== null,
      remaining, generating: quizGenerating(db, chatId), question, stats: quizStats(db, chatId) };
  })();
}

export function answerQuiz(db: RcmDatabase, chatId: string, itemId: string, chosenIndex: number, attemptToken: string): QuizAnswerResponse | null {
  return db.transaction(() => {
    const item = db.prepare("SELECT * FROM quiz_items WHERE chat_id=? AND id=?").get(chatId, itemId) as QuizItemRow | undefined;
    if (!item) return null;
    ensureState(db, chatId);
    retireInvalidQuizItems(db, chatId, quizContentRows(db, chatId));
    const eligible = attemptToken === String(item.answered_at ?? 0)
      && Boolean(db.prepare(`SELECT 1 FROM quiz_items WHERE id=? AND ${ELIGIBLE_QUIZ}`).get(itemId));
    if (!eligible && item.answered_at === null) return null;
    if (eligible) {
      const correct = chosenIndex === item.answer_index ? 1 : 0;
      // A persisted per-item attempt version, strictly increasing even within one millisecond.
      const timestamp = Math.max(now(), (item.answered_at ?? 0) + 1);
      const retryAfter = correct ? null : quizState(db, chatId).answered + 1 + 3;
      db.prepare("UPDATE quiz_items SET answered_at=?,chosen_index=?,correct=?,retry_after=? WHERE id=?")
        .run(timestamp, chosenIndex, correct, retryAfter, itemId);
      db.prepare(`UPDATE quiz_state SET answered=answered+1,correct=correct+?,
        streak=CASE WHEN ?=1 THEN streak+1 ELSE 0 END,
        best_streak=MAX(best_streak,CASE WHEN ?=1 THEN streak+1 ELSE 0 END),updated_at=? WHERE chat_id=?`)
        .run(correct, correct, correct, timestamp, chatId);
      item.chosen_index = chosenIndex;
      item.correct = correct;
    }
    const memory = db.prepare("SELECT id,title,story_time,locations_json FROM memories WHERE chat_id=? AND id=?")
      .get(chatId, item.memory_id) as Pick<QuizSceneRow, "id" | "title" | "story_time" | "locations_json"> | undefined;
    const sceneNumber = memory ? sceneNumbers(quizSceneRows(db, chatId)).get(memory.id) : undefined;
    const location = memory ? (JSON.parse(memory.locations_json) as string[])[0] : undefined;
    return { correct: item.correct === 1, chosenIndex: item.chosen_index!, answerIndex: item.answer_index,
      explanation: item.explanation, ...(item.quote !== null ? { quote: item.quote } : {}),
      scene: memory ? { memoryId: memory.id, title: memory.title, ...(sceneNumber !== undefined ? { sceneNumber } : {}),
        ...(memory.story_time ? { storyTime: memory.story_time } : {}), ...(location ? { location } : {}) } : null,
      stats: quizStats(db, chatId), remaining: openQuizCount(db, chatId) };
  })();
}

export function resetQuizStats(db: RcmDatabase, chatId: string): QuizStats {
  return db.transaction(() => {
    ensureState(db, chatId);
    // Rebase deadlines before clearing the counter, preserving each remaining wait.
    db.prepare("UPDATE quiz_items SET retry_after=MAX(0,retry_after-?) WHERE chat_id=? AND retry_after IS NOT NULL")
      .run(quizState(db, chatId).answered, chatId);
    db.prepare("UPDATE quiz_state SET streak=0,best_streak=0,answered=0,correct=0,updated_at=? WHERE chat_id=?").run(now(), chatId);
    return quizStats(db, chatId);
  })();
}

function orderPool(rows: QuizSceneRow[], used: Set<string>, random: () => number): QuizSceneRow[] {
  const buckets: QuizSceneRow[][] = [[], [], [], []];
  for (const row of rows) buckets[(used.has(row.id) ? 2 : 0) + (row.landmark === 1 ? 0 : 1)]!.push(row);
  for (const bucket of buckets) {
    for (let i = bucket.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j]!, bucket[i]!];
    }
  }
  return buckets.flat();
}

export function selectQuizMaterial(db: RcmDatabase, chatId: string, random: () => number = Math.random): QuizMaterial {
  const rows = quizSceneRows(db, chatId);
  const used = new Set((db.prepare("SELECT DISTINCT memory_id FROM quiz_items WHERE chat_id=?").all(chatId) as Array<{ memory_id: string }>).map(row => row.memory_id));
  const recentCount = Math.max(4, Math.ceil(rows.length * 0.2));
  const split = Math.max(0, rows.length - recentCount);
  const older = orderPool(rows.slice(0, split), used, random);
  const recent = orderPool(rows.slice(split), used, random);
  const picks = [...recent.slice(0, 4), ...older.slice(0, QUIZ_BATCH_SIZE - Math.min(4, recent.length))];
  if (picks.length < QUIZ_BATCH_SIZE) picks.push(...recent.slice(4, 4 + QUIZ_BATCH_SIZE - picks.length));
  const olderIds = new Set(older.map(row => row.id));
  const richOrder = [...picks.filter(row => olderIds.has(row.id)), ...picks.filter(row => !olderIds.has(row.id))];
  const richIds = new Set(richOrder.slice(0, QUIZ_MIX.hard).map(row => row.id));
  const scenes = picks.map((row, index) => {
    const ref = `s${index + 1}`;
    const header = takeCharacters(`[${ref}] ${row.title} — ${row.story_time ?? "시점 미상"} · ${(JSON.parse(row.locations_json) as string[]).join(", ")} · ${(JSON.parse(row.participants_json) as string[]).join(", ")}`, 240);
    const plain = takeCharacters(`${header}\n${row.content}`, PLAIN_CAP);
    const rich = richIds.has(row.id);
    const questions = (db.prepare(`SELECT question FROM quiz_items WHERE chat_id=? AND memory_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(chatId, row.id) as Array<{ question: string }>).map(item => item.question);
    return { ref, memoryId: row.id, rich, text: rich ? richText(db, chatId, row.id, plain) : plain,
      excerpt: sourceExcerpt(db, chatId, row.id, random, rows.length < QUIZ_MEMORY_ONLY_SCENES ? 6_000 : EXCERPT_CAP), questions };
  });
  if (rows.length < QUIZ_MEMORY_ONLY_SCENES) {
    const cutoff = sourceProgress(db, chatId).cutoff;
    const sources = quizContentRows(db, chatId, rows).filter(row => row.sourceOnly && cutoff !== null && row.source_ordinal! <= cutoff).slice(-12);
    for (const source of sources) {
      const ref = `s${scenes.length + 1}`;
      const questions = (db.prepare("SELECT question FROM quiz_items WHERE chat_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30")
        .all(chatId) as Array<{ question: string }>).map(row => row.question);
      scenes.push({ ref, memoryId: source.id, rich: true, text: `[${ref}] Earlier conversation · message ${source.source_ordinal! + 1}`,
        excerpt: takeCharacters(source.content, 6_000), questions });
    }
  }
  const hasBatch = Boolean(db.prepare("SELECT 1 FROM quiz_items WHERE chat_id=? LIMIT 1").get(chatId));
  return { scenes, sceneCount: rows.length, targetCount: !hasBatch && rows.length < QUIZ_MIN_SCENES ? 3 : QUIZ_BATCH_SIZE };
}

function takeCharacters(text: string, length: number): string {
  return Array.from(text).slice(0, length).join("");
}

function sourceExcerpt(db: RcmDatabase, chatId: string, memoryId: string, random: () => number, cap = EXCERPT_CAP): string {
  const messages = db.prepare(`SELECT DISTINCT msg.message_id,msg.ordinal,msg.content FROM evidence_spans e
    JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id
    WHERE e.chat_id=? AND e.memory_id=? AND msg.content IS NOT NULL
      AND msg.lifecycle IN ('committed','client_pruned') AND msg.host_visibility IN ('active','all_before')
    ORDER BY msg.ordinal`).all(chatId, memoryId) as Array<{ content: string }>;
  const source = Array.from(messages.map(row => row.content).join("\n\n"));
  if (source.length <= cap) return source.join("");
  let start = Math.floor(random() * (source.length - cap + 1));
  // Only physical message/paragraph boundaries; RP prose is never interpreted.
  const before = source.slice(Math.max(0, start - 200), start).join("");
  const boundary = before.lastIndexOf("\n\n");
  if (boundary >= 0) start -= Array.from(before.slice(boundary + 2)).length;
  const window = source.slice(start, start + cap).join("");
  const end = window.lastIndexOf("\n\n");
  return end >= window.length * 0.75 ? window.slice(0, end) : window;
}

function richText(db: RcmDatabase, chatId: string, memoryId: string, plain: string): string {
  const details = db.prepare(`SELECT text FROM memory_details WHERE chat_id=? AND memory_id=? AND active=1
    ORDER BY CASE role WHEN 'core' THEN 0 ELSE 1 END, rowid LIMIT 8`).all(chatId, memoryId) as Array<{ text: string }>;
  const dialogues = db.prepare(`SELECT speaker,text FROM memory_dialogues WHERE chat_id=? AND memory_id=? ORDER BY ordinal LIMIT 6`)
    .all(chatId, memoryId) as Array<{ speaker: string; text: string }>;
  const detailText = details.map(row => `- ${row.text}`).join("\n");
  const dialogueText = dialogues.map(row => `- ${row.speaker}: "${row.text}"`).join("\n");
  return takeCharacters(`${plain}\nDetails:\n${detailText}\nDialogue:\n${dialogueText}`, RICH_CAP);
}

export function buildQuizPrompt(material: QuizMaterial): { systemPrompt: string; userPrompt: string } {
  const target = material.targetCount ?? QUIZ_BATCH_SIZE;
  const systemPrompt = QUIZ_SYSTEM_PROMPT + `\nFor this batch, aim for ${target} items. ${target === 3 ? "This is the first short quiz: prefer easy, memorable facts." : "Aim for five easy, five medium and five hard items when the source supports that mix."} Return fewer items, even an empty items array, if the material does not support enough distinct, unambiguous questions. Do not pad the batch or repeat already asked facts with new wording. Earlier conversation entries are source passages, not stored memories; treat them as evidence for what happened or was said, not proof that every reported claim is true.`;
  const scenes = material.scenes.map(scene => ({ ...scene, history: scene.questions.join("\n") }));
  const render = () => "Scenes:\n\n" + scenes.map(scene => scene.text
    + (scene.excerpt ? `\nSource excerpt:\n${scene.excerpt}` : "")
    + (scene.history ? `\nAlready asked (ask something different):\n${scene.history}` : "")).join("\n\n");
  const fits = () => {
    const userPrompt = render();
    return userPrompt.length <= PROMPT_CAP && measureAuxiliaryPrompt([
      { role: "system", content: systemPrompt }, { role: "user", content: userPrompt },
    ], estimateTokens, { maxInputTokens: INPUT_TOKEN_CAP, maxOutputTokens: 0 }).fits;
  };
  // Trim excerpts fairly first; keep scene headers even under a tight budget.
  for (const { field, floor } of [
    { field: "excerpt", floor: 200 }, { field: "text", floor: 0 },
    { field: "history", floor: 0 }, { field: "excerpt", floor: 0 },
  ] as const) {
    while (!fits()) {
      let changed = false;
      for (const scene of scenes) {
        const minimum = field === "text" ? Array.from(scene.text.split("\n")[0]!).length : floor;
        const length = Array.from(scene[field]).length;
        const target = Math.max(minimum, Math.floor(length * 0.75));
        if (target < length) { scene[field] = takeCharacters(scene[field], target); changed = true; }
      }
      if (!changed) break;
    }
  }
  if (!fits()) throw new Error("QUIZ_PROMPT_BUDGET: scene headers exceed input budget");
  return { systemPrompt, userPrompt: render() };
}

export const QUIZ_SYSTEM_PROMPT = `You write a light, playful trivia quiz for a reader about their own roleplay story, the way a friend who loves the same show would quiz them. Use only the supplied scenes.
Tone: casual Korean 해요체 ("~였을까요?", "~는 뭐였죠?", "기억나요?"), warm and a little cheeky. Vary how questions open; do not repeat "~은 무엇인가요?".
Fun: about one third of the items carry a clear playful touch, and the rest stay plain. A playful touch is either one obviously absurd wrong option that fits the characters or an explanation that ends with a short witty aside about this particular scene. Use each joke idea once per batch. Humor never changes or invents story facts and never mocks the reader.
Names: write every person, place and title exactly in the script the scenes use; never transliterate them into Hangul.
Write every question, option and explanation in Korean; options and explanations are Korean too. Keep names, places and titles exactly as they appear in the scenes.
Dialogue in a question or an option is always translated into natural Korean, even in hard items; the original line may appear only in quote. A foreign word that is itself the subject stays as written. No parenthetical translation glosses anywhere.
All readers are adults: intimate and explicit scenes are fair game and are asked about like any other scene.
Return one JSON object: {"items":[{"format":"choice4"|"ox","difficulty":"easy"|"medium"|"hard","question":string,"options":[string],"answerIndex":integer,"explanation":string,"quote"?:string,"memoryRef":string}]}
Spread questions across the supplied material. A scene may support several questions only when they test distinct facts. For each scene, ask something different from its Already asked questions. memoryRef is the supplied ref such as "s3".
Source refs such as s1 or s3, message ordinals and input section labels are internal metadata, not story content. Use a source ref only in memoryRef; never mention these internal labels in question, options, explanation or quote.
The reader cannot see your input materials. Make every question understandable on its own by identifying the relevant situation through supported people, actions, places or events, without revealing the answer. Do not replace an internal label with an equally opaque phrase such as "scene 1" or "the supplied passage". Before returning, check all reader-facing fields for references to your input labels and rewrite them using story context.
easy: a central fact of the scene (who, where, what happened). About half of the easy items are "ox" statements; their options are ["O","X"], answerIndex 0 when the statement is true and 1 when false.
medium: a specific, memorable fact (a promise, a gift, a decision, a place).
hard: a small detail only an attentive reader remembers (a line of dialogue, an object, a number). Use scenes that include Details, Dialogue or Source excerpt. quote, when you give it, is a short line copied from that scene.
choice4 has exactly four different options. Wrong options are plausible and come from the same story where possible (other names, places, objects); in easy and medium items at most one wrong option may be a playful joke. Hard items keep all options plausible.
explanation is one or two short sentences: why the answer is right, optionally with a light comment.
Never ask about things the scenes do not state, about the future, or about the real world. Never reveal the answer in the question. Vary which position holds the correct option.`;


export function buildQuizJob(db: RcmDatabase, row: { id: string; chatId: string; profile: RpProfile; memoryLanguage: MemoryLanguage; attempt: number; payload: { sceneCount?: number } }): LeasedJob | null {
  ensureState(db, row.chatId);
  if (!quizState(db, row.chatId).enabled) return null;
  const material = selectQuizMaterial(db, row.chatId);
  if (!material.scenes.length) return null;
  const current = new Map(quizContentRows(db, row.chatId).map(scene => [scene.id, scene]));
  const quiz = { refs: Object.fromEntries(material.scenes.map(scene => [scene.ref, scene.memoryId])), sceneCount: material.sceneCount,
    targetCount: material.targetCount, fingerprints: Object.fromEntries(material.scenes.map(scene => [scene.ref, sceneFingerprint(current.get(scene.memoryId)!)])) };
  const stored = db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(row.id) as { payload_json: string };
  db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(stored.payload_json), ...quiz, sourceTurns: sourceProgress(db, row.chatId).turns }), row.id);
  const prompts = buildQuizPrompt(material);
  return { id: row.id, chatId: row.chatId, profile: row.profile, memoryLanguage: row.memoryLanguage,
    attempt: row.attempt, kind: "quiz", ...prompts, prompt: prompts.systemPrompt + "\n\n" + prompts.userPrompt,
    sourceMessageIds: [], sourceTurnCount: 0, quiz };
}

export function completeQuizJob(db: RcmDatabase, jobId: string, workerId: string, result: unknown, random: () => number = Math.random): { chatId: string; accepted: number; warnings: string[] } {
  return db.transaction(() => {
    const row = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased' AND type='quiz'")
      .get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
    if (!row) throw new Error("Lease not found");
    const payload = JSON.parse(row.payload_json) as QuizJobMeta;
    const { items, dropped } = acceptQuizItems(result, new Set(Object.keys(payload.refs)));
    const explicitEmpty = Boolean(result && typeof result === "object" && Array.isArray((result as { items?: unknown }).items) && (result as { items: unknown[] }).items.length === 0);
    if (!items.length && !explicitEmpty) throw new Error("QUIZ_EMPTY: no valid quiz items");
    const target = payload.targetCount ?? QUIZ_BATCH_SIZE;
    const accepted = storeQuizBatch(db, row.chat_id, jobId, items.slice(0, target).map(item => shuffleQuizOptions(stripQuizGlosses(item), random)), payload.refs, payload.sceneCount, payload.fingerprints);
    db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({ ...payload, exhausted: accepted < target }), jobId);
    db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?").run(now(), jobId);
    return { chatId: row.chat_id, accepted, warnings: dropped ? [`퀴즈 ${dropped}개는 형식이 맞지 않아 제외했어.`] : [] };
  })();
}
