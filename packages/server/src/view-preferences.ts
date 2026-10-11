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
