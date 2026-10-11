import { augmentSearchText, normalizeSearchTokens, type LandmarkKind, type MemoryLanguage } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

export const RELATIONSHIP_LANDMARK_KINDS = new Set<LandmarkKind["kind"]>([
  "first_met",
  "romantic_relationship_established",
  "engagement",
  "marriage",
  "separation",
  "romantic_relationship_ended",
  "reunion",
  "divorce",
  "anniversary_basis",
]);

export function parseLandmarkKinds(value: string | null | undefined): LandmarkKind[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as LandmarkKind[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function memoryContextSignature(row: {
  memory_key: string;
  participants_json: string;
  evidence_json: string;
  story_time?: string | null;
}): string {
  return normalizeSearchTokens(`${row.memory_key} ${row.participants_json} ${row.evidence_json} ${row.story_time ?? ""}`).join("|");
}

function structuredMemoryMetadata(db: RcmDatabase, memoryId: string, landmarkKindsJson: string | null | undefined): string {
  const lines: string[] = [];
  for (const landmark of parseLandmarkKinds(landmarkKindsJson)) {
    const values = [
      `landmark_type=${landmark.kind}`,
      landmark.pair?.length === 2 ? `participants=${landmark.pair.join(" | ")}` : "",
      landmark.storyTime ? `story_time=${landmark.storyTime}` : "",
      landmark.label ? `label=${landmark.label}` : "",
    ].filter(Boolean);
    lines.push(values.join("; "));
  }
  const physical = db.prepare(`SELECT participant_a,participant_b,milestone_key,act,custom_label
    FROM physical_intimacy_milestones WHERE source_memory_id=? AND active=1 AND deleted_by_user=0
    ORDER BY milestone_key`).all(memoryId) as Array<{
      participant_a: string; participant_b: string; milestone_key: string; act: string; custom_label: string | null;
    }>;
  for (const item of physical) lines.push([
    `physical_milestone=${item.milestone_key}`,
    `act=${item.act === "other" ? item.custom_label ?? "other" : item.act}`,
    `participants=${item.participant_a} | ${item.participant_b}`,
  ].join("; "));
  return lines.length ? `Structured archive metadata:\n${lines.join("\n")}` : "";
}

export function memoryEmbeddingDocument(db: RcmDatabase, row: {
  id: string; title: string; content: string; locations_json: string; landmark_kinds_json: string;
}): string {
  let locations: string[] = [];
  try { locations = JSON.parse(row.locations_json) as string[]; } catch { locations = []; }
  const dialogues = (db.prepare("SELECT speaker,text FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal LIMIT 20").all(row.id) as Array<{ speaker: string; text: string }>)
    .map((dialogue) => `${dialogue.speaker}: ${dialogue.text}`).join("\n");
  const sections = (db.prepare(`SELECT title,summary FROM episode_sections
    WHERE episode_id=(SELECT id FROM episodes WHERE memory_id=? LIMIT 1) ORDER BY ordinal`).all(row.id) as Array<{ title: string; summary: string }>)
    .map((section) => `${section.title}: ${section.summary}`).join("\n");
  const structured = structuredMemoryMetadata(db, row.id, row.landmark_kinds_json);
  return `${row.title}\n${row.content}${locations.length ? `\nLocations: ${locations.join(", ")}` : ""}${structured ? `\n${structured}` : ""}${sections ? `\nEpisode sections:\n${sections}` : ""}${dialogues ? `\nDialogue:\n${dialogues}` : ""}`.slice(0, 32_000);
}

export function refreshMemoryFts(db: RcmDatabase, memoryId: string): boolean {
  const row = db.prepare(`SELECT m.chat_id,m.title,m.content,m.participants_json,m.locations_json,m.landmark_kinds_json,c.memory_language
    FROM memories m JOIN chats c ON c.id=m.chat_id WHERE m.id=?`).get(memoryId) as {
      chat_id: string; title: string; content: string; participants_json: string; locations_json: string;
      landmark_kinds_json: string; memory_language: MemoryLanguage;
    } | undefined;
  if (!row) return false;
  const parse = (value: string): string[] => {
    try { return JSON.parse(value) as string[]; } catch { return []; }
  };
  const dialogues = (db.prepare("SELECT speaker,text FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal LIMIT 20").all(memoryId) as Array<{ speaker: string; text: string }>)
    .flatMap((dialogue) => [dialogue.speaker, dialogue.text]);
  const structured = structuredMemoryMetadata(db, memoryId, row.landmark_kinds_json);
  db.prepare("DELETE FROM memory_fts WHERE memory_id=?").run(memoryId);
  db.prepare("INSERT INTO memory_fts(memory_id,chat_id,title,content,participants) VALUES(?,?,?,?,?)").run(
    memoryId,
    row.chat_id,
    augmentSearchText(row.title, row.memory_language),
    augmentSearchText(`${row.content}${structured ? `\n${structured}` : ""}`, row.memory_language),
    augmentSearchText([...parse(row.participants_json), ...parse(row.locations_json), ...dialogues].join(" "), row.memory_language),
  );
  return true;
}
