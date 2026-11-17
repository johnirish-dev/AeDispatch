// Objective 2: are the Tier 1 and Tier 2 recommendations any good, and what do extra field teams buy?
//
// Three questions, all answered on simulated municipalities with the REAL rules of the system
// (`recommendedAction` in algorithms/risk.ts) and the same weeks, windows and outbreak definition as
// the ranking-quality run:
//
//   (a) Tier 1. Each week, which barangays does the rule recommend (a score of 40 or more, or an open
//       Tier 2 cluster)? How often is a recommendation followed by cases, and by a NEW outbreak? How
//       many outbreaks had a recommendation before their cases jumped? How many recommendations is
//       that per week (the burden on the teams)? The baselines are held to the SAME number of
//       barangays each week, otherwise "recommend everyone" would win every comparison.
//   (b) Capacity. If k teams can each reach one barangay a week, what share of the outbreaks was
//       within the top k at least once before the cases jumped? For k = 1 to 20, for AeDispatch and
//       each baseline. This is the curve that shows what an extra team buys.
//   (c) Tier 2. It must follow the purok case rule and nothing else. A property check sweeps scores
//       from 0 to 100 against purok case counts and confirms the rule. The report also says how
//       often it unlocks, and how often an unlocked purok still has cases afterwards.
//
// The simulator is not tuned to make AeDispatch win: whatever comes out is reported.

import { Interval, bootstrapCI, mean } from "../algorithms/metrics";
import { DEFAULT_PARAMETERS, ModelParameters, toPoints } from "../algorithms/parameters";
import { PurokCases, recommendedAction } from "../algorithms/risk";
import { SimData, caseIndex, generate } from "../sim/generator";
import { mulberry32 } from "../sim/random";
import { caseCountScores, orderByScore, randomOrder } from "./baselines";
import { WARNING_WEEKS } from "./quality";
import { DEFAULT_CASE_DELAY_WEEKS, densityRatios, evaluableWeeks, futureCases, latestCaseWeek, scoreAll, weatherOnlyScores } from "./rank";

export const TIER_METHODS = ["AeDispatch", "case-count-only", "weather-only", "random"] as const;
export type TierMethod = (typeof TIER_METHODS)[number];

export interface TierOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  /** Capacity is evaluated for k = 1 .. maxK teams. */
  maxK: number;
  /** Team counts at which "how often does Tier 1 ask for more than that" is reported. */
  overCapacityKs: number[];
  caseDelayWeeks?: number;
  /** Random orders averaged for the random baseline. */
  randomShuffles?: number;
  outbreakFraction?: number;
  leadWeeks?: number;
  params?: ModelParameters;
}

export const TIER1_METRICS = ["precisionAnyCases", "precisionNewOutbreak", "coverageBeforeOnset"] as const;
export type Tier1Metric = (typeof TIER1_METRICS)[number];

export interface Tier1Row {
  method: TierMethod;
  metric: Tier1Metric;
  value: Interval;
}

export interface BurdenRow {
  metric: "flaggedPerWeek" | "shareOfBarangaysFlagged" | "shareFromClusterOnly" | "weeksOverCapacity";
  /** Only for weeksOverCapacity: the number of teams. */
  k: number | null;
  value: Interval;
}

export interface CapacityRow {
  method: TierMethod;
  k: number;
  value: Interval;
}

export interface Tier2Report {
  /** The property check: how many (score, purok counts) combinations were tried and how many broke the rule. */
  property: { checks: number; violations: number };
  /** Share of all barangay-weeks in which Tier 2 was unlocked. */
  shareOfBarangayWeeks: Interval;
  unlockedPerWeek: Interval;
  /** Of the unlocked puroks: the share that still had cases in the following two weeks. */
  shareStillWithCases: Interval;
  /** Of the barangay-weeks with Tier 2 unlocked: the share whose score alone was below the Tier 1 threshold. */
  shareBelowTier1Score: Interval;
}

