import type Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `Database schema version ${found} does not match the app (${SCHEMA_VERSION}). ` +
        "This is a hackathon prototype without migrations: delete the database file " +
        "(PowerShell: Remove-Item .\\data -Recurse) and restart.",
    );
    this.name = "SchemaVersionError";
  }
}

/**
 * Applies the schema. Fresh DBs are created at SCHEMA_VERSION; a DB created by
 * an older version fails loudly instead of running on a half-matching schema.
 */
export function migrate(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  const hasTables =
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'promises'").get() !== undefined;
  if (hasTables && version !== SCHEMA_VERSION) throw new SchemaVersionError(version);
  db.exec(SCHEMA_SQL); // every statement is IF NOT EXISTS
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
