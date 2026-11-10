// The ranking-quality experiment (Objective 3), part 1: AeDispatch against the three baselines.
//
// For each seed a simulated municipality is generated. For each week t (with full data windows
// and two future weeks) every method ranks the barangays using only data up to the end of week t.
// A ranking is judged two ways:
//   1. by ALL the confirmed cases the barangays had in weeks t+1 and t+2 (what the brief asks);
//      an outbreak that is already running keeps producing cases, so a ranking that simply
//      repeats "who has cases now" does well here;
//   2. by the outbreaks that START in weeks t+1 and t+2 (the simulator knows the onset week).
//      This is the early-warning question AeDispatch is built for;
//   3. by the same future cases per 10,000 residents (what AeDispatch ranks by), so big barangays
//      do not win simply because they have more people.
// Early warning is also read directly: for each outbreak, was the barangay among the top k in the
// WARNING_WEEKS before its cases jumped (coverage), and how many weeks before (lead).
// The per-week numbers are averaged per seed; across seeds we report the mean with a 95%
// bootstrap interval, and the paired difference AeDispatch minus each baseline per seed.
// The simulator is NOT tuned to make AeDispatch win: whatever comes out is reported.

import { DEFAULT_PARAMETERS, ModelParameters } from "../algorithms/parameters";
import { Interval, RankingJudge, Verdict, bootstrapCI, gini, mean, median, pairedDifference, verdictOf } from "../algorithms/metrics";
import { SimData, generate } from "../sim/generator";
import type { Rng } from "../sim/random";
import { mulberry32 } from "../sim/random";
import { caseCountScores, orderByScore, randomOrder } from "./baselines";
import { DEFAULT_CASE_DELAY_WEEKS, densityRatios, evaluableWeeks, futureCases, scoreAll, weatherOnlyScores } from "./rank";

export const METHODS = ["AeDispatch", "case-count-only", "weather-only", "random"] as const;
export type Method = (typeof METHODS)[number];
export const METRICS = ["precision", "ndcg", "emergingPrecision", "emergingNdcg", "ratePrecision", "rateNdcg", "gini", "coverage", "lead"] as const;
export type Metric = (typeof METRICS)[number];
const PAIRED_METRICS = ["precision", "ndcg", "emergingPrecision", "emergingNdcg", "ratePrecision", "rateNdcg"] as const;
type PairedMetric = (typeof PAIRED_METRICS)[number];

/** A recommendation counts as an early warning if it was made in this many weeks before the case jump. */
export const WARNING_WEEKS = 4;

export interface QualityOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  /** The k values (barangays that can be reached) to evaluate at. */
  ks: number[];
  caseDelayWeeks?: number;
  /** How many random orders to average per week for the random baseline. */
  randomShuffles?: number;
  /** Share of barangays that get an outbreak in the simulator. */
  outbreakFraction?: number;
  /** Weeks before the case jump at which the early signals start to rise (default 3). */
  leadWeeks?: number;
  /**
   * Damages the data the rankings can see (see degrade.ts). The judging still uses the untouched
   * data, so a damaged input only makes a ranking less informed.
   */
  degrade?: (truth: SimData, rng: Rng) => SimData;
  params?: ModelParameters;
}

type SeedResult = Record<Metric, number>;

export interface QualityRow {
  method: Method;
  k: number;
  metric: Metric;
  value: Interval;
}

export interface PairedRow {
  baseline: Method;
  k: number;
  metric: PairedMetric;
  difference: Interval;
  verdict: Verdict;
}

export interface QualityReport {
  settings: { barangays: number; weeks: number; seeds: number; ks: number[]; caseDelayWeeks: number; randomShuffles: number; warningWeeks: number };
  rows: QualityRow[];
  paired: PairedRow[];
}

