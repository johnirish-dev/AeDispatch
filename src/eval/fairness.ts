// Objective 3: is anyone left behind?
//
// AeDispatch listens to what residents send (daily answers, household reports, symptom checks). A
// barangay that sends little, because it is small or because few people there use the app, gives the
// ranking less to go on. Does that put it at a disadvantage when an outbreak starts there?
//
// For each GROUP of barangays this measures what share of the group's outbreaks were within the top k
// at least once in the warning weeks before their cases jumped (the same "caught early" measure as the
// ranking-quality and capacity runs), for AeDispatch and for each baseline. The baselines matter here:
// ranking by case counts does not depend on reporting at all, so it shows what a ranking that ignores
// reports would do for the same group.
//
// Groups: barangays split by population into thirds (small, middle, large), and, in a municipality
// where 30 percent of the barangays send only a quarter as many reports (the simulator's option for
// uneven reporting), the barangays that report as usual against those that report little. A control run
// with even reporting shows how much of any gap is due to reporting and how much to size.
//
// For each grouping and method the report gives the ratio of the worst group to the best group (1 = no
// group is left behind) and the gap between them with an interval. A low-reporting group that is missed
// is a result to report, not to hide.

import { Interval, bootstrapCI, mean } from "../algorithms/metrics";
import { DEFAULT_PARAMETERS, ModelParameters } from "../algorithms/parameters";
import { SimData, generate, lowReportingBarangays } from "../sim/generator";
import { mulberry32 } from "../sim/random";
import { caseCountScores, orderByScore, randomOrder } from "./baselines";
import { WARNING_WEEKS } from "./quality";
import { DEFAULT_CASE_DELAY_WEEKS, densityRatios, evaluableWeeks, scoreAll, weatherOnlyScores } from "./rank";

export const FAIRNESS_METHODS = ["AeDispatch", "case-count-only", "weather-only", "random"] as const;
export type FairnessMethod = (typeof FAIRNESS_METHODS)[number];

export type Grouping = "size" | "reporting";

export interface FairnessOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  /** The numbers of barangays that can be reached (top k). */
  ks: number[];
  /** Share of the barangays that report little in the uneven scenario, and how much of the usual they send. */
  lowReportingShare: number;
  lowReportingRate: number;
  caseDelayWeeks?: number;
  randomShuffles?: number;
  params?: ModelParameters;
}

export const SCENARIOS = ["even reporting", "uneven reporting"] as const;
export type FairnessScenario = (typeof SCENARIOS)[number];

export const SIZE_GROUPS = ["small third", "middle third", "large third"] as const;
export const REPORTING_GROUPS = ["reports as usual", "reports little"] as const;

/**
 * Which groupings are read in which scenario. In the control (even reporting) the "reports little" group is the
 * same set of barangays as in the uneven run, but they report as usual: it shows what the low reporting itself costs.
 */
export const GROUPINGS: Record<FairnessScenario, Grouping[]> = {
  "even reporting": ["size", "reporting"],
  "uneven reporting": ["size", "reporting"],
};

export const groupsOf = (grouping: Grouping): readonly string[] => (grouping === "size" ? SIZE_GROUPS : REPORTING_GROUPS);

export interface GroupRow {
  scenario: FairnessScenario;
  grouping: Grouping;
  group: string;
  method: FairnessMethod;
  k: number;
  /** Share of the group's outbreaks within the top k before their cases jumped. */
  caught: Interval;
  /** Outbreaks of the group that were evaluated, per simulated municipality (on average). */
  outbreaks: number;
}

export interface GapRow {
  scenario: FairnessScenario;
  grouping: Grouping;
  method: FairnessMethod;
  k: number;
  bestGroup: string;
  worstGroup: string;
  /** Worst group divided by best group, per municipality. 1 means no group is left behind. */
  ratio: Interval;
  /** Best group minus worst group (shares), per municipality. */
  gap: Interval;
  /** "clear gap" when the whole interval of the gap is above 0. */
  verdict: "clear gap" | "no clear gap";
}

/** What the low reporting itself costs the barangays that report little: their catch rate with it, without it, and the change. */
export interface CostRow {
  method: FairnessMethod;
  k: number;
  withUsualReporting: Interval;
  withLowReporting: Interval;
  /** With low reporting minus with usual reporting, per municipality. Below 0: the low reporting costs them early catches. */
  change: Interval;
  verdict: "loses ground" | "no clear change" | "gains";
}

