// The rankings AeDispatch is compared with (Objective 3). Each one turns the same simulated data
// into a score per barangay for week t, using only what is known at the end of that week.
//
//  - case-count-only : what the health office does today. The confirmed cases of the newest case
//                      week that has arrived (ties: the week before, then the lower index).
//  - weather-only    : the weather index times each barangay's density adjustment. Weather is
//                      municipal, so every barangay has the same weather index and this ranking
//                      is really the density ranking. That is a property of the data, not a bug.
//  - random          : a fresh random order (the evaluation averages many of them).

import { Rng } from "../sim/random";
import { SimData, weeklyCases } from "../sim/generator";
import { latestCaseWeek } from "./rank";

/** The barangay indices from the highest score to the lowest; equal scores keep the lower index first. */
export function orderByScore(scores: ArrayLike<number>): Int32Array {
  const order = Int32Array.from({ length: scores.length }, (_, i) => i);
  order.sort((a, b) => scores[b] - scores[a] || a - b);
  return order;
}

/** Case-count-only score: the newest known week's cases, with the week before as a tie-break. */
export function caseCountScores(d: SimData, t: number, caseDelayWeeks: number): Float64Array {
  const out = new Float64Array(d.barangays);
  const latest = latestCaseWeek(t, caseDelayWeeks);
  for (let b = 0; b < d.barangays; b++) {
    const now = latest >= 0 ? weeklyCases(d, b, latest) : 0;
    const before = latest - 1 >= 0 ? weeklyCases(d, b, latest - 1) : 0;
    out[b] = now + before / 1000; // the cases dominate; the earlier week only separates equal counts
  }
  return out;
}

/** A random order of 0..n-1 (Fisher-Yates), from the given generator. */
export function randomOrder(n: number, rng: Rng): Int32Array {
  const order = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}
