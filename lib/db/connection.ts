// SQLite singleton (D11, D13). Cached on globalThis so hot reload reuses it.
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "@/lib/env";
import { migrate } from "./migrate";

const globalForDb = globalThis as typeof globalThis & { __aliveDb?: Database.Database };

function open(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  globalForDb.__aliveDb ??= open(getEnv().databasePath);
  return globalForDb.__aliveDb;
}

/** Runs `fn` inside one SQLite transaction (nested calls become savepoints). */
export function inTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

/** Tests only: replace the singleton with a fresh in-memory database. */
export function resetDbForTests(): void {
  globalForDb.__aliveDb?.close();
  globalForDb.__aliveDb = open(":memory:");
}