export interface FairnessReport {
  settings: { barangays: number; weeks: number; seeds: number; ks: number[]; lowReportingShare: number; lowReportingRate: number; caseDelayWeeks: number; randomShuffles: number; warningWeeks: number };
  groups: GroupRow[];
  gaps: GapRow[];
  costs: CostRow[];
}

// ---- one simulated municipality ---------------------------------------------------------------

/** rank[b] = place of barangay b in the order (0 = highest). */
function rankOf(order: ArrayLike<number>): Int32Array {
  const rank = new Int32Array(order.length);
  for (let i = 0; i < order.length; i++) rank[order[i]] = i;
  return rank;
}

/** The group of every barangay for one grouping: 0, 1, 2 for size (small to large), 0 or 1 for reporting. */
export function groupIndex(d: SimData, grouping: Grouping, lowReporters: Set<number>): Int8Array {
  const n = d.barangays;
  const out = new Int8Array(n);
  if (grouping === "reporting") {
    for (let b = 0; b < n; b++) out[b] = lowReporters.has(b) ? 1 : 0;
    return out;
  }
  const bySize = Array.from({ length: n }, (_, b) => b).sort((a, b) => d.population[a] - d.population[b] || a - b);
  bySize.forEach((b, i) => {
    out[b] = Math.min(2, Math.floor((3 * i) / n));
  });
  return out;
}

interface SeedFairness {
  /** coverage[grouping][method][k index][group index] (NaN when the group had no outbreak to evaluate). */
  caught: Record<Grouping, Record<FairnessMethod, number[][]>>;
  outbreaks: Record<Grouping, number[]>;
}

export function evaluateFairnessSeed(d: SimData, seed: number, ks: number[], caseDelayWeeks: number, randomShuffles: number, params: ModelParameters, groupings: Grouping[], lowReporters: Set<number>): SeedFairness {
  const n = d.barangays;
  const ratios = densityRatios(d);
  const { first, last } = evaluableWeeks(d, caseDelayWeeks);

  const outbreaks: { b: number; lo: number; hi: number }[] = [];
  for (let b = 0; b < n; b++) {
    if (d.onsetWeek[b] < 0) continue;
    const lo = Math.max(first, d.onsetWeek[b] - WARNING_WEEKS);
    const hi = Math.min(last, d.onsetWeek[b] - 1);
    if (lo <= hi) outbreaks.push({ b, lo, hi });
  }

  // The best (lowest) place each outbreak reached in its warning weeks, per method; the random baseline per shuffle.
  const S = randomShuffles;
  const best: Record<FairnessMethod, Int32Array[]> = {
    AeDispatch: [new Int32Array(outbreaks.length).fill(1 << 30)],
    "case-count-only": [new Int32Array(outbreaks.length).fill(1 << 30)],
    "weather-only": [new Int32Array(outbreaks.length).fill(1 << 30)],
    random: Array.from({ length: S }, () => new Int32Array(outbreaks.length).fill(1 << 30)),
  };
  const rng = mulberry32(seed * 91 + 5);
  for (let t = first; t <= last; t++) {
    const active = outbreaks.map((ob, i) => ({ ...ob, i })).filter((ob) => t >= ob.lo && t <= ob.hi);
    if (active.length === 0) continue;
    const record = (method: FairnessMethod, order: ArrayLike<number>, which: number) => {
      const rank = rankOf(order);
      for (const ob of active) if (rank[ob.b] < best[method][which][ob.i]) best[method][which][ob.i] = rank[ob.b];
    };
    record("AeDispatch", orderByScore(scoreAll(d, t, ratios, { params, caseDelayWeeks })), 0);
    record("case-count-only", orderByScore(caseCountScores(d, t, caseDelayWeeks)), 0);
    record("weather-only", orderByScore(weatherOnlyScores(d, t, ratios, params)), 0);
    for (let s = 0; s < S; s++) record("random", randomOrder(n, rng), s);
  }

  const caught = {} as SeedFairness["caught"];
  const counts = {} as SeedFairness["outbreaks"];
  for (const grouping of groupings) {
    const index = groupIndex(d, grouping, lowReporters);
    const groupCount = groupsOf(grouping).length;
    counts[grouping] = Array.from({ length: groupCount }, (_, g) => outbreaks.filter((ob) => index[ob.b] === g).length);
    caught[grouping] = {} as Record<FairnessMethod, number[][]>;
    for (const method of FAIRNESS_METHODS) {
      caught[grouping][method] = ks.map((k) =>
        Array.from({ length: groupCount }, (_, g) => {
          const members = outbreaks.map((ob, i) => ({ ob, i })).filter((x) => index[x.ob.b] === g);
          if (members.length === 0) return NaN;
          // The random baseline: the average over its shuffles.
          const perRun = best[method].map((ranks) => members.filter((x) => ranks[x.i] < k).length / members.length);
          return mean(perRun);
        }),
      );
    }
  }
  return { caught, outbreaks: counts };
}

