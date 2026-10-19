import { PickerSetupProjectionSchema } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

function object(value: unknown): Record<string, any> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Static consumers use only the name (admin/lineage/backup); the hash tracks changes. */
export function staticMetadata(value: unknown): string {
  const source = object(value);
  return JSON.stringify({ ...(typeof source.hash === "string" ? { hash: source.hash } : {}),
    ...(typeof source.characterName === "string" ? { characterName: source.characterName } : {}) });
}

const activeJob = (status: unknown): boolean => status === "queued" || status === "leased";
export function cleanSetupJobPayload(type: unknown, status: unknown, value: unknown): string {
  const payload = object(value);
  if (activeJob(status)) return JSON.stringify(payload);
  if (type !== "initial_calibration" && !payload.resolvedSetup) return JSON.stringify(payload);
  // Finished setup jobs keep operational metadata only, never input/response caches.
  const keep = ["sourceMessageIds", "setupFingerprint", "backfillRunId", "memoryLanguage", "trigger",
    "pipelineStage", "pipelineStageUpdatedAt", "llmCallStats", "auxiliaryBudget"];
  const retained = Object.fromEntries(keep.filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
  const hints = object(payload.identityHints);
  retained.identityHints = Object.fromEntries(["hostCharacterName", "userPersonaName"].filter(key => typeof hints[key] === "string").map(key => [key, hints[key]]));
  return JSON.stringify(retained);
}

/** Shared by migration and all backup export/import modes. Mutates detached rows only. */
export function sanitizeSetupRows(tables: Record<string, Array<Record<string, any>>>): void {
  const reset = new Set<string>();
  for (const row of tables.chats ?? []) if (row.static_json != null) row.static_json = staticMetadata(row.static_json);
  for (const row of tables.initial_calibrations ?? []) {
    const pending = ["queued", "awaiting_confirmation"].includes(row.status);
    const setup = PickerSetupProjectionSchema.safeParse(object(row.setup_json));
    if (pending && setup.success) row.setup_json = JSON.stringify(setup.data);
    else {
      row.setup_json = null;
      if (pending) {
        row.status = "awaiting_setup"; row.setup_fingerprint = null; row.last_error = null;
        reset.add(row.chat_id);
      }
    }
  }
  for (const row of tables.jobs ?? []) {
    const payload = object(row.payload_json);
    if (activeJob(row.status) && (row.type === "initial_calibration" || payload.resolvedSetup)) {
      const setup = PickerSetupProjectionSchema.safeParse(payload.resolvedSetup);
      if (!setup.success || reset.has(row.chat_id)) {
        row.status = "cancelled"; row.lease_owner = null; row.leased_until = null;
        row.last_error = null;
        if (row.type === "initial_calibration") reset.add(row.chat_id);
      }
    }
    row.payload_json = cleanSetupJobPayload(row.type, row.status, row.payload_json);
  }
  for (const row of tables.initial_calibrations ?? []) if (reset.has(row.chat_id) && ["queued", "awaiting_confirmation"].includes(row.status)) {
    row.status = "awaiting_setup"; row.setup_json = null; row.setup_fingerprint = null; row.last_error = null;
  }
}

export function migrateSetupStorage(db: RcmDatabase): void {
  const tables: Record<string, Array<Record<string, any>>> = {};
  for (const table of ["chats", "initial_calibrations", "jobs"]) tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, any>>;
  sanitizeSetupRows(tables);
  for (const row of tables.chats!) db.prepare("UPDATE chats SET static_json=? WHERE id=?").run(row.static_json, row.id);
  for (const row of tables.initial_calibrations!) db.prepare("UPDATE initial_calibrations SET status=?,setup_json=?,setup_fingerprint=?,last_error=? WHERE chat_id=?")
    .run(row.status, row.setup_json, row.setup_fingerprint, row.last_error, row.chat_id);
  for (const row of tables.jobs!) db.prepare("UPDATE jobs SET status=?,payload_json=?,lease_owner=?,leased_until=?,last_error=? WHERE id=?")
    .run(row.status, row.payload_json, row.lease_owner, row.leased_until, row.last_error, row.id);
}

/** All terminal paths (completion, exhausted retries, cancellation and late writes) share this boundary. */
export function installSetupStorageGuards(db: RcmDatabase): void {
  db.function("clean_setup_job_payload", { deterministic: true }, cleanSetupJobPayload);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS setup_job_terminal_insert AFTER INSERT ON jobs
    WHEN NEW.status NOT IN ('queued','leased') AND (NEW.type='initial_calibration' OR json_type(NEW.payload_json,'$.resolvedSetup') IS NOT NULL)
    BEGIN UPDATE jobs SET payload_json=clean_setup_job_payload(NEW.type,NEW.status,NEW.payload_json) WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS setup_job_terminal_update AFTER UPDATE OF status,payload_json ON jobs
    WHEN NEW.status NOT IN ('queued','leased') AND (NEW.type='initial_calibration' OR json_type(NEW.payload_json,'$.resolvedSetup') IS NOT NULL)
      AND NEW.payload_json<>clean_setup_job_payload(NEW.type,NEW.status,NEW.payload_json)
    BEGIN UPDATE jobs SET payload_json=clean_setup_job_payload(NEW.type,NEW.status,NEW.payload_json) WHERE id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS setup_terminal_insert AFTER INSERT ON initial_calibrations
    WHEN NEW.status NOT IN ('queued','awaiting_confirmation') AND NEW.setup_json IS NOT NULL
    BEGIN UPDATE initial_calibrations SET setup_json=NULL WHERE chat_id=NEW.chat_id; END;
    CREATE TRIGGER IF NOT EXISTS setup_terminal_clear AFTER UPDATE OF status,setup_json ON initial_calibrations
    WHEN NEW.status NOT IN ('queued','awaiting_confirmation') AND NEW.setup_json IS NOT NULL
    BEGIN UPDATE initial_calibrations SET setup_json=NULL WHERE chat_id=NEW.chat_id; END;
  `);
}
