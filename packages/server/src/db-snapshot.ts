import type Database from "better-sqlite3";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** VACUUM includes committed WAL pages and leaves a standalone recovery file. */
export function snapshotBeforeMigration(db: Database.Database, targetSchema: number): void {
  if (!db.name || db.name === ":memory:") return;
  const snapshot = `${db.name}.before-schema${targetSchema}`;
  const temporary = `${snapshot}.${randomUUID()}.tmp`;
  try {
    if (existsSync(snapshot)) {
      if (!statSync(snapshot).isFile()) throw new Error("Snapshot path is not a file");
      return;
    }
    db.prepare("VACUUM INTO ?").run(temporary);
    // Another successful start may already have published the original copy.
    if (!existsSync(snapshot)) {
      renameSync(temporary, snapshot);
      console.log(`[RCM] Pre-migration database snapshot: ${snapshot}`);
    }
  } catch (cause) {
    throw Object.assign(new Error(`Cannot create pre-migration snapshot ${snapshot}; migration was not started: ${cause instanceof Error ? cause.message : String(cause)}`), { code: "PRE_MIGRATION_SNAPSHOT_FAILED", cause });
  } finally {
    rmSync(temporary, { force: true });
  }
}
