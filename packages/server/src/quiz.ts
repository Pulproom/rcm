import { ROLEPLAY_ARCHIVE_FRAMING } from "@rcm/shared";
import { createHash, randomUUID } from "node:crypto";
import { acceptQuizItems, compareStoryMemories, estimateTokens, measureAuxiliaryPrompt, isScene, sceneNumbers, QUIZ_BATCH_SIZE, quizDateLabel, QUIZ_MIX, QUIZ_REFILL_BELOW,
  type QuizRegenerateResponse, type QuizStatus, type LeasedJob, type MemoryLanguage, type RpProfile, type QuizJobMeta, type QuizAnswerResponse, type QuizDraftItem, type QuizNextResponse, type QuizQuestion, type QuizStats } from "@rcm/shared";
import { now, type RcmDatabase } from "./db.js";
import { auxiliaryModelReady } from "./server-llm.js";

export interface QuizSceneRow {
  id: string; memory_key: string; type: string; title: string; content: string;
  story_time: string | null; locations_json: string; participants_json: string;
  landmark: number; capsule_parent_id: string | null; created_revision: number; source_ordinal: number | null;
  sourceOnly?: boolean;
  sourceMessageIds?: string[];
  context?: string;
  sourceText?: string;
  created_at?: number;
}
export interface QuizMaterial {
  scenes: Array<{ ref: string; memoryId: string; rich: boolean; text: string; excerpt: string; questions: string[]; limit?: number; sourceMessageIds?: string[] }>;
  sceneCount: number;
  targetCount?: number;
}

const PROMPT_CAP = 40_000;
const INPUT_TOKEN_CAP = 10_000;
const EXCERPT_CAP = 1_200;
const PLAIN_CAP = 900;
const RICH_CAP = 3_200;

export function quizSceneRows(db: RcmDatabase, chatId: string): QuizSceneRow[] {
  const rows = db.prepare(`SELECT m.id,m.memory_key,m.type,m.title,m.content,m.story_time,m.locations_json,m.participants_json,m.landmark,m.capsule_parent_id,m.created_revision,m.created_at,
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

/** Capture before a source-guarded episode regeneration, never during an ordinary edit. */
export function snapshotRegenerationQuizzes(db: RcmDatabase, chatId: string, memoryIds: string[]) {
  const selected = new Set(memoryIds);
  return quizSceneRows(db, chatId).filter(scene => selected.has(scene.id)).map(scene => {
    const sources = db.prepare(`SELECT DISTINCT msg.message_id,
        CASE WHEN msg.canonical_hash<>'' THEN msg.canonical_hash ELSE msg.content_hash END hash
      FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id
      WHERE e.chat_id=? AND e.memory_id=? AND msg.content IS NOT NULL
        AND msg.lifecycle IN ('committed','client_pruned') AND msg.host_visibility IN ('active','all_before')
      ORDER BY msg.message_id`).all(chatId, scene.id);
    return { id: scene.id, fingerprint: sceneFingerprint(scene), sources: sources.length ? JSON.stringify(sources) : null };
  });
}

export function preserveRegenerationQuizzes(db: RcmDatabase, chatId: string, before: ReturnType<typeof snapshotRegenerationQuizzes>): void {
  const after = new Map(snapshotRegenerationQuizzes(db, chatId, before.map(row => row.id)).map(row => [row.id, row]));
  const update = db.prepare(`UPDATE quiz_items SET memory_fingerprint=? WHERE chat_id=? AND memory_id=?
    AND retired_at IS NULL AND memory_fingerprint=?`);
  for (const prior of before) {
    const current = after.get(prior.id);
    if (prior.sources && current?.sources === prior.sources) update.run(current.fingerprint, chatId, prior.id, prior.fingerprint);
  }
}

// A typed source reference in the existing quiz reference column; never a memory record.
const SOURCE_REF = "source-chunk:";
const QUIZ_SOURCE_LAG = 2;
const QUIZ_SOURCE_REFILL_TURNS = 3;
const QUIZ_MEMORY_ONLY_SCENES = 6;

/** No boundary means no approved source range, never permission to consume history. */
function quizSourceBoundary(db: RcmDatabase, chatId: string): number {
  const chat = db.prepare("SELECT ingestion_state FROM chats WHERE id=?").get(chatId) as { ingestion_state: string } | undefined;
  if (chat?.ingestion_state !== "historical_pending") return -1;
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(`quiz_history_boundary:${chatId}`) as { value: string } | undefined;
  return row && Number.isSafeInteger(Number(row.value)) ? Number(row.value) : Number.MAX_SAFE_INTEGER;
}

function sourceProgress(db: RcmDatabase, chatId: string): { cutoff: number | null; turns: number } {
  const floor = quizSourceBoundary(db, chatId);
  const replies = db.prepare(`SELECT COUNT(*) n FROM messages WHERE chat_id=? AND role='assistant'
    AND ordinal>? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).get(chatId, floor) as { n: number };
  const boundary = db.prepare(`SELECT ordinal FROM messages WHERE chat_id=? AND role='assistant'
    AND ordinal>? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal DESC LIMIT 1 OFFSET ?`).get(chatId, floor, QUIZ_SOURCE_LAG) as { ordinal: number } | undefined;
  return { cutoff: boundary?.ordinal ?? null, turns: Math.max(0, replies.n - QUIZ_SOURCE_LAG) };
}