/** What one method did over all the evaluated weeks of one simulated municipality, at one k. */
class Tally {
  readonly precision: number[] = [];
  readonly ndcg: number[] = [];
  readonly emergingPrecision: number[] = [];
  readonly emergingNdcg: number[] = [];
  readonly ratePrecision: number[] = [];
  readonly rateNdcg: number[] = [];
  readonly inTop: Float64Array; // weeks each barangay was in the top k (for the Gini)
  readonly member: Uint8Array; // member[b * weeks + t] = 1 when barangay b was in the top k at week t
  constructor(
    private readonly barangays: number,
    private readonly weeks: number,
  ) {
    this.inTop = new Float64Array(barangays);
    this.member = new Uint8Array(barangays * weeks);
  }
  /** Record the top k of one week's ranking. */
  recordTop(order: ArrayLike<number>, k: number, week: number): void {
    for (let i = 0; i < Math.min(k, order.length); i++) {
      const b = order[i];
      this.inTop[b]++;
      this.member[b * this.weeks + week] = 1;
    }
  }
  result(d: SimData, first: number, last: number): SeedResult {
    const leads: number[] = [];
    let outbreaks = 0;
    let warned = 0;
    for (let b = 0; b < this.barangays; b++) {
      const onset = d.onsetWeek[b];
      if (onset < 0) continue;
      const lo = Math.max(first, onset - WARNING_WEEKS);
      const hi = Math.min(last, onset - 1);
      if (lo > hi) continue; // its warning weeks are outside the evaluated weeks
      outbreaks++;
      for (let t = lo; t <= hi; t++) {
        if (this.member[b * this.weeks + t] === 1) {
          warned++;
          leads.push(onset - t);
          break; // the earliest warning in the window
        }
      }
    }
    return {
      precision: mean(this.precision),
      ndcg: mean(this.ndcg),
      emergingPrecision: mean(this.emergingPrecision),
      emergingNdcg: mean(this.emergingNdcg),
      ratePrecision: mean(this.ratePrecision),
      rateNdcg: mean(this.rateNdcg),
      gini: gini(this.inTop),
      coverage: outbreaks === 0 ? NaN : warned / outbreaks,
      lead: median(leads),
    };
  }
}

type EvalOptions = Required<Pick<QualityOptions, "ks" | "caseDelayWeeks" | "randomShuffles">> & { params: ModelParameters };