export interface TierReport {
  settings: { barangays: number; weeks: number; seeds: number; maxK: number; caseDelayWeeks: number; randomShuffles: number; warningWeeks: number; tier1ScoreThreshold: number; tier2MinCases: number };
  tier1: Tier1Row[];
  burden: BurdenRow[];
  capacity: CapacityRow[];
  tier2: Tier2Report;
}

// ---- the Tier 2 property check ----------------------------------------------------------------

/**
 * Tier 2 must unlock exactly when one purok has the minimum number of cases, whatever the score is.
 * Sweeps scores against purok case counts (including the boundary) and counts any combination that
 * breaks that.
 */
export function checkTier2Property(params: ModelParameters = DEFAULT_PARAMETERS): { checks: number; violations: number } {
  const min = params.constants.tier2.minCases;
  const scores = [0, 10, 25, 39, 40, 55, 70, 99, 100];
  const purokSets: number[][] = [
    [],
    [0],
    [min - 1],
    [min - 1, min - 1, min - 1, min - 1, min - 1, min - 1, min - 1, min - 1],
    [0, 0, min, 0],
    [min],
    [min + 7],
    [min - 1, min],
    [1, 1, 1, 1, 1],
  ];
  let checks = 0;
  let violations = 0;
  for (const score100 of scores) {
    for (const counts of purokSets) {
      const purokCases: PurokCases[] = counts.map((cases, i) => ({ purok: `P${i}`, cases }));
      const expected = counts.some((c) => c >= min);
      const result = recommendedAction(score100, purokCases, params);
      checks++;
      // Tier 2 follows the case rule only; and a cluster always brings Tier 1 with it.
      if (result.tier2.unlocked !== expected || (expected && result.action !== "tier1")) violations++;
    }
  }
  return { checks, violations };
}

// ---- one simulated municipality ---------------------------------------------------------------

export interface SeedTiers {
  tier1: Record<TierMethod, Record<Tier1Metric, number>>;
  /** Barangays recommended over all the evaluated weeks, per method (random: the average over its shuffles). Equal workload means these are equal. */
  flagged: Record<TierMethod, number>;
  burden: { flaggedPerWeek: number; shareOfBarangaysFlagged: number; shareFromClusterOnly: number; weeksOver: number[] };
  capacity: Record<TierMethod, number[]>; // coverage at k = 1 .. maxK
  tier2: { shareOfBarangayWeeks: number; unlockedPerWeek: number; shareStillWithCases: number; shareBelowTier1Score: number };
}

type Resolved = Required<Pick<TierOptions, "maxK" | "overCapacityKs" | "caseDelayWeeks" | "randomShuffles">> & { params: ModelParameters };

/** rank[b] = position of barangay b in the order (0 = highest). */
function rankOf(order: ArrayLike<number>): Int32Array {
  const rank = new Int32Array(order.length);
  for (let i = 0; i < order.length; i++) rank[order[i]] = i;
  return rank;
}

/** The purok case counts the live service shows for barangay b at the end of week t (the last two known case weeks). */
function purokCasesAt(d: SimData, b: number, t: number, caseDelayWeeks: number): PurokCases[] {
  const latest = latestCaseWeek(t, caseDelayWeeks);
  const out: PurokCases[] = [];
  for (let p = 0; p < d.purokCount[b]; p++) {
    let cases = 0;
    for (const w of [latest, latest - 1]) if (w >= 0) cases += d.cases[caseIndex(d, b, w, p)];
    out.push({ purok: `P${p}`, cases });
  }
  return out;
}

const ratio = (num: number, den: number): number => (den === 0 ? NaN : num / den);

/** Pooled counts of one method over the evaluated weeks. */
class Pool {
  flagged = 0;
  anyCases = 0;
  newOutbreak = 0;
}