function quizContentRows(db: RcmDatabase, chatId: string, scenes = quizSceneRows(db, chatId)): QuizSceneRow[] {
  if (scenes.length >= QUIZ_MEMORY_ONLY_SCENES && !db.prepare("SELECT 1 FROM quiz_items WHERE chat_id=? AND memory_id LIKE 'source-chunk:%' AND retired_at IS NULL LIMIT 1").get(chatId)) return scenes;
  const { cutoff } = sourceProgress(db, chatId);
  const rows = db.prepare(`SELECT message_id,role,ordinal,content,updated_at,memory_excluded FROM messages WHERE chat_id=?
    AND ordinal>? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal`)
    .all(chatId, quizSourceBoundary(db, chatId)) as Array<{message_id:string;role:string;ordinal:number;content:string|null;updated_at:number;memory_excluded:number}>;
  const chunks: QuizSceneRow[] = [];
  let previousExchange = "";
  let previousExchangeIds: string[] = [];
  for (let index = 1; index < rows.length; index++) {
    const reply = rows[index]!, user = rows[index - 1]!;
    if (reply.memory_excluded || user.memory_excluded || reply.role !== "assistant" || user.role !== "user" || reply.content === null || user.content === null
      || cutoff === null || reply.ordinal > cutoff) continue;
    const nearest = scenes.filter(scene => scene.source_ordinal !== null && scene.source_ordinal <= user.ordinal)
      .sort((a,b) => b.source_ordinal! - a.source_ordinal!)[0];
    const context = [nearest ? "Nearest stored scene (context only): " + [nearest.story_time, ...JSON.parse(nearest.locations_json), ...JSON.parse(nearest.participants_json)].filter(Boolean).join(" · ") : "",
      previousExchange].filter(Boolean).join("\n");
    chunks.push({ id: SOURCE_REF + reply.message_id, memory_key: SOURCE_REF + reply.message_id, type: "source",
      title: "Earlier exchange", content: "User:\n" + user.content + "\nAssistant:\n" + reply.content,
      context, sourceText: "User:\n" + takeCharacters(user.content, 3000) + "\nAssistant:\n" + takeCharacters(reply.content, 3000), sourceOnly: true, story_time: null, locations_json: "[]", participants_json: "[]", landmark: 0,
      sourceMessageIds: [...previousExchangeIds, user.message_id, reply.message_id],
      capsule_parent_id: null, created_revision: 0, created_at: reply.updated_at, source_ordinal: reply.ordinal });
    previousExchange = "Preceding exchange — User:\n" + takeCharacters(user.content, 600) + "\nAssistant:\n" + takeCharacters(reply.content, 600);
    previousExchangeIds = [user.message_id, reply.message_id];
  }
  // Keep complete source units available for validation after switching to memories.
  return [...scenes, ...chunks];
}

