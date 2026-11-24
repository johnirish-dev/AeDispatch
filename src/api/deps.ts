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
  /**
   * Whether the BHW survey list also carries each household's details (head of the family, age, building and so on).
   * Off unless the server turns it on: the barangay link is shared, so with real data it should stay off.
   */
  shareHouseholdDetails?: boolean;
}
