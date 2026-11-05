// `npm run seed`: deletes the database file and builds a fresh one filled with
// sample Daraga data. Set SEED_DATE=YYYY-MM-DD to reproduce an exact rehearsal;
// the default is today (UTC). DB_PATH chooses the file.

import "dotenv/config";
import fs from "node:fs";
import { todayUtc, isValidDate } from "../util/dates";
import { defaultDbPath, openDatabase } from "./connection";
import { runMigrations } from "./migrate";
import { RankingService } from "../services/ranking";
import { OFFICER_PASSWORD, OFFICER_USERNAME, seedDatabase } from "./seedDatabase";

function main(): void {
  const anchor = process.env.SEED_DATE || todayUtc();
  if (!isValidDate(anchor)) throw new Error(`SEED_DATE must be YYYY-MM-DD, got "${anchor}"`);

  const file = defaultDbPath();
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);

  const db = openDatabase(file);
  runMigrations(db);
  const summary = seedDatabase(db, { anchorDate: anchor, phoneSalt: process.env.PHONE_HASH_SALT || undefined });

  // The seed stores only a few stub scores, so work out a real score for every
  // barangay and every day of the sample history (trend arrows and charts need it).
  new RankingService(db, { clock: () => new Date(`${anchor}T12:00:00.000Z`) }).backfillHistory(summary.startDate, anchor);
  summary.counts.threat_score = (db.prepare("SELECT COUNT(*) AS n FROM threat_score").get() as { n: number }).n;
  db.close();

  console.log(`Seeded ${file}`);
  console.log(`Sample "today": ${summary.anchorDate} (${summary.currentWeek}), history from ${summary.startDate}`);
  console.log(summary.counts);
  console.log(`\nOfficer login: ${OFFICER_USERNAME} / ${OFFICER_PASSWORD}`);
  console.log("BHW access tokens (sample):");
  for (const t of summary.bhwTokens) console.log(`  ${t.name} (${t.barangay}): ${t.token}`);
}

main();