// ---- the whole run ----------------------------------------------------------------------------------

export function runFairness(opts: FairnessOptions): FairnessReport {
  const params = opts.params ?? DEFAULT_PARAMETERS;
  const caseDelayWeeks = opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS;
  const randomShuffles = opts.randomShuffles ?? 30;

  const perScenario = {} as Record<FairnessScenario, SeedFairness[]>;
  for (const scenario of SCENARIOS) {
    perScenario[scenario] = opts.seeds.map((seed) => {
      const d = generate({
        barangays: opts.barangays,
        weeks: opts.weeks,
        seed,
        lowReportingShare: scenario === "uneven reporting" ? opts.lowReportingShare : 0,
        lowReportingRate: opts.lowReportingRate,
      });
      // The same barangays are the "low reporters" in both scenarios; only in the uneven one do they really report little.
      const lowReporters = lowReportingBarangays(seed, opts.barangays, opts.lowReportingShare);
      if (scenario === "uneven reporting" && [...lowReporters].some((b) => d.reportingRate[b] >= 1)) {
        throw new Error("The group that reports little is not the set of barangays the simulator thinned: the comparison would be meaningless.");
      }
      return evaluateFairnessSeed(d, seed, opts.ks, caseDelayWeeks, randomShuffles, params, GROUPINGS[scenario], lowReporters);
    });
  }

  const groups: GroupRow[] = [];
  const gaps: GapRow[] = [];
  const costs: CostRow[] = [];
  for (const scenario of SCENARIOS) {
    for (const grouping of GROUPINGS[scenario]) {
      const names = groupsOf(grouping);
      for (const method of FAIRNESS_METHODS) {
        opts.ks.forEach((k, ki) => {
          const perSeed = perScenario[scenario].map((r) => r.caught[grouping][method][ki]); // [seed][group]
          const means = names.map((_, g) => bootstrapCI(perSeed.map((row) => row[g]), 2000, 51));
          names.forEach((group, g) => {
            groups.push({ scenario, grouping, group, method, k, caught: means[g], outbreaks: mean(perScenario[scenario].map((r) => r.outbreaks[grouping][g])) });
          });
          // Best and worst group by their mean over the municipalities; the ratio and the gap per municipality.
          const finite = means.map((m, g) => ({ g, m: m.mean })).filter((x) => Number.isFinite(x.m));
          if (finite.length < 2) return;
          const bestG = finite.reduce((a, b) => (b.m > a.m ? b : a)).g;
          const worstG = finite.reduce((a, b) => (b.m < a.m ? b : a)).g;
          const ratio = bootstrapCI(perSeed.map((row) => (row[bestG] > 0 ? row[worstG] / row[bestG] : NaN)), 2000, 53);
          const gap = bootstrapCI(perSeed.map((row) => row[bestG] - row[worstG]), 2000, 55);
          gaps.push({ scenario, grouping, method, k, bestGroup: names[bestG], worstGroup: names[worstG], ratio, gap, verdict: gap.low > 0 ? "clear gap" : "no clear gap" });
        });
      }
    }
  }
  // The control: the same barangays ("reports little" in the uneven run), with and without the low reporting.
  for (const method of FAIRNESS_METHODS) {
    opts.ks.forEach((k, ki) => {
      const pick = (scenario: FairnessScenario) => perScenario[scenario].map((r) => r.caught.reporting[method][ki][1]);
      const usual = pick("even reporting");
      const little = pick("uneven reporting");
      const change = bootstrapCI(little.map((v, i) => v - usual[i]), 2000, 57);
      costs.push({ method, k, withUsualReporting: bootstrapCI(usual, 2000, 59), withLowReporting: bootstrapCI(little, 2000, 61), change, verdict: change.high < 0 ? "loses ground" : change.low > 0 ? "gains" : "no clear change" });
    });
  }
  return {
    settings: { barangays: opts.barangays, weeks: opts.weeks, seeds: opts.seeds.length, ks: opts.ks, lowReportingShare: opts.lowReportingShare, lowReportingRate: opts.lowReportingRate, caseDelayWeeks, randomShuffles, warningWeeks: WARNING_WEEKS },
    groups,
    gaps,
    costs,
  };
}