export function evaluateTierSeed(d: SimData, seed: number, o: Resolved): SeedTiers {
  const n = d.barangays;
  const ratios = densityRatios(d);
  const { first, last } = evaluableWeeks(d, o.caseDelayWeeks);
  const weeksEvaluated = last - first + 1;
  const tier1Points = toPoints(o.params.constants.tier1Threshold);

  // The outbreaks that have at least one evaluated week in the warning window before their cases jump.
  const outbreaks: { b: number; lo: number; hi: number }[] = [];
  for (let b = 0; b < n; b++) {
    if (d.onsetWeek[b] < 0) continue;
    const lo = Math.max(first, d.onsetWeek[b] - WARNING_WEEKS);
    const hi = Math.min(last, d.onsetWeek[b] - 1);
    if (lo <= hi) outbreaks.push({ b, lo, hi });
  }
  const count = outbreaks.length;
  const S = o.randomShuffles;

  // Per method (random: per shuffle): the best (lowest) rank each outbreak reached in its window, and
  // whether it was ever among the barangays recommended at the equal workload.
  const bestRank: Record<TierMethod, Int32Array[]> = {
    AeDispatch: [new Int32Array(count).fill(1 << 30)],
    "case-count-only": [new Int32Array(count).fill(1 << 30)],
    "weather-only": [new Int32Array(count).fill(1 << 30)],
    random: Array.from({ length: S }, () => new Int32Array(count).fill(1 << 30)),
  };
  const everFlagged: Record<TierMethod, Uint8Array[]> = {
    AeDispatch: [new Uint8Array(count)],
    "case-count-only": [new Uint8Array(count)],
    "weather-only": [new Uint8Array(count)],
    random: Array.from({ length: S }, () => new Uint8Array(count)),
  };
  const pools: Record<TierMethod, Pool[]> = {
    AeDispatch: [new Pool()],
    "case-count-only": [new Pool()],
    "weather-only": [new Pool()],
    random: Array.from({ length: S }, () => new Pool()),
  };

  const flaggedPerWeek: number[] = [];
  let fromCluster = 0;
  let totalFlags = 0;
  let unlockedBarangayWeeks = 0;
  let unlockedBelowTier1 = 0;
  let unlockedPuroks = 0;
  let unlockedPuroksWithCases = 0;

  const rng = mulberry32(seed * 104729 + 17);

  for (let t = first; t <= last; t++) {
    const future = futureCases(d, t);
    const scores = scoreAll(d, t, ratios, { params: o.params, caseDelayWeeks: o.caseDelayWeeks });
    const futureOf = (b: number) => future[b] > 0;
    const startsSoon = (b: number) => d.onsetWeek[b] >= t + 1 && d.onsetWeek[b] <= t + 2;
    const active = outbreaks.map((ob, i) => ({ ...ob, i })).filter((ob) => t >= ob.lo && t <= ob.hi);

    // The real rule: Tier 1 from the score or from an open Tier 2 cluster.
    const tier1 = new Uint8Array(n);
    let m = 0;
    for (let b = 0; b < n; b++) {
      const score100 = Math.round(scores[b] * 100);
      const rec = recommendedAction(score100, purokCasesAt(d, b, t, o.caseDelayWeeks), o.params);
      if (rec.action === "tier1") {
        tier1[b] = 1;
        m++;
        if (score100 < tier1Points) fromCluster++;
      }
      if (rec.tier2.unlocked) {
        unlockedBarangayWeeks++;
        if (score100 < tier1Points) unlockedBelowTier1++;
        for (const p of rec.tier2.puroks) {
          unlockedPuroks++;
          const index = Number(p.purok.slice(1));
          let later = 0;
          for (const w of [t + 1, t + 2]) later += d.cases[caseIndex(d, b, w, index)];
          if (later > 0) unlockedPuroksWithCases++;
        }
      }
    }
    totalFlags += m;
    flaggedPerWeek.push(m);

    // AeDispatch at its own workload (the barangays the rule recommends).
    const aeOrder = orderByScore(scores);
    const aeRank = rankOf(aeOrder);
    const ae = pools.AeDispatch[0];
    for (let b = 0; b < n; b++) {
      if (tier1[b] === 0) continue;
      ae.flagged++;
      if (futureOf(b)) ae.anyCases++;
      if (startsSoon(b)) ae.newOutbreak++;
    }
    for (const ob of active) {
      if (tier1[ob.b] === 1) everFlagged.AeDispatch[0][ob.i] = 1;
      if (aeRank[ob.b] < bestRank.AeDispatch[0][ob.i]) bestRank.AeDispatch[0][ob.i] = aeRank[ob.b];
    }

    // The baselines: the same NUMBER of barangays as AeDispatch recommended this week, taken from the top of their rankings.
    const baselineOrders: [TierMethod, Int32Array][] = [
      ["case-count-only", orderByScore(caseCountScores(d, t, o.caseDelayWeeks))],
      ["weather-only", orderByScore(weatherOnlyScores(d, t, ratios, o.params))],
    ];
    const apply = (method: TierMethod, order: Int32Array, which: number) => {
      const rank = rankOf(order);
      const pool = pools[method][which];
      for (let i = 0; i < m; i++) {
        const b = order[i];
        pool.flagged++;
        if (futureOf(b)) pool.anyCases++;
        if (startsSoon(b)) pool.newOutbreak++;
      }
      for (const ob of active) {
        if (rank[ob.b] < m) everFlagged[method][which][ob.i] = 1;
        if (rank[ob.b] < bestRank[method][which][ob.i]) bestRank[method][which][ob.i] = rank[ob.b];
      }
    };
    for (const [method, order] of baselineOrders) apply(method, order, 0);
    for (let s = 0; s < S; s++) apply("random", randomOrder(n, rng), s);
  }

  // ---- per-seed summaries ----
  const meanOf = (values: number[]) => mean(values.filter(Number.isFinite));
  const tier1 = {} as SeedTiers["tier1"];
  const capacity = {} as SeedTiers["capacity"];
  const flagged = {} as SeedTiers["flagged"];
  for (const method of TIER_METHODS) {
    flagged[method] = meanOf(pools[method].map((pool) => pool.flagged));
    const perRun = pools[method].map((pool, i) => ({
      anyCases: ratio(pool.anyCases, pool.flagged),
      newOutbreak: ratio(pool.newOutbreak, pool.flagged),
      coverage: ratio(everFlagged[method][i].reduce((a, b) => a + b, 0), count),
    }));
    tier1[method] = {
      precisionAnyCases: meanOf(perRun.map((r) => r.anyCases)),
      precisionNewOutbreak: meanOf(perRun.map((r) => r.newOutbreak)),
      coverageBeforeOnset: meanOf(perRun.map((r) => r.coverage)),
    };
    capacity[method] = Array.from({ length: o.maxK }, (_, ki) =>
      meanOf(bestRank[method].map((ranks) => ratio(ranks.filter((r) => r < ki + 1).length, count))),
    );
  }

  return {
    tier1,
    flagged,
    burden: {
      flaggedPerWeek: mean(flaggedPerWeek),
      shareOfBarangaysFlagged: mean(flaggedPerWeek) / n,
      shareFromClusterOnly: ratio(fromCluster, totalFlags),
      weeksOver: o.overCapacityKs.map((k) => flaggedPerWeek.filter((x) => x > k).length / weeksEvaluated),
    },
    capacity,
    tier2: {
      shareOfBarangayWeeks: unlockedBarangayWeeks / (n * weeksEvaluated),
      unlockedPerWeek: unlockedBarangayWeeks / weeksEvaluated,
      shareStillWithCases: ratio(unlockedPuroksWithCases, unlockedPuroks),
      shareBelowTier1Score: ratio(unlockedBelowTier1, unlockedBarangayWeeks),
    },
  };
}

