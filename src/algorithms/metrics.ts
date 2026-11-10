// Ranking-quality metrics for the evaluation (Objective 3). Pure functions: no database, no
// Express, no clock. A "ranking" is a list of barangay indices, best first. "Gains" are the
// cases each barangay really had afterwards, indexed by the same barangay index.
//
// The functions that average over weeks or seeds skip a week with nothing to find (NaN), so
// a quiet week neither helps nor hurts a method.

import { Rng, mulberry32 } from "../sim/random";

/** The barangay indices with the most gain, best first, only counting those with gain >= 1. */
export function trueTop(gains: ArrayLike<number>, k: number): number[] {
  const ids: number[] = [];
  for (let b = 0; b < gains.length; b++) if (gains[b] >= 1) ids.push(b);
  ids.sort((a, b) => gains[b] - gains[a] || a - b); // ties: the lower index first
  return ids.slice(0, k);
}

/**
 * Judges rankings against one set of gains (the cases the barangays really had afterwards).
 * The true top k and the best possible DCG are worked out once per k, so many rankings (for
 * example hundreds of random ones) can be judged quickly.
 */
export class RankingJudge {
  private readonly relevant = new Map<number, Set<number>>();
  private readonly ideal = new Map<number, number>();

  constructor(
    private readonly gains: ArrayLike<number>,
    ks: number[],
  ) {
    const sorted = Array.from(gains).sort((a, b) => b - a);
    for (const k of ks) {
      this.relevant.set(k, new Set(trueTop(gains, k)));
      let ideal = 0;
      for (let i = 0; i < Math.min(k, sorted.length); i++) ideal += sorted[i] / Math.log2(i + 2);
      this.ideal.set(k, ideal);
    }
  }

  /**
   * Precision@k: of the k recommended barangays, the share that belong to the true top k (the k
   * barangays with the most cases afterwards, counting only barangays that had at least 1 case).
   * The denominator is always k, so if fewer than k barangays had cases the best possible value
   * is below 1. NaN when no barangay had any case (nothing to find).
   */
  precision(ranked: ArrayLike<number>, k: number): number {
    const relevant = this.relevant.get(k)!;
    if (relevant.size === 0) return NaN;
    let hits = 0;
    for (let i = 0; i < Math.min(k, ranked.length); i++) if (relevant.has(ranked[i])) hits++;
    return hits / k;
  }

  /**
   * NDCG@k: reward cases found, and reward finding the big ones first. The gain of a barangay is
   * its number of cases afterwards; the discount for position i (1 is first) is 1 / log2(i + 1).
   * It is divided by the best possible ordering, so 1 is perfect. NaN when there are no cases.
   */
  ndcg(ranked: ArrayLike<number>, k: number): number {
    const ideal = this.ideal.get(k)!;
    if (ideal === 0) return NaN;
    let dcg = 0;
    for (let i = 0; i < Math.min(k, ranked.length); i++) dcg += this.gains[ranked[i]] / Math.log2(i + 2);
    return dcg / ideal;
  }
}

/** Precision@k for one ranking (see `RankingJudge.precision`). */
export function precisionAtK(ranked: ArrayLike<number>, gains: ArrayLike<number>, k: number): number {
  return new RankingJudge(gains, [k]).precision(ranked, k);
}

/** NDCG@k for one ranking (see `RankingJudge.ndcg`). */
export function ndcgAtK(ranked: ArrayLike<number>, gains: ArrayLike<number>, k: number): number {
  return new RankingJudge(gains, [k]).ndcg(ranked, k);
}

/**
 * Gini coefficient of how often each barangay was dispatched (counts per barangay). 0 means
 * every barangay was chosen equally often; values near 1 mean the same few were always chosen.
 * Low is not automatically good: report it next to the coverage of real outbreaks.
 */
export function gini(counts: ArrayLike<number>): number {
  const x = Array.from(counts).sort((a, b) => a - b);
  const n = x.length;
  const total = x.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * x[i];
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Ranks with the average rank for ties (1 is the smallest value). */
function averageRanks(values: ArrayLike<number>): number[] {
  const order = Array.from({ length: values.length }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let m = i; m <= j; m++) ranks[order[m]] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation of two lists of the same length (-1 to 1). NaN when one is constant. */
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const n = ra.length;
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - meanA) * (rb[i] - meanB);
    varA += (ra[i] - meanA) ** 2;
    varB += (rb[i] - meanB) ** 2;
  }
  return varA === 0 || varB === 0 ? NaN : cov / Math.sqrt(varA * varB);
}

/**
 * Lead time in weeks: how much earlier than the case jump the method first put the barangay in
 * its top k (positive = earlier, 0 = in the week of the jump, negative = late). null if it never did.
 */
export function leadTimeWeeks(firstWeekInTopK: number | null, onsetWeek: number): number | null {
  return firstWeekInTopK === null ? null : onsetWeek - firstWeekInTopK;
}

export const mean = (values: ArrayLike<number>): number => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      sum += values[i];
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
};

export function median(values: ArrayLike<number>): number {
  const x = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (x.length === 0) return NaN;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 === 1 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}

export interface Interval {
  mean: number;
  low: number;
  high: number;
}

/**
 * Mean with a 95% percentile bootstrap interval: resample the values with replacement, take the
 * mean of each resample, and read the 2.5th and 97.5th percentiles. The seed makes it repeatable.
 */
export function bootstrapCI(values: ArrayLike<number>, resamples = 2000, seed = 1, rng?: Rng): Interval {
  const x = Array.from(values).filter(Number.isFinite);
  if (x.length === 0) return { mean: NaN, low: NaN, high: NaN };
  const random = rng ?? mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[Math.floor(random() * x.length)];
    means.push(sum / x.length);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))];
  return { mean: x.reduce((a, b) => a + b, 0) / x.length, low: at(0.025), high: at(0.975) };
}

/** Per-item differences a - b for two lists of the same length (e.g. one pair per seed). */
export function pairedDifference(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(a[i] - b[i]);
  return out;
}

export type Verdict = "better" | "worse" | "tie";

/** "better" only when the whole interval of the paired difference is above 0, "worse" when below. */
export function verdictOf(interval: Interval): Verdict {
  if (!Number.isFinite(interval.low) || !Number.isFinite(interval.high)) return "tie";
  if (interval.low > 0) return "better";
  if (interval.high < 0) return "worse";
  return "tie";
}
