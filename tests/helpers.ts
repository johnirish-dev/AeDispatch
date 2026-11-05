import fs from "node:fs";
import path from "node:path";
import { Db, openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrate";
import { seedDatabase } from "../src/db/seedDatabase";

/** The sample "today" used by the tests (a Thursday in ISO week 2026-W45). */
export const SEED_DATE = "2026-11-05";

export function emptyDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}

export function seededDb(anchorDate: string = SEED_DATE): Db {
  const db = emptyDb();
  seedDatabase(db, { anchorDate });
  return db;
}

export function dataFile(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "data", name), "utf8");
}

export function count(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export function officerId(db: Db): number {
  return (db.prepare("SELECT id FROM staff_user WHERE username = 'officer'").get() as { id: number }).id;
}