// ---- the whole run ------------------------------------------------------------------------------

export function runTiers(opts: TierOptions): TierReport {
  const params = opts.params ?? DEFAULT_PARAMETERS;
  const caseDelayWeeks = opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS;
  const randomShuffles = opts.randomShuffles ?? 100;
  const resolved: Resolved = { maxK: opts.maxK, overCapacityKs: opts.overCapacityKs, caseDelayWeeks, randomShuffles, params };

  const results = opts.seeds.map((seed) => {
    const d = generate({ barangays: opts.barangays, weeks: opts.weeks, seed, outbreakFraction: opts.outbreakFraction, leadWeeks: opts.leadWeeks });
    return evaluateTierSeed(d, seed, resolved);
  });
  const ci = (values: number[], seed: number): Interval => bootstrapCI(values, 2000, seed);

  const tier1: Tier1Row[] = [];
  for (const method of TIER_METHODS) {
    for (const metric of TIER1_METRICS) tier1.push({ method, metric, value: ci(results.map((r) => r.tier1[method][metric]), 21) });
  }
  const burden: BurdenRow[] = [
    { metric: "flaggedPerWeek", k: null, value: ci(results.map((r) => r.burden.flaggedPerWeek), 23) },
    { metric: "shareOfBarangaysFlagged", k: null, value: ci(results.map((r) => r.burden.shareOfBarangaysFlagged), 25) },
    { metric: "shareFromClusterOnly", k: null, value: ci(results.map((r) => r.burden.shareFromClusterOnly), 27) },
    ...opts.overCapacityKs.map((k, i): BurdenRow => ({ metric: "weeksOverCapacity", k, value: ci(results.map((r) => r.burden.weeksOver[i]), 29) })),
  ];
  const capacity: CapacityRow[] = [];
  for (const method of TIER_METHODS) {
    for (let k = 1; k <= opts.maxK; k++) capacity.push({ method, k, value: ci(results.map((r) => r.capacity[method][k - 1]), 31) });
  }

  return {
    settings: {
      barangays: opts.barangays,
      weeks: opts.weeks,
      seeds: opts.seeds.length,
      maxK: opts.maxK,
      caseDelayWeeks,
      randomShuffles,
      warningWeeks: WARNING_WEEKS,
      tier1ScoreThreshold: toPoints(params.constants.tier1Threshold),
      tier2MinCases: params.constants.tier2.minCases,
    },
    tier1,
    burden,
    capacity,
    tier2: {
      property: checkTier2Property(params),
      shareOfBarangayWeeks: ci(results.map((r) => r.tier2.shareOfBarangayWeeks), 33),
      unlockedPerWeek: ci(results.map((r) => r.tier2.unlockedPerWeek), 35),
      shareStillWithCases: ci(results.map((r) => r.tier2.shareStillWithCases), 37),
      shareBelowTier1Score: ci(results.map((r) => r.tier2.shareBelowTier1Score), 39),
    },
  };
}