/** Runs one simulated municipality for every method and every k. */
/** `d` is what really happened (used for judging); `observed` is what the rankings can see (default: the same). */
export function evaluateSeed(d: SimData, seed: number, o: EvalOptions, observed: SimData = d): Record<Method, SeedResult[]> {
  const ratios = densityRatios(d);
  const { first, last } = evaluableWeeks(d, o.caseDelayWeeks);
  const make = () => o.ks.map(() => new Tally(d.barangays, d.weeks));
  const tallies: Record<Method, Tally[]> = { AeDispatch: make(), "case-count-only": make(), "weather-only": make(), random: make() };

  for (let t = first; t <= last; t++) {
    const future = futureCases(d, t);
    const all = new RankingJudge(future, o.ks);
    // The same future cases per 10,000 residents (what AeDispatch ranks by).
    const byRate = new RankingJudge(Float64Array.from(future, (c, b) => (c / d.population[b]) * 10000), o.ks);
    // Outbreaks that start in the next two weeks (1 for those barangays, 0 for the rest).
    const emerging = new RankingJudge(
      Float64Array.from({ length: d.barangays }, (_, b) => (d.onsetWeek[b] >= t + 1 && d.onsetWeek[b] <= t + 2 ? 1 : 0)),
      o.ks,
    );
    const orders = {
      AeDispatch: orderByScore(scoreAll(observed, t, ratios, { params: o.params, caseDelayWeeks: o.caseDelayWeeks })),
      "case-count-only": orderByScore(caseCountScores(observed, t, o.caseDelayWeeks)),
      "weather-only": orderByScore(weatherOnlyScores(observed, t, ratios, o.params)),
    };
    const rng = mulberry32(seed * 7919 + t);
    // The random baseline: the average of many random orders for the quality numbers, and one
    // of them (the first) for the "who was chosen" numbers.
    const shuffles = Array.from({ length: o.randomShuffles }, () => randomOrder(d.barangays, rng));

    o.ks.forEach((k, ki) => {
      for (const m of ["AeDispatch", "case-count-only", "weather-only"] as const) {
        const tally = tallies[m][ki];
        tally.precision.push(all.precision(orders[m], k));
        tally.ndcg.push(all.ndcg(orders[m], k));
        tally.emergingPrecision.push(emerging.precision(orders[m], k));
        tally.emergingNdcg.push(emerging.ndcg(orders[m], k));
        tally.ratePrecision.push(byRate.precision(orders[m], k));
        tally.rateNdcg.push(byRate.ndcg(orders[m], k));
        tally.recordTop(orders[m], k, t);
      }
      const r = tallies.random[ki];
      r.precision.push(mean(shuffles.map((s) => all.precision(s, k))));
      r.ndcg.push(mean(shuffles.map((s) => all.ndcg(s, k))));
      r.emergingPrecision.push(mean(shuffles.map((s) => emerging.precision(s, k))));
      r.emergingNdcg.push(mean(shuffles.map((s) => emerging.ndcg(s, k))));
      r.ratePrecision.push(mean(shuffles.map((s) => byRate.precision(s, k))));
      r.rateNdcg.push(mean(shuffles.map((s) => byRate.ndcg(s, k))));
      r.recordTop(shuffles[0], k, t);
    });
  }

  const out = {} as Record<Method, SeedResult[]>;
  for (const m of METHODS) out[m] = tallies[m].map((t) => t.result(d, first, last));
  return out;
}

const emptyMetrics = (): Record<Metric, number[]> => ({ precision: [], ndcg: [], emergingPrecision: [], emergingNdcg: [], ratePrecision: [], rateNdcg: [], gini: [], coverage: [], lead: [] });

export function runQuality(opts: QualityOptions): QualityReport {
  const caseDelayWeeks = opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS;
  const randomShuffles = opts.randomShuffles ?? 200;
  const params = opts.params ?? DEFAULT_PARAMETERS;

  // perSeed[method][ki][metric] = one value per seed
  const perSeed: Record<Method, Record<Metric, number[]>[]> = {
    AeDispatch: opts.ks.map(emptyMetrics),
    "case-count-only": opts.ks.map(emptyMetrics),
    "weather-only": opts.ks.map(emptyMetrics),
    random: opts.ks.map(emptyMetrics),
  };

  for (const seed of opts.seeds) {
    const d = generate({ barangays: opts.barangays, weeks: opts.weeks, seed, outbreakFraction: opts.outbreakFraction, leadWeeks: opts.leadWeeks });
    const observed = opts.degrade ? opts.degrade(d, mulberry32(seed * 31 + 7)) : d;
    const result = evaluateSeed(d, seed, { ks: opts.ks, caseDelayWeeks, randomShuffles, params }, observed);
    for (const m of METHODS) {
      result[m].forEach((r, ki) => {
        for (const metric of METRICS) perSeed[m][ki][metric].push(r[metric]);
      });
    }
  }

  const rows: QualityRow[] = [];
  const paired: PairedRow[] = [];
  opts.ks.forEach((k, ki) => {
    for (const m of METHODS) {
      for (const metric of METRICS) rows.push({ method: m, k, metric, value: bootstrapCI(perSeed[m][ki][metric], 2000, 11) });
    }
    for (const baseline of METHODS.filter((m) => m !== "AeDispatch")) {
      for (const metric of PAIRED_METRICS) {
        const diff = bootstrapCI(pairedDifference(perSeed.AeDispatch[ki][metric], perSeed[baseline][ki][metric]), 2000, 13);
        paired.push({ baseline, k, metric, difference: diff, verdict: verdictOf(diff) });
      }
    }
  });

  return {
    settings: { barangays: opts.barangays, weeks: opts.weeks, seeds: opts.seeds.length, ks: opts.ks, caseDelayWeeks, randomShuffles, warningWeeks: WARNING_WEEKS },
    rows,
    paired,
  };
}