// ---- console table and CSV ------------------------------------------------------------------------------

const f = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : "n/a");

export function formatFairness(r: FairnessReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Fairness by group: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds. Simulated data.`);
  lines.push(`Each cell: the share of a group's outbreaks that were within the top k at least once in the ${s.warningWeeks} weeks before their cases jumped.`);
  lines.push(`"uneven reporting": ${f(s.lowReportingShare * 100, 0)}% of the barangays send only ${f(s.lowReportingRate * 100, 0)}% as many reports as the others.`);
  lines.push("Worst / best = the worst group's share divided by the best group's (1 means no group is left behind).\n");
  for (const scenario of SCENARIOS) {
    for (const grouping of GROUPINGS[scenario]) {
      for (const k of s.ks) {
        const names = groupsOf(grouping);
        lines.push(`${scenario}, groups by ${grouping}, top ${k}`);
        lines.push(["method".padEnd(16), ...names.map((n) => n.padEnd(18)), "worst / best".padEnd(13), "gap (best - worst)"].join(" "));
        for (const method of FAIRNESS_METHODS) {
          const cells = names.map((n) => {
            const row = r.groups.find((x) => x.scenario === scenario && x.grouping === grouping && x.method === method && x.k === k && x.group === n)!;
            return `${f(row.caught.mean)} (${f(row.outbreaks, 0)} outbreaks)`.padEnd(18);
          });
          const gap = r.gaps.find((x) => x.scenario === scenario && x.grouping === grouping && x.method === method && x.k === k);
          const text = gap ? `${f(gap.ratio.mean)}`.padEnd(13) : "n/a".padEnd(13);
          const detail = gap ? `${f(gap.gap.mean)} [${f(gap.gap.low)}, ${f(gap.gap.high)}] ${gap.verdict} (${gap.worstGroup} is behind)` : "";
          lines.push([method.padEnd(16), ...cells, text, detail].join(" "));
        }
        lines.push("");
      }
    }
  }
  lines.push("What the low reporting itself costs (the barangays that report little, in the same municipality, with and without the thinning):");
  lines.push(["method".padEnd(16), "top k".padEnd(6), "reporting as usual".padEnd(20), "reporting little".padEnd(20), "change"].join(" "));
  for (const c of r.costs) {
    lines.push([c.method.padEnd(16), String(c.k).padEnd(6), f(c.withUsualReporting.mean).padEnd(20), f(c.withLowReporting.mean).padEnd(20), `${f(c.change.mean)} [${f(c.change.low)}, ${f(c.change.high)}] ${c.verdict}`].join(" "));
  }
  return lines.join("\n").trimEnd();
}

/** One row per group and method (and k), then one row per ratio and per gap: fairness.csv. */
export function fairnessCsv(r: FairnessReport): string {
  const out = ["kind,scenario,grouping,group,method,k,mean,low,high,note"];
  for (const x of r.groups) out.push(["group", x.scenario, x.grouping, x.group, x.method, x.k, x.caught.mean, x.caught.low, x.caught.high, `outbreaks=${x.outbreaks}`].join(","));
  for (const x of r.gaps) {
    out.push(["ratio_worst_over_best", x.scenario, x.grouping, `${x.worstGroup} over ${x.bestGroup}`, x.method, x.k, x.ratio.mean, x.ratio.low, x.ratio.high, ""].join(","));
    out.push(["gap_best_minus_worst", x.scenario, x.grouping, `${x.bestGroup} minus ${x.worstGroup}`, x.method, x.k, x.gap.mean, x.gap.low, x.gap.high, x.verdict].join(","));
  }
  for (const c of r.costs) out.push(["cost_of_low_reporting", "uneven reporting", "reporting", "reports little", c.method, c.k, c.change.mean, c.change.low, c.change.high, c.verdict].join(","));
  return out.join("\n") + "\n";
}
