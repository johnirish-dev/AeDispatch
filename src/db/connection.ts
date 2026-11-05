import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export function defaultDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "aedispatch.db");
}

/** Opens the database (or ":memory:" for tests) with foreign keys switched on. */
export function openDatabase(file: string = defaultDbPath()): Db {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  return db;
}