export interface QuizUnit { row: QuizSceneRow; quota: number; remaining: number; weight: number }

/** Retired unanswered questions release quota; answered history always counts. */
export function quizUnits(db: RcmDatabase, chatId: string): QuizUnit[] {
  const scenes = quizSceneRows(db, chatId);
  const progress = sourceProgress(db, chatId);
  const replies = db.prepare(`SELECT ordinal,updated_at FROM messages WHERE chat_id=? AND role='assistant'
    AND ordinal>? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal`)
    .all(chatId, quizSourceBoundary(db, chatId)) as Array<{ordinal:number;updated_at:number}>;
  const atTime = (time: number) => Math.max(0, replies.filter(reply => reply.updated_at <= time).length - QUIZ_SOURCE_LAG);
  const history = db.prepare(`SELECT q.memory_id,q.batch_id,q.created_at,json_extract(j.payload_json,'$.sourceTurns') source_turns
    FROM quiz_items q LEFT JOIN jobs j ON j.id=q.batch_id AND j.chat_id=q.chat_id
    WHERE q.chat_id=? AND (q.retired_at IS NULL OR q.answered_at IS NOT NULL) ORDER BY q.created_at,q.rowid`).all(chatId) as Array<{memory_id:string;batch_id:string;created_at:number;source_turns:number|null}>;
  const previousBatch = history.at(-1)?.batch_id;
  const details = db.prepare("SELECT memory_id,COUNT(*) n FROM memory_details WHERE chat_id=? AND active=1 GROUP BY memory_id")
    .all(chatId) as Array<{memory_id:string;n:number}>;
  const sizes = db.prepare(`SELECT memory_id,SUM(chars) n FROM (
    SELECT DISTINCT e.memory_id,msg.message_id,length(msg.content) chars FROM evidence_spans e
    JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id
    WHERE e.chat_id=? AND msg.content IS NOT NULL AND msg.lifecycle IN ('committed','client_pruned')
      AND msg.host_visibility IN ('active','all_before')) GROUP BY memory_id`).all(chatId) as Array<{memory_id:string;n:number}>;
  const detailCounts = new Map(details.map(row => [row.memory_id,row.n]));
  const sourceSizes = new Map(sizes.map(row => [row.memory_id,row.n]));
  return quizContentRows(db, chatId, scenes).filter(row => scenes.length < QUIZ_MEMORY_ONLY_SCENES ? row.sourceOnly : !row.sourceOnly).map(row => {
    const quota = row.sourceOnly ? 2 : Math.max(3, Math.min(8, (detailCounts.get(row.id) ?? 0) + Math.ceil((sourceSizes.get(row.id) ?? 0) / 4000)));
    const asked = history.filter(item => item.memory_id === row.id);
    let used = 0, lastTurn: number | undefined;
    for (const item of asked) {
      const turn = item.source_turns ?? atTime(item.created_at);
      if (used >= quota && lastTurn !== undefined && turn - lastTurn >= 30) used = 0;
      used++; lastTurn = turn;
    }
    const elapsed = lastTurn === undefined ? 0 : Math.max(0, progress.turns - lastTurn);
    if (used >= quota && elapsed >= 30) used = 0;
    const createdTurn = atTime(row.created_at ?? 0);
    const weight = (asked.length ? 1 : 1.5) * (progress.turns - createdTurn <= 10 ? 1.5 : 1)
      * (1 + Math.min(1, elapsed / 60)) * (asked.some(item => item.batch_id === previousBatch) ? .3 : 1);
    return { row, quota, remaining: Math.max(0, quota - used), weight };
  });
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

function enqueueQuiz(db: RcmDatabase, chatId: string, sceneCount: number): void {
  const timestamp = now();
  db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at)
    VALUES(?,?,'quiz','queued',?,0,?,?)`).run(randomUUID(), chatId, JSON.stringify({ sceneCount, sourceTurns: sourceProgress(db, chatId).turns }), timestamp, timestamp);
}

export function quizStatus(db: RcmDatabase, chatId: string): QuizStatus {
  return { unanswered: (db.prepare("SELECT COUNT(*) n FROM quiz_items WHERE chat_id=? AND retired_at IS NULL AND answered_at IS NULL").get(chatId) as { n: number }).n,
    generating: quizGenerating(db, chatId) };
}

/** Explicit replacement never cancels an in-flight model call. Retry after the existing job finishes. */
export function regenerateQuizzes(db: RcmDatabase, chatId: string): QuizRegenerateResponse {
  return db.transaction((): QuizRegenerateResponse => {
    if (!auxiliaryModelReady(db)) return { retired: 0, enqueued: false, reason: "model_not_configured" };
    if (quizGenerating(db, chatId)) return { retired: 0, enqueued: false, reason: "generating" };
    ensureState(db, chatId);
    if (!quizState(db, chatId).enabled) return { retired: 0, enqueued: false, reason: "disabled" };
    const retired = db.prepare("UPDATE quiz_items SET retired_at=? WHERE chat_id=? AND retired_at IS NULL AND answered_at IS NULL").run(now(), chatId).changes;
    if (!quizUnits(db, chatId).some(unit => unit.remaining > 0)) return { retired, enqueued: false, reason: "no_material" };
    enqueueQuiz(db, chatId, quizSceneRows(db, chatId).length);
    return { retired, enqueued: true };
  })();
}

export function maybeEnqueueQuiz(db: RcmDatabase, chatId: string): boolean {
  return db.transaction(() => {
    if (!auxiliaryModelReady(db)) return false;
    ensureState(db, chatId);
    const state = quizState(db, chatId);
    if (!state.enabled) return false;
    const scenes = quizSceneRows(db, chatId);
    const content = quizContentRows(db, chatId, scenes);
    retireInvalidQuizItems(db, chatId, content);
    const sceneCount = scenes.length;
    const open = (db.prepare("SELECT COUNT(*) n FROM quiz_items WHERE chat_id=? AND retired_at IS NULL AND answered_at IS NULL").get(chatId) as {n:number}).n;
    const available = Math.min(QUIZ_BATCH_SIZE, quizUnits(db, chatId).reduce((sum, unit) => sum + unit.remaining, 0));
    if (open > QUIZ_REFILL_BELOW || quizGenerating(db, chatId) || available < (open === 0 ? 1 : 3)) return false;
    const latest = db.prepare(`SELECT status,payload_json FROM jobs
      WHERE chat_id=? AND type='quiz' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(chatId) as { status: string; payload_json: string } | undefined;
    const progress = sourceProgress(db, chatId);
    const previous = latest ? JSON.parse(latest.payload_json) : undefined;
    if (previous && latest?.status !== "superseded") {
      const newTurns = progress.turns - (previous.sourceTurns ?? 0);
      const newScenes = sceneCount > (previous.sceneCount ?? 0);
      if ((latest?.status === "failed" || previous.exhausted) && !newScenes && newTurns < QUIZ_SOURCE_REFILL_TURNS) return false;
    }
    enqueueQuiz(db, chatId, sceneCount);
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
  if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) return {
    enabled: true, available: false, remaining: 0, generating: false, question: null,
    stats: { streak: 0, bestStreak: 0, answered: 0, correct: 0 }, waitingReason: "conversation_too_short",
  };
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
    maybeEnqueueQuiz(db, chatId);
    const enabled = quizState(db, chatId).enabled === 1;
    const ready = auxiliaryModelReady(db);
    const generating = ready && Boolean(db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='quiz' AND status='leased'").get(chatId));
    const waitingReason = !enabled || question ? undefined : !ready ? "model_not_configured" as const
      : !quizUnits(db, chatId).length ? "conversation_too_short" as const
        : !quizGenerating(db, chatId) ? "material_exhausted" as const : undefined;
    return { enabled, available: enabled && question !== null,
      remaining, generating, question, stats: quizStats(db, chatId), ...(waitingReason ? { waitingReason } : {}) };
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

export function selectQuizMaterial(db: RcmDatabase, chatId: string, random: () => number = Math.random): QuizMaterial {
  const rows = quizSceneRows(db, chatId);
  const units = quizUnits(db, chatId).filter(unit => unit.remaining > 0);
  const picks: Array<{unit: QuizUnit; limit: number}> = [];
  const slots = Math.min(QUIZ_BATCH_SIZE, units.reduce((sum, unit) => sum + Math.min(2, unit.remaining), 0));
  for (let count = 0; count < slots; count++) {
    const eligible = units.filter(unit => (picks.find(pick => pick.unit === unit)?.limit ?? 0) < Math.min(2, unit.remaining));
    let roll = random() * eligible.reduce((sum, unit) => sum + unit.weight, 0);
    const unit = eligible.find(unit => (roll -= unit.weight) < 0) ?? eligible.at(-1)!;
    const pick = picks.find(pick => pick.unit === unit);
    if (pick) pick.limit++; else picks.push({ unit, limit: 1 });
  }
  const scenes = picks.map(({unit, limit}, index) => {
    const row = unit.row, ref = `s${index + 1}`;
    const questions = (db.prepare(`SELECT question FROM quiz_items WHERE chat_id=? AND memory_id=? AND (retired_at IS NULL OR answered_at IS NOT NULL)
      ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(chatId, row.id) as Array<{question:string}>).map(item => item.question);
    if (row.sourceOnly) return { ref, memoryId: row.id, rich: true, limit, questions, sourceMessageIds: row.sourceMessageIds,
      text: `[${ref}] Earlier exchange (reader sees no scene label; quiz subject: Source excerpt only; maximum ${limit} questions)
Context only, not a quiz subject:
${takeCharacters(row.context ?? "No preceding exchange available.", 1600)}
Quiz subject: the following user input and assistant reply only.`,
      excerpt: row.sourceText! };
    const label = quizDateLabel(row.story_time ?? undefined);
    const header = takeCharacters(`[${ref}] ${row.title} (reader sees: ${label || "no date label"}; maximum ${limit} questions) — Place: ${(JSON.parse(row.locations_json) as string[]).join(", ")} · Participants: ${(JSON.parse(row.participants_json) as string[]).join(", ")}`, 360);
    const plain = takeCharacters(header + "\n" + row.content, PLAIN_CAP);
    const rich = index < QUIZ_MIX.hard;
    return { ref, memoryId: row.id, rich, limit, questions, sourceMessageIds: quizMemorySourceIds(db, chatId, row.id), text: rich ? richText(db, chatId, row.id, plain) : plain,
      excerpt: sourceExcerpt(db, chatId, row.id, random) };
  });
  return { scenes, sceneCount: rows.length, targetCount: slots };
}

function takeCharacters(text: string, length: number): string {
  return Array.from(text).slice(0, length).join("");
}

function quizMemorySourceIds(db: RcmDatabase, chatId: string, memoryId: string): string[] {
  return (db.prepare(`SELECT message_id id FROM evidence_spans WHERE chat_id=? AND memory_id=?
    UNION SELECT json_extract(e.value,'$.messageId') FROM memories m,json_each(m.evidence_json) e WHERE m.chat_id=? AND m.id=?
    UNION SELECT json_extract(e.value,'$.messageId') FROM memory_details d,json_each(d.evidence_json) e WHERE d.chat_id=? AND d.memory_id=? AND d.active=1
    UNION SELECT message_id FROM memory_dialogues WHERE chat_id=? AND memory_id=?
    UNION SELECT json_extract(e.value,'$.messageId') FROM memory_dialogues d,json_each(d.evidence_json) e WHERE d.chat_id=? AND d.memory_id=?`)
    .all(...Array.from({length:5},()=>[chatId,memoryId]).flat()) as Array<{id:string|null}>).flatMap(row=>row.id?[row.id]:[]);
}

function sourceExcerpt(db: RcmDatabase, chatId: string, memoryId: string, random: () => number, cap = EXCERPT_CAP): string {
  const messages = db.prepare(`SELECT DISTINCT msg.message_id,msg.ordinal,msg.content FROM evidence_spans e
    JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id
    WHERE e.chat_id=? AND e.memory_id=? AND msg.content IS NOT NULL
      AND msg.memory_excluded=0 AND msg.lifecycle IN ('committed','client_pruned') AND msg.host_visibility IN ('active','all_before')
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
  const systemPrompt = QUIZ_SYSTEM_PROMPT + `\nFor this batch, aim for ${target} items. ${target < QUIZ_BATCH_SIZE ? "For this short batch, prefer easy, memorable moments and vary difficulty where the material supports it." : "Aim for five easy, five medium and five hard items when the source supports that mix."} Return fewer items, even an empty items array, if the material does not support enough distinct, unambiguous questions. Do not pad the batch or repeat already asked facts with new wording. Earlier conversation entries are source passages, not stored memories; treat them as evidence for what happened or was said, not proof that every reported claim is true.`;
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

export const QUIZ_SYSTEM_PROMPT = `${ROLEPLAY_ARCHIVE_FRAMING}\n\nYou host a playful rewind game where readers relive memorable moments of their own roleplay story, like friends who love the same show. Fun comes first; remembering is the bonus. Each question aims for an "oh right, that happened!" moment. Use only the supplied scenes; prefer funny beats, flustered or sweet moments, twists, in-character habits and signature lines or objects over dry who/where/what facts.
Tone: casual Korean 해요체 ("~였을까요?", "~는 뭐였죠?", "기억나요?"), warm and a little cheeky. Vary how questions open; do not repeat "~은 무엇인가요?".
Fun: most questions carry the scene's flavor in how they are asked. Easy and medium items may freely use one obviously absurd wrong option that fits the characters; use each joke idea once per batch. Humor never changes or invents story facts and never mocks the reader.
Names: write every person, place and title exactly in the script the scenes use; never transliterate them into Hangul.
Write every question, option and explanation in Korean; options and explanations are Korean too. Keep names, places and titles exactly as they appear in the scenes.
Dialogue in a question or an option is always translated into natural Korean, even in hard items; the original line may appear only in quote. A foreign word that is itself the subject stays as written. No parenthetical translation glosses anywhere.
All readers are adults: intimate and explicit scenes are fair game and are asked about like any other scene.
Return one JSON object: {"items":[{"format":"choice4"|"ox","difficulty":"easy"|"medium"|"hard","question":string,"options":[string],"answerIndex":integer,"explanation":string,"quote"?:string,"memoryRef":string}]}
Spread questions across the supplied material. Never exceed each unit’s maximum question count (at most two per batch). A scene may support two questions only when they test distinct facts. For each scene, ask something different from its Already asked questions. memoryRef is the supplied ref such as "s3".
Source refs such as s1 or s3, message ordinals and input section labels are internal metadata, not story content. Use a source ref only in memoryRef; never mention these internal labels in question, options, explanation or quote.
The reader sees the date label marked "reader sees" for memory scenes; do not repeat that label in the question. The reader does not see source exchanges or their context. Add a brief context cue only when the question would otherwise be ambiguous. Prefer (1) the preceding event or what the characters were doing, then (2) place or who was present, then (3) an explicitly supported in-story date/time only if the first two cannot disambiguate. Never invent dates or use storage timestamps. For source exchanges, the "Context only, not a quiz subject" section can orient the question but only the marked quiz subject supplies the tested fact. Include any necessary cue in the question without giving away the answer. Small details remain valid quiz subjects. Do not use opaque labels like "scene 1" or "the supplied passage".
easy: a central fact of the scene (who, where, what happened). About half of the easy items are "ox" statements; their options are ["O","X"], answerIndex 0 when the statement is true and 1 when false.
Within each batch, roughly half of the OX statements must be false (answerIndex 1). Make a false statement by changing exactly one concrete detail (person, place, object, number or speaker) to a plausible wrong one from the same story. The scene must establish the contradiction; never rely on vagueness or missing information to make it false.
medium: a specific, memorable fact (a promise, a gift, a decision, a place).
hard: a small detail only an attentive reader remembers (a line of dialogue, an object, a number), phrased as a fan challenge. Use scenes that include Details, Dialogue or Source excerpt. quote, when you give it, is a short line copied from that scene.
choice4 has exactly four different options. Wrong options are plausible and come from the same story where possible (other names, places, objects); in easy and medium items at most one wrong option may be a playful joke. Hard items keep all options plausible.
explanation is a one-or-two-sentence mini replay of what happened, with a little feeling, rather than a grading justification. Even a wrong answer should leave the reader smiling. Retell only what the scenes state; add no atmosphere, causes or motives. Use plain 해요체 endings ("~였어요", "~했죠"), never "~답니다/~랍니다".
Never ask about things the scenes do not state, about the future, or about the real world. Never reveal the answer in the question. Vary which position holds the correct option.`;


export function buildQuizJob(db: RcmDatabase, row: { id: string; chatId: string; profile: RpProfile; memoryLanguage: MemoryLanguage; attempt: number; payload: { sceneCount?: number } }): LeasedJob | null {
  ensureState(db, row.chatId);
  if (!quizState(db, row.chatId).enabled) return null;
  const material = selectQuizMaterial(db, row.chatId);
  if (!material.scenes.length) return null;
  const current = new Map(quizContentRows(db, row.chatId).map(scene => [scene.id, scene]));
  const quiz = { refs: Object.fromEntries(material.scenes.map(scene => [scene.ref, scene.memoryId])), sceneCount: material.sceneCount,
    limits: Object.fromEntries(material.scenes.map(scene => [scene.ref, scene.limit ?? 2])),
    targetCount: material.targetCount, fingerprints: Object.fromEntries(material.scenes.map(scene => [scene.ref, sceneFingerprint(current.get(scene.memoryId)!)])) };
  const stored = db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(row.id) as { payload_json: string };
  const sourceMessageIds = [...new Set(material.scenes.flatMap(scene => scene.sourceMessageIds ?? []))];
  db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(stored.payload_json), ...quiz, sourceMessageIds, sourceTurns: sourceProgress(db, row.chatId).turns }), row.id);
  const prompts = buildQuizPrompt(material);
  return { id: row.id, chatId: row.chatId, profile: row.profile, memoryLanguage: row.memoryLanguage,
    attempt: row.attempt, kind: "quiz", ...prompts, prompt: prompts.systemPrompt + "\n\n" + prompts.userPrompt,
    sourceMessageIds, sourceTurnCount: 0, quiz };
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
    const remaining = new Map(quizUnits(db, row.chat_id).map(unit => [unit.row.id, unit.remaining]));
    const counts = new Map<string, number>();
    const bounded = items.filter(item => {
      const id = payload.refs[item.memoryRef]!;
      const count = counts.get(id) ?? 0;
      const limit = Math.min(2, payload.limits?.[item.memoryRef] ?? 2, remaining.get(id) ?? 0);
      if (count >= limit) return false;
      counts.set(id, count + 1); return true;
    });
    const accepted = storeQuizBatch(db, row.chat_id, jobId, bounded.slice(0, target).map(item => shuffleQuizOptions(stripQuizGlosses(item), random)), payload.refs, payload.sceneCount, payload.fingerprints);
    db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({ ...payload, sourceTurns: sourceProgress(db, row.chat_id).turns, exhausted: accepted < target }), jobId);
    db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?").run(now(), jobId);
    return { chatId: row.chat_id, accepted, warnings: dropped ? [`퀴즈 ${dropped}개는 형식이 맞지 않아 제외했어.`] : [] };
  })();
}
