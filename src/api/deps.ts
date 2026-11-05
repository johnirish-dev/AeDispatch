import type { Db } from "../db/connection";
import type { DataChanges } from "../services/changes";
import type { Decisions } from "../services/decisions";
import type { RankingService } from "../services/ranking";
import type { SessionManager } from "./auth";

/** Everything the routes need, created once in server.ts (and in the tests). */
export interface AppDeps {
  db: Db;
  ranking: RankingService;
  changes: DataChanges;
  decisions: Decisions;
  sessions: SessionManager;
}
