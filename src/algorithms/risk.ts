// Risk levels, recommended action, the Tier 2 (fogging review) rule and the
// trend arrow.
//
// All functions take the WHOLE-POINT score the officer sees (0-100, rounded,
// e.g. ThreatScoreResult.score100), not the raw [0,1] score. That way a
// barangay shown as "40" is never labelled "Monitor" because its raw score was
// 0.396. The heap still ranks by the raw score.
//
// Pure functions: parameters are passed in, nothing is read from a database.

import { ModelParameters, toPoints } from "./parameters";

export type RiskLevel = "low" | "moderate" | "elevated" | "high";

/** Low < 25, Moderate 25-39, Elevated 40-69, High >= 70 (cut-offs from parameters). */
export function riskLevel(score100: number, p: ModelParameters): RiskLevel {
  const cut = p.constants.riskCutoffs;
  if (score100 >= toPoints(cut.high)) return "high";
  if (score100 >= toPoints(cut.elevated)) return "elevated";
  if (score100 >= toPoints(cut.moderate)) return "moderate";
  return "low";
}

export interface PurokCases {
  purok: string;
  /** Confirmed cases in this purok over the Tier 2 window (last 14 days). */
  cases: number;
}

export interface Tier2Status {
  unlocked: boolean;
  /** The puroks that meet the rule, most cases first. */
  puroks: PurokCases[];
}

/**
 * Tier 2 (fogging review) unlocks only when one purok has more than 2
 * confirmed cases in the window. It looks at case counts and nothing else:
 * a high score, weather or larvae findings never unlock it, because fogging
 * is authorized by confirmed cases only.
 */
export function tier2Status(
  purokCases: PurokCases[],
  p: ModelParameters,
): Tier2Status {
  const puroks = purokCases
    .filter((x) => x.cases >= p.constants.tier2.minCases)
    .sort((a, b) => b.cases - a.cases);
  return { unlocked: puroks.length > 0, puroks };
}

export type Action = "tier1" | "monitor";

export interface Recommendation {
  /** Tier 1 (search and destroy / larviciding) or just keep monitoring. */
  action: Action;
  /** Independent of the action: only the purok case counts decide it. */
  tier2: Tier2Status;
}

export function recommendedAction(
  score100: number,
  purokCases: PurokCases[],
  p: ModelParameters,
): Recommendation {
  return {
    action:
      score100 >= toPoints(p.constants.tier1Threshold) ? "tier1" : "monitor",
    tier2: tier2Status(purokCases, p),
  };
}

export type Trend = "rising" | "falling" | "flat";

/**
 * Compares today's score with the score 7 days earlier. Changes within the
 * dead band (2 points) count as flat so small wiggles do not flip the arrow.
 * With no earlier score there is nothing to compare, so the arrow is flat.
 */
export function trend(
  currentScore100: number,
  previousScore100: number | null | undefined,
  p: ModelParameters,
): Trend {
  if (previousScore100 === null || previousScore100 === undefined) return "flat";
  const band = toPoints(p.constants.trendDeadBand);
  const change = currentScore100 - previousScore100;
  if (change > band) return "rising";
  if (change < -band) return "falling";
  return "flat";
}
