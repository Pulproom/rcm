import { z } from "zod";
import type { RcmDatabase } from "./db.js";

const ViewPreferencesSchema = z.object({
  personaEntity: z.string().trim().min(1).nullable().default(null),
  hiddenAnniversaries: z.array(z.string()).default([]),
}).strict();

const ViewPreferencesPatchSchema = z.object({
  personaEntity: z.string().trim().min(1).nullable().optional(),
  hiddenAnniversaries: z.array(z.string()).optional(),
}).strict();

export type ViewPreferences = z.infer<typeof ViewPreferencesSchema>;

export class ViewPreferencesStorageError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "ViewPreferencesStorageError";
  }
}

export class InvalidStoredViewPreferencesError extends ViewPreferencesStorageError {
  constructor(chatId: string, cause: unknown) {
    super(`Stored view preferences are invalid for chat ${chatId}.`, cause);
    this.name = "InvalidStoredViewPreferencesError";
  }
}

export class InvalidViewPreferencesPatchError extends Error {
  constructor(cause: unknown) {
    super("Invalid view preferences request.", { cause });
    this.name = "InvalidViewPreferencesPatchError";
  }
}

export const viewPreferencesKey = (chatId: string): string => `view_preferences:${chatId}`;
export const personaHintKey = (chatId: string): string => `persona_hint:${chatId}`;

/** An unavailable host identity is not an instruction to erase the last known persona. */
export function writePersonaHint(db: RcmDatabase, chatId: string, hint: unknown): void {
  if (typeof hint !== "string" || !hint.trim()) return;
  db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(personaHintKey(chatId), JSON.stringify(hint.trim()));
}

/** Older inherited chats may lack the persona metadata copied with new branches. */
export function readPersonaName(db: RcmDatabase, chatId: string, hint?: string): string | undefined {
  const seen = new Set<string>();
  let current: string | undefined = chatId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const stored = db.prepare("SELECT value FROM server_meta WHERE key=?").get(personaHintKey(current)) as {value:string} | undefined;
    const name = readViewPreferences(db, current).personaEntity ?? (stored ? JSON.parse(stored.value) : undefined) ?? hint;
    if (typeof name === 'string' && name.trim()) {
      const entity = db.prepare("SELECT name FROM entities WHERE chat_id=? AND id=?").get(current,name) as {name:string} | undefined;
      return entity?.name ?? name;
    }
    const parent = db.prepare("SELECT parent_chat_id FROM chat_lineage WHERE child_chat_id=? AND status='inherited'").get(current) as {parent_chat_id:string} | undefined;
    current = parent?.parent_chat_id;
  }
  return undefined;
}

export function readViewPreferences(db: RcmDatabase, chatId: string): ViewPreferences {
  try {
    const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(viewPreferencesKey(chatId)) as { value: string } | undefined;
    if (!row) return ViewPreferencesSchema.parse({});
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch (error) {
      throw new InvalidStoredViewPreferencesError(chatId, error);
    }
    const parsed = ViewPreferencesSchema.safeParse(value);
    if (!parsed.success) throw new InvalidStoredViewPreferencesError(chatId, parsed.error);
    return parsed.data;
  } catch (error) {
    if (error instanceof ViewPreferencesStorageError) throw error;
    throw new ViewPreferencesStorageError(`Unable to read view preferences for chat ${chatId}.`, error);
  }
}

export function writeViewPreferences(db: RcmDatabase, chatId: string, patch: unknown): ViewPreferences {
  const parsedPatch = ViewPreferencesPatchSchema.safeParse(patch);
  if (!parsedPatch.success) throw new InvalidViewPreferencesPatchError(parsedPatch.error);
  try {
    const preferences = ViewPreferencesSchema.parse({ ...readViewPreferences(db, chatId), ...parsedPatch.data });
    db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(viewPreferencesKey(chatId), JSON.stringify(preferences));
    return preferences;
  } catch (error) {
    if (error instanceof ViewPreferencesStorageError) throw error;
    throw new ViewPreferencesStorageError(`Unable to write view preferences for chat ${chatId}.`, error);
  }
}
