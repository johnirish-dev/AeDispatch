import "dotenv/config";
import { SessionManager } from "./api/auth";
import { createApp } from "./app";
import { openDatabase } from "./db/connection";
import { runMigrations } from "./db/migrate";
import { validateParameters } from "./algorithms/parameters";
import { getActiveParameters } from "./db/repositories/parameterRepo";
import { DataChanges } from "./services/changes";
import { Decisions } from "./services/decisions";
import { RankingService } from "./services/ranking";

const port = Number(process.env.PORT) || 3000;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const db = openDatabase();
runMigrations(db); // creates the tables if the file is new; changes nothing otherwise

let params;
try {
  params = getActiveParameters(db);
} catch {
  fail("The database has no data yet. Run `npm run seed` first, then `npm run dev`.");
}
try {
  validateParameters(params);
} catch (err) {
  // A database seeded by an older version lacks settings the scoring now needs.
  fail(`The stored model settings are out of date (${(err as Error).message}).\nRun \`npm run seed\` to rebuild the sample database.`);
}

const ranking = new RankingService(db);
try {
  ranking.start();
} catch (err) {
  fail(`Could not start the ranking: ${(err as Error).message}`);
}

const app = createApp({
  db,
  ranking,
  changes: new DataChanges(db, ranking),
  decisions: new Decisions(db, ranking),
  // With no SESSION_SECRET a random one is made, which is fine because sessions live in memory.
  sessions: new SessionManager(process.env.SESSION_SECRET || undefined),
});

// 0.0.0.0 so phones on the same Wi-Fi can open the QR-code links.
app.listen(port, "0.0.0.0", () => {
  console.log(`AeDispatch running on http://localhost:${port}`);
});
