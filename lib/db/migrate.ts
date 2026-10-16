import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

// Read from the project root: Next bundles lib/ but not .sql files.
const SCHEMA_PATH = path.join(process.cwd(), "lib", "db", "schema.sql");

/** Applies schema.sql. Every statement is IF NOT EXISTS, so this is idempotent. */
export function migrate(db: Database.Database): void {
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
}