// ---- console table and CSV ------------------------------------------------------------------------

const f = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : "n/a");
const cell = (i: Interval, digits = 2): string => `${f(i.mean, digits)} [${f(i.low, digits)}, ${f(i.high, digits)}]`;

export function formatTiers(r: TierReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Tier 1, capacity and Tier 2: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, case data ${s.caseDelayWeeks} week(s) late.`);
  lines.push("Each cell: mean over seeds [95% interval]. Simulated data.\n");

  lines.push(`(a) Tier 1 = a score of ${s.tier1ScoreThreshold} or more, or an open Tier 2 cluster. The baselines recommend the SAME number of barangays each week.`);
  lines.push(`    Followed by cases = cases in the next 2 weeks (running outbreaks count). New outbreak = an outbreak that starts in the next 2 weeks.`);
  lines.push(`    Caught = share of outbreaks recommended at least once in the ${s.warningWeeks} weeks before their cases jumped.`);
  lines.push(["method".padEnd(16), "followed by cases".padEnd(22), "new outbreak".padEnd(22), "caught before onset"].join(" "));
  for (const m of TIER_METHODS) {
    const pick = (metric: Tier1Metric) => r.tier1.find((x) => x.method === m && x.metric === metric)!.value;
    lines.push([m.padEnd(16), cell(pick("precisionAnyCases")).padEnd(22), cell(pick("precisionNewOutbreak")).padEnd(22), cell(pick("coverageBeforeOnset"))].join(" "));
  }
  const burden = (metric: BurdenRow["metric"], k: number | null = null) => r.burden.find((x) => x.metric === metric && x.k === k)!.value;
  lines.push(`\n    Burden of the Tier 1 rule: ${f(burden("flaggedPerWeek").mean, 1)} barangays a week (${f(burden("shareOfBarangaysFlagged").mean * 100, 1)}% of all); ${f(burden("shareFromClusterOnly").mean * 100, 0)}% of them only because of an open Tier 2 cluster.`);
  for (const b of r.burden.filter((x) => x.metric === "weeksOverCapacity")) {
    lines.push(`    Weeks in which Tier 1 asks for more than ${b.k} teams: ${f(b.value.mean * 100, 0)}% of weeks`);
  }

  lines.push(`\n(b) Capacity: share of outbreaks within the top k at least once in the ${s.warningWeeks} weeks before their cases jumped.`);
  const ksShown = [1, 2, 3, 5, 10, 15, 20].filter((k) => k <= s.maxK);
  lines.push(["method".padEnd(16), ...ksShown.map((k) => `k=${k}`.padEnd(7))].join(" "));
  for (const m of TIER_METHODS) {
    lines.push([m.padEnd(16), ...ksShown.map((k) => f(r.capacity.find((x) => x.method === m && x.k === k)!.value.mean).padEnd(7))].join(" "));
  }

  const t2 = r.tier2;
  lines.push(`\n(c) Tier 2 (fogging review) follows the case rule: one purok with ${s.tier2MinCases} or more cases in the last 2 case weeks.`);
  lines.push(`    Property check: ${t2.property.checks} combinations of score (0 to 100) and purok counts, ${t2.property.violations} broke the rule.`);
  lines.push(`    Unlocked in ${f(t2.shareOfBarangayWeeks.mean * 100, 1)}% of barangay-weeks (${f(t2.unlockedPerWeek.mean, 1)} barangays a week).`);
  lines.push(`    Of the unlocked puroks, ${f(t2.shareStillWithCases.mean * 100, 0)}% still had cases in the following 2 weeks.`);
  lines.push(`    ${f(t2.shareBelowTier1Score.mean * 100, 0)}% of the unlocked barangay-weeks had a score below ${s.tier1ScoreThreshold}: without the rule "Tier 1 also where a cluster is open" they would have read Monitor.`);
  return lines.join("\n");
}

/** One row per number: tiers.csv. */
export function tiersCsv(r: TierReport): string {
  const out = ["section,method,metric,k,mean,low,high"];
  for (const x of r.tier1) out.push(["tier1", x.method, x.metric, "", x.value.mean, x.value.low, x.value.high].join(","));
  for (const x of r.burden) out.push(["burden", "AeDispatch", x.metric, x.k ?? "", x.value.mean, x.value.low, x.value.high].join(","));
  const t2 = r.tier2;
  out.push(["tier2", "AeDispatch", "property_checks", "", t2.property.checks, "", ""].join(","));
  out.push(["tier2", "AeDispatch", "property_violations", "", t2.property.violations, "", ""].join(","));
  for (const [metric, value] of [
    ["shareOfBarangayWeeks", t2.shareOfBarangayWeeks],
    ["unlockedPerWeek", t2.unlockedPerWeek],
    ["shareStillWithCases", t2.shareStillWithCases],
    ["shareBelowTier1Score", t2.shareBelowTier1Score],
  ] as [string, Interval][]) {
    out.push(["tier2", "AeDispatch", metric, "", value.mean, value.low, value.high].join(","));
  }
  return out.join("\n") + "\n";
}

/** One row per method and k: capacity.csv. */
export function capacityCsv(r: TierReport): string {
  const out = ["method,k,coverage_mean,coverage_low,coverage_high"];
  for (const x of r.capacity) out.push([x.method, x.k, x.value.mean, x.value.low, x.value.high].join(","));
  return out.join("\n") + "\n";
}