const f = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : "n/a");
const cell = (i: Interval, digits = 3): string => `${f(i.mean, digits)} [${f(i.low, digits)}, ${f(i.high, digits)}]`;

const PAIRED_LABEL: Record<PairedMetric, string> = {
  precision: "all cases, Precision",
  ndcg: "all cases, NDCG",
  emergingPrecision: "new outbreaks, Precision",
  emergingNdcg: "new outbreaks, NDCG",
  ratePrecision: "per 10,000, Precision",
  rateNdcg: "per 10,000, NDCG",
};

/** A readable table for the console. */
export function formatQuality(r: QualityReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Ranking quality: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, case data ${s.caseDelayWeeks} week(s) late.`);
  lines.push("Each cell: mean over seeds [95% interval].");
  lines.push("  'All cases'     : judged by every confirmed case of the following two weeks (running outbreaks included).");
  lines.push(`  'New outbreaks' : judged by outbreaks that START in the following two weeks (the early-warning question).`);
  lines.push("  'Per 10,000'    : judged by the following two weeks' cases per 10,000 residents (what AeDispatch ranks by).");
  lines.push(`  Coverage = share of outbreaks recommended at least once in the ${s.warningWeeks} weeks before their cases jumped; Lead = weeks before the jump (median).`);
  for (const k of s.ks) {
    const pick = (m: Method, metric: Metric) => r.rows.find((x) => x.method === m && x.k === k && x.metric === metric)!.value;
    lines.push("");
    lines.push(`k = ${k}`);
    lines.push(["method".padEnd(16), "All: Precision".padEnd(22), "All: NDCG".padEnd(22), "New: Precision".padEnd(22), "New: NDCG".padEnd(22), "Rate: Precision".padEnd(22), "Rate: NDCG".padEnd(22), "Coverage".padEnd(9), "Lead".padEnd(5), "Gini"].join(" "));
    for (const m of METHODS) {
      lines.push(
        [
          m.padEnd(16),
          cell(pick(m, "precision")).padEnd(22),
          cell(pick(m, "ndcg")).padEnd(22),
          cell(pick(m, "emergingPrecision")).padEnd(22),
          cell(pick(m, "emergingNdcg")).padEnd(22),
          cell(pick(m, "ratePrecision")).padEnd(22),
          cell(pick(m, "rateNdcg")).padEnd(22),
          f(pick(m, "coverage").mean, 2).padEnd(9),
          f(pick(m, "lead").mean, 1).padEnd(5),
          f(pick(m, "gini").mean, 2),
        ].join(" "),
      );
    }
    lines.push("AeDispatch minus each baseline, paired by seed:");
    for (const p of r.paired.filter((x) => x.k === k)) {
      lines.push(`  vs ${p.baseline.padEnd(16)} ${PAIRED_LABEL[p.metric].padEnd(26)} ${cell(p.difference).padEnd(28)} -> ${p.verdict}`);
    }
  }
  lines.push("");
  lines.push("Simulated data: these numbers say how the method behaves when early signals exist, not how accurate it is in the real world.");
  return lines.join("\n");
}

/** CSV text for the quality table. */
export function qualityCsv(r: QualityReport): string {
  const out = ["kind,method,k,metric,mean,low,high,verdict"];
  for (const x of r.rows) out.push(["value", x.method, x.k, x.metric, x.value.mean, x.value.low, x.value.high, ""].join(","));
  for (const x of r.paired) out.push(["paired_difference", `AeDispatch-minus-${x.baseline}`, x.k, x.metric, x.difference.mean, x.difference.low, x.difference.high, x.verdict].join(","));
  return out.join("\n") + "\n";
}
