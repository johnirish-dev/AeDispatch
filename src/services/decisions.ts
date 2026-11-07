// The officer's decision on a recommendation. Nothing becomes a field task
// without an officer confirming it (ADR-04), and a confirmation needs the
// "I have reviewed the evidence and available team capacity" tick.

import type { Db } from "../db/connection";
import { getBarangay } from "../db/repositories/barangayRepo";
import { latestScoreFor } from "../db/repositories/scoreRepo";
import { listBhws } from "../db/repositories/userRepo";
import {
  TaskType,
  addEvent,
  createRecommendation,
  createTask,
  decideRecommendation,
  hasOpenTask,
} from "../db/repositories/workflowRepo";
import { AppError } from "../errors";
import * as v from "../validate";
import type { RankingService } from "./ranking";
import { DecisionView, buildDecisionView } from "./views";

export const MIN_REASON_LENGTH = 10;

const TASK_TYPE: Record<1 | 2, TaskType> = { 1: "search_and_destroy", 2: "tier2_verification" };
const TIER_NAME: Record<1 | 2, string> = { 1: "Tier 1", 2: "Tier 2 review" };

export class Decisions {
  constructor(
    private readonly db: Db,
    private readonly ranking: RankingService,
  ) {}

  /** Confirm: creates the recommendation record, the decision, and the BHW's task together. */
  confirm(officerId: number, barangayId: number, input: unknown) {
    const body = v.bodyObject(input);
    const tier = this.tierOf(body.tier);
    if (body.reviewed !== true) {
      throw new AppError(400, "Tick that you have reviewed the evidence and the available team capacity.");
    }
    const view = this.eligible(barangayId, tier);

    const bhw = listBhws(this.db).find((b) => b.barangayId === barangayId);
    if (!bhw) throw new AppError(409, `No BHW is assigned to ${view.barangay.name}. Assign one before confirming.`);
    if (hasOpenTask(this.db, barangayId, TASK_TYPE[tier])) {
      throw new AppError(409, `${view.barangay.name} already has an open ${TIER_NAME[tier]} task.`);
    }
    const puroks = this.puroksFor(view, tier, body.puroks);

    const at = this.ranking.now().toISOString();
    const scoreId = latestScoreFor(this.db, barangayId)!.id;
    return this.db.transaction(() => {
      const recommendationId = createRecommendation(this.db, { barangayId, scoreId, tier, at });
      decideRecommendation(this.db, { id: recommendationId, status: "confirmed", officerId, at });
      const taskId = createTask(this.db, {
        recommendationId,
        barangayId,
        bhwId: bhw.id,
        type: TASK_TYPE[tier],
        puroks,
        status: "new",
        at,
      });
      addEvent(this.db, "decision", `Confirmed ${TIER_NAME[tier]} for ${view.barangay.name}`, at);
      return { recommendationId, taskId, type: TASK_TYPE[tier], puroks, bhw: bhw.displayName };
    })();
  }

  /** Reject: needs a reason of at least 10 characters. The barangay stays in the queue. */
  reject(officerId: number, barangayId: number, input: unknown) {
    const body = v.bodyObject(input);
    const tier = this.tierOf(body.tier);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < MIN_REASON_LENGTH) {
      throw new AppError(400, `Write a reason of at least ${MIN_REASON_LENGTH} characters.`);
    }
    if (reason.length > 1000) throw new AppError(400, "The reason must be at most 1000 characters.");
    const view = this.eligible(barangayId, tier);

    const at = this.ranking.now().toISOString();
    const scoreId = latestScoreFor(this.db, barangayId)!.id;
    return this.db.transaction(() => {
      const recommendationId = createRecommendation(this.db, { barangayId, scoreId, tier, at });
      decideRecommendation(this.db, { id: recommendationId, status: "rejected", officerId, reason, at });
      // The reason goes into the timeline so colleagues can see why a barangay was left alone.
      addEvent(this.db, "decision", `Rejected ${TIER_NAME[tier]} for ${view.barangay.name}: "${reason}"`, at);
      return { recommendationId };
    })();
  }

  private tierOf(value: unknown): 1 | 2 {
    return (value === undefined ? 1 : v.int(value, "tier", 1, 2)) as 1 | 2;
  }

  /** Only a recommendation the dashboard actually offers can be decided on. */
  private eligible(barangayId: number, tier: 1 | 2): DecisionView {
    if (!getBarangay(this.db, barangayId)) throw new AppError(404, "Barangay not found.");
    const view = buildDecisionView(this.db, this.ranking, barangayId);
    if (tier === 1 && !view.tier1.available) {
      throw new AppError(409, `Tier 1 is recommended from a score of ${view.tier1.threshold}. ${view.barangay.name} is at ${view.score.score100}.`);
    }
    if (tier === 2 && !view.tier2.unlocked) {
      throw new AppError(409, "Tier 2 is locked. A high risk score alone never authorizes fogging; it needs more than 2 confirmed cases in one purok.");
    }
    return view;
  }

  /** The puroks the task covers: the ones the officer picked, else the ones with cases. */
  private puroksFor(view: DecisionView, tier: 1 | 2, picked: unknown): string[] {
    const all = view.purokCases.map((p) => p.purok);
    if (picked !== undefined) {
      if (!Array.isArray(picked) || picked.length === 0) throw new AppError(400, "puroks must be a list of purok names.");
      return picked.map((n, i) => {
        const name = v.text(n, `purok ${i + 1}`, 40);
        const match = all.find((p) => p.toLowerCase() === name.toLowerCase());
        if (!match) throw new AppError(400, `${name} is not a purok of ${view.barangay.name}.`);
        return match;
      });
    }
    if (tier === 2) return view.tier2.puroks.map((p) => p.purok);
    const withCases = view.purokCases.filter((p) => p.cases > 0).map((p) => p.purok);
    return withCases.length > 0 ? withCases : all;
  }
}
