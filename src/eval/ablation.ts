// Objective 1: does the scoring model earn its five sources, and does the smoothing help?
//
// Part A, leave-one-source-out. The ranking is made again with each of the five factors removed in
// turn, and compared with the ranking of the full model on the same weeks and the same simulated
// municipalities. What a source ADDS is the full model minus the model without it. For this
// experiment only, the remaining weights are scaled up to add to 1 (the live system never does that:
// a missing source stays inside its own index and keeps its weight). The five indices are computed
// once with the real scoring code and recombined with the real formula (computeThreatScore), so
// nothing here can drift from the model.
//
// Part B, the smoothing check. Where counts are small (few answers, few residents) a rate is noisy.
// The model smooths it towards a prior: (hits + m * prior) / (total + m). The claim to test: smoothing
// makes the ranking steadier and no worse when counts are small. AeDispatch is run with the smoothing
// strength set to none, to the stored value and to three times the stored value, on data with
// thinned reporting and on a municipality that has some very small barangays. "Steadier" is measured
// as rank volatility: how many places a barangay moves, on average, between one week and the next.
// If the claim does not hold, the report says so.
//
// The simulator is not tuned to make anything win: whatever comes out is reported.

import { Interval, RankingJudge, Verdict, bootstrapCI, mean, pairedDifference, verdictOf } from "../algorithms/metrics";
import { DEFAULT_PARAMETERS, ModelParameters, Weights } from "../algorithms/parameters";
import { Indices, computeThreatScore, scoreBarangay } from "../algorithms/scoring";
import { SimData, SimOverride, generate } from "../sim/generator";
import { mulberry32 } from "../sim/random";
import { orderByScore } from "./baselines";
import { DEGRADATIONS } from "./degrade";
import { WARNING_WEEKS } from "./quality";
import { DEFAULT_CASE_DELAY_WEEKS, densityRatios, evaluableWeeks, futureCases, inputsAt, scoreAll, weatherAt } from "./rank";

// ---- Part A: leave-one-source-out ---------------------------------------------------------------

export const SOURCES = ["weather", "household", "symptom", "field", "cases"] as const;
export type Source = (typeof SOURCES)[number];
export type Variant = "model" | Source;
export const VARIANTS: Variant[] = ["model", ...SOURCES];

export const ABLATION_METRICS = ["ndcg", "emergingNdcg", "emergingPrecision", "rateNdcg", "coverage"] as const;
export type AblationMetric = (typeof ABLATION_METRICS)[number];

export interface AblationOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  /** The barangays that can be reached (the ranking is judged on its top k). */
  k: number;
  caseDelayWeeks?: number;
  outbreakFraction?: number;
  leadWeeks?: number;
  params?: ModelParameters;
}

export interface AblationRow {
  variant: Variant;
  metric: AblationMetric;
  value: Interval;
}

/** What one source adds: the full model minus the model without it, paired by seed. */
export interface AddsRow {
  source: Source;
  metric: AblationMetric;
  adds: Interval;
  /** "better" when the whole interval is above 0 (the source adds something measurable). */
  verdict: Verdict;
}

export interface AblationReport {
  settings: { barangays: number; weeks: number; seeds: number; k: number; caseDelayWeeks: number; warningWeeks: number };
  rows: AblationRow[];
  adds: AddsRow[];
}

/** The weights with one source removed and the others scaled up to add to 1. */
export function weightsWithout(weights: Weights, source: Source): Weights {
  const rest = 1 - weights[source];
  const out = { ...weights, [source]: 0 } as Weights;
  for (const s of SOURCES) if (s !== source) out[s] = weights[s] / rest;
  return out;
}

/** rank[b] = place of barangay b in the order (0 = highest). */
function rankOf(order: ArrayLike<number>): Int32Array {
  const rank = new Int32Array(order.length);
  for (let i = 0; i < order.length; i++) rank[order[i]] = i;
  return rank;
}

/** How far barangays moved between two weeks: the mean absolute change of place, over the first `scope` barangays. */
export function rankMove(previous: ArrayLike<number>, current: ArrayLike<number>, scope: number): number {
  let total = 0;
  for (let b = 0; b < scope; b++) total += Math.abs(current[b] - previous[b]);
  return total / scope;
}

type SeedAblation = Record<Variant, Record<AblationMetric, number>>;

export function evaluateAblationSeed(d: SimData, k: number, params: ModelParameters, caseDelayWeeks: number): SeedAblation {
  const n = d.barangays;
  const ratios = densityRatios(d);
  const { first, last } = evaluableWeeks(d, caseDelayWeeks);
  const variantParams = Object.fromEntries(
    VARIANTS.map((v) => [v, v === "model" ? params : { ...params, weights: weightsWithout(params.weights, v) }]),
  ) as Record<Variant, ModelParameters>;

  const outbreaks: { b: number; lo: number; hi: number }[] = [];
  for (let b = 0; b < n; b++) {
    if (d.onsetWeek[b] < 0) continue;
    const lo = Math.max(first, d.onsetWeek[b] - WARNING_WEEKS);
    const hi = Math.min(last, d.onsetWeek[b] - 1);
    if (lo <= hi) outbreaks.push({ b, lo, hi });
  }

  const perWeek = Object.fromEntries(VARIANTS.map((v) => [v, { ndcg: [] as number[], emergingNdcg: [] as number[], emergingPrecision: [] as number[], rateNdcg: [] as number[] }])) as Record<
    Variant,
    { ndcg: number[]; emergingNdcg: number[]; emergingPrecision: number[]; rateNdcg: number[] }
  >;
  const bestRank = Object.fromEntries(VARIANTS.map((v) => [v, new Int32Array(outbreaks.length).fill(1 << 30)])) as Record<Variant, Int32Array>;

  for (let t = first; t <= last; t++) {
    const future = futureCases(d, t);
    const all = new RankingJudge(future, [k]);
    const byRate = new RankingJudge(Float64Array.from(future, (c, b) => (c / d.population[b]) * 10000), [k]);
    const emerging = new RankingJudge(Float64Array.from({ length: n }, (_, b) => (d.onsetWeek[b] >= t + 1 && d.onsetWeek[b] <= t + 2 ? 1 : 0)), [k]);

    // The five indices, once per barangay, with the real scoring code.
    const weather = weatherAt(d, t);
    const indices: Indices[] = [];
    for (let b = 0; b < n; b++) {
      const r = scoreBarangay(inputsAt(d, b, t, ratios[b], weather, caseDelayWeeks), params).details;
      indices.push({ weather: r.weather.index, household: r.household.index, symptom: r.symptom.index, field: r.field.index, cases: r.cases.index });
    }

    for (const v of VARIANTS) {
      const scores = Float64Array.from(indices, (idx, b) => computeThreatScore(idx, ratios[b], variantParams[v]).score);
      const order = orderByScore(scores);
      perWeek[v].ndcg.push(all.ndcg(order, k));
      perWeek[v].emergingNdcg.push(emerging.ndcg(order, k));
      perWeek[v].emergingPrecision.push(emerging.precision(order, k));
      perWeek[v].rateNdcg.push(byRate.ndcg(order, k));
      const rank = rankOf(order);
      outbreaks.forEach((ob, i) => {
        if (t >= ob.lo && t <= ob.hi && rank[ob.b] < bestRank[v][i]) bestRank[v][i] = rank[ob.b];
      });
    }
  }

  const out = {} as SeedAblation;
  for (const v of VARIANTS) {
    out[v] = {
      ndcg: mean(perWeek[v].ndcg),
      emergingNdcg: mean(perWeek[v].emergingNdcg),
      emergingPrecision: mean(perWeek[v].emergingPrecision),
      rateNdcg: mean(perWeek[v].rateNdcg),
      coverage: outbreaks.length === 0 ? NaN : bestRank[v].filter((r) => r < k).length / outbreaks.length,
    };
  }
  return out;
}

export function runAblation(opts: AblationOptions): AblationReport {
  const params = opts.params ?? DEFAULT_PARAMETERS;
  const caseDelayWeeks = opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS;
  const perSeed = opts.seeds.map((seed) => {
    const d = generate({ barangays: opts.barangays, weeks: opts.weeks, seed, outbreakFraction: opts.outbreakFraction, leadWeeks: opts.leadWeeks });
    return evaluateAblationSeed(d, opts.k, params, caseDelayWeeks);
  });

  const rows: AblationRow[] = [];
  for (const variant of VARIANTS) {
    for (const metric of ABLATION_METRICS) rows.push({ variant, metric, value: bootstrapCI(perSeed.map((r) => r[variant][metric]), 2000, 41) });
  }
  const adds: AddsRow[] = [];
  for (const source of SOURCES) {
    for (const metric of ABLATION_METRICS) {
      const diff = bootstrapCI(pairedDifference(perSeed.map((r) => r.model[metric]), perSeed.map((r) => r[source][metric])), 2000, 43);
      adds.push({ source, metric, adds: diff, verdict: verdictOf(diff) });
    }
  }
  return { settings: { barangays: opts.barangays, weeks: opts.weeks, seeds: opts.seeds.length, k: opts.k, caseDelayWeeks, warningWeeks: WARNING_WEEKS }, rows, adds };
}

// ---- Part B: the smoothing check -----------------------------------------------------------------

/**
 * "No smoothing" is a strength that is not exactly 0: with exactly 0 a barangay that sent no answers
 * at all would be 0 divided by 0. A strength this small gives the plain rate wherever there is any
 * data, and the prior where there is none (nothing else is possible).
 */
export const NO_SMOOTHING = 1e-9;

export const STRENGTHS = [
  { name: "none", times: 0 },
  { name: "stored", times: 1 },
  { name: "3x stored", times: 3 },
] as const;
export type StrengthName = (typeof STRENGTHS)[number]["name"];

export const SCENARIOS = [
  { name: "full reporting", meaning: "no data lost" },
  { name: "half the household data lost", meaning: "household answers and reports thinned by 50 percent" },
  { name: "80 percent of the household data lost", meaning: "household answers and reports thinned by 80 percent" },
  { name: "some very small barangays", meaning: "a share of the barangays has very few residents (rank volatility is read for those)" },
] as const;
export type ScenarioName = (typeof SCENARIOS)[number]["name"];

export const SMOOTHING_METRICS = ["ndcg", "emergingNdcg", "rankVolatility"] as const;
export type SmoothingMetric = (typeof SMOOTHING_METRICS)[number];

export interface SmoothingOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  k: number;
  /** Share of the barangays made very small in the last scenario, and their population. */
  smallShare: number;
  smallPopulation: number;
  caseDelayWeeks?: number;
  params?: ModelParameters;
}

export interface SmoothingRow {
  scenario: ScenarioName;
  strength: StrengthName;
  metric: SmoothingMetric;
  value: Interval;
}

/** Each strength other than the stored one, minus the stored one, paired by seed. */
export interface VersusStoredRow {
  scenario: ScenarioName;
  strength: StrengthName;
  metric: SmoothingMetric;
  difference: Interval;
  /** "better" = a better ranking (higher NDCG) or a steadier one (lower volatility). */
  verdict: Verdict;
}

export interface SmoothingReport {
  settings: { barangays: number; weeks: number; seeds: number; k: number; smallShare: number; smallPopulation: number; storedStrength: number };
  rows: SmoothingRow[];
  versus: VersusStoredRow[];
}

const withStrength = (params: ModelParameters, times: number): ModelParameters => {
  const s = params.constants.smoothing;
  const scale = (m: number) => (times === 0 ? NO_SMOOTHING : m * times);
  return { ...params, constants: { ...params.constants, smoothing: { answers: scale(s.answers), reports: scale(s.reports), field: scale(s.field) } } };
};

type SeedSmoothing = Record<ScenarioName, Record<StrengthName, Record<SmoothingMetric, number>>>;

/** Runs AeDispatch at every smoothing strength on one set of data the ranking sees (`observed`), judged by `truth`. */
function strengthsOnData(truth: SimData, observed: SimData, k: number, params: ModelParameters, caseDelayWeeks: number, scope: number): Record<StrengthName, Record<SmoothingMetric, number>> {
  const n = truth.barangays;
  const ratios = densityRatios(truth);
  const { first, last } = evaluableWeeks(truth, caseDelayWeeks);
  const out = {} as Record<StrengthName, Record<SmoothingMetric, number>>;
  const state = STRENGTHS.map((s) => ({ s, params: withStrength(params, s.times), ndcg: [] as number[], emerging: [] as number[], moves: [] as number[], previous: null as Int32Array | null }));

  for (let t = first; t <= last; t++) {
    const future = futureCases(truth, t);
    const all = new RankingJudge(future, [k]);
    const emerging = new RankingJudge(Float64Array.from({ length: n }, (_, b) => (truth.onsetWeek[b] >= t + 1 && truth.onsetWeek[b] <= t + 2 ? 1 : 0)), [k]);
    for (const x of state) {
      const order = orderByScore(scoreAll(observed, t, ratios, { params: x.params, caseDelayWeeks }));
      x.ndcg.push(all.ndcg(order, k));
      x.emerging.push(emerging.ndcg(order, k));
      const rank = rankOf(order);
      if (x.previous !== null) x.moves.push(rankMove(x.previous, rank, scope));
      x.previous = rank;
    }
  }
  for (const x of state) out[x.s.name] = { ndcg: mean(x.ndcg), emergingNdcg: mean(x.emerging), rankVolatility: mean(x.moves) };
  return out;
}

export function evaluateSmoothingSeed(seed: number, o: Required<Pick<SmoothingOptions, "barangays" | "weeks" | "k" | "smallShare" | "smallPopulation" | "caseDelayWeeks">> & { params: ModelParameters }): SeedSmoothing {
  const base = generate({ barangays: o.barangays, weeks: o.weeks, seed });
  const household = DEGRADATIONS.find((x) => x.name === "household")!;
  const result = {} as SeedSmoothing;
  result["full reporting"] = strengthsOnData(base, base, o.k, o.params, o.caseDelayWeeks, o.barangays);
  result["half the household data lost"] = strengthsOnData(base, household.apply(base, 0.5, mulberry32(seed * 31 + 5)), o.k, o.params, o.caseDelayWeeks, o.barangays);
  result["80 percent of the household data lost"] = strengthsOnData(base, household.apply(base, 0.8, mulberry32(seed * 31 + 6)), o.k, o.params, o.caseDelayWeeks, o.barangays);

  // Some very small barangays (the first ones): they report so little that their rates are noisy.
  const small = Math.max(1, Math.round(o.barangays * o.smallShare));
  const overrides: SimOverride[] = Array.from({ length: o.barangays }, (_, b) => (b < small ? { population: o.smallPopulation } : {}));
  const withSmall = generate({ barangays: o.barangays, weeks: o.weeks, seed, overrides });
  result["some very small barangays"] = strengthsOnData(withSmall, withSmall, o.k, o.params, o.caseDelayWeeks, small);
  return result;
}

/** For rank volatility a LOWER number is better, so the verdict looks at the interval the other way round. */
export function verdictFor(metric: SmoothingMetric, difference: Interval): Verdict {
  if (metric !== "rankVolatility") return verdictOf(difference);
  return verdictOf({ mean: -difference.mean, low: -difference.high, high: -difference.low });
}

export function runSmoothing(opts: SmoothingOptions): SmoothingReport {
  const params = opts.params ?? DEFAULT_PARAMETERS;
  const resolved = { barangays: opts.barangays, weeks: opts.weeks, k: opts.k, smallShare: opts.smallShare, smallPopulation: opts.smallPopulation, caseDelayWeeks: opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS, params };
  const perSeed = opts.seeds.map((seed) => evaluateSmoothingSeed(seed, resolved));

  const rows: SmoothingRow[] = [];
  const versus: VersusStoredRow[] = [];
  for (const { name: scenario } of SCENARIOS) {
    for (const { name: strength } of STRENGTHS) {
      for (const metric of SMOOTHING_METRICS) rows.push({ scenario, strength, metric, value: bootstrapCI(perSeed.map((r) => r[scenario][strength][metric]), 2000, 45) });
    }
    for (const { name: strength } of STRENGTHS.filter((s) => s.name !== "stored")) {
      for (const metric of SMOOTHING_METRICS) {
        const difference = bootstrapCI(pairedDifference(perSeed.map((r) => r[scenario][strength][metric]), perSeed.map((r) => r[scenario].stored[metric])), 2000, 47);
        versus.push({ scenario, strength, metric, difference, verdict: verdictFor(metric, difference) });
      }
    }
  }
  return {
    settings: { barangays: opts.barangays, weeks: opts.weeks, seeds: opts.seeds.length, k: opts.k, smallShare: opts.smallShare, smallPopulation: opts.smallPopulation, storedStrength: params.constants.smoothing.answers },
    rows,
    versus,
  };
}

// ---- console tables and CSV ----------------------------------------------------------------------

const f = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : "n/a");
const cell = (i: Interval, digits = 3): string => `${f(i.mean, digits)} [${f(i.low, digits)}, ${f(i.high, digits)}]`;

const SOURCE_LABEL: Record<Variant, string> = { model: "the full model", weather: "without weather", household: "without household reports", symptom: "without symptom checks", field: "without field surveys", cases: "without hospital cases" };
const METRIC_LABEL: Record<AblationMetric, string> = {
  ndcg: "all cases, NDCG",
  emergingNdcg: "new outbreaks, NDCG",
  emergingPrecision: "new outbreaks, Precision",
  rateNdcg: "per 10,000, NDCG",
  coverage: "outbreaks caught early",
};

export function formatAblation(r: AblationReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Leave-one-source-out: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, top ${s.k}, case data ${s.caseDelayWeeks} week(s) late. Simulated data.`);
  lines.push("Each source is taken out in turn (the others scaled up to 1 for this experiment only). Mean over seeds [95% interval].\n");
  lines.push(["ranking made".padEnd(28), ...(["ndcg", "emergingNdcg", "emergingPrecision", "rateNdcg"] as const).map((m) => METRIC_LABEL[m].padEnd(24)), "caught early"].join(" "));
  for (const v of VARIANTS) {
    const pick = (m: AblationMetric) => r.rows.find((x) => x.variant === v && x.metric === m)!.value;
    lines.push([SOURCE_LABEL[v].padEnd(28), ...(["ndcg", "emergingNdcg", "emergingPrecision", "rateNdcg"] as const).map((m) => cell(pick(m)).padEnd(24)), f(pick("coverage").mean, 2)].join(" "));
  }
  lines.push("\nWhat each source adds (the full model minus the model without it; above 0 means the source helps):");
  for (const x of r.adds) lines.push(`  ${x.source.padEnd(10)} ${METRIC_LABEL[x.metric].padEnd(26)} ${cell(x.adds).padEnd(28)} -> ${x.verdict === "better" ? "adds value" : x.verdict === "worse" ? "HURTS" : "no measurable effect"}`);
  return lines.join("\n");
}

export function formatSmoothing(r: SmoothingReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Smoothing check: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, top ${s.k}. The stored strength is ${s.storedStrength} pseudo-answers. Simulated data.`);
  lines.push("Rank volatility = places a barangay moves between one week and the next (lower is steadier). Mean over seeds [95% interval].\n");
  for (const sc of SCENARIOS) {
    lines.push(`${sc.name} (${sc.meaning})`);
    lines.push(["smoothing".padEnd(12), "NDCG (all cases)".padEnd(24), "NDCG (new outbreaks)".padEnd(24), "rank volatility"].join(" "));
    for (const st of STRENGTHS) {
      const pick = (m: SmoothingMetric) => r.rows.find((x) => x.scenario === sc.name && x.strength === st.name && x.metric === m)!.value;
      lines.push([st.name.padEnd(12), cell(pick("ndcg")).padEnd(24), cell(pick("emergingNdcg")).padEnd(24), cell(pick("rankVolatility"), 2)].join(" "));
    }
    for (const v of r.versus.filter((x) => x.scenario === sc.name && x.metric === "rankVolatility")) {
      lines.push(`  ${v.strength} compared with stored: volatility ${cell(v.difference, 2)} -> ${v.verdict === "better" ? "steadier" : v.verdict === "worse" ? "LESS steady" : "no measurable difference"}`);
    }
    for (const v of r.versus.filter((x) => x.scenario === sc.name && x.metric === "emergingNdcg")) {
      lines.push(`  ${v.strength} compared with stored: new-outbreak NDCG ${cell(v.difference)} -> ${v.verdict === "better" ? "better" : v.verdict === "worse" ? "WORSE" : "no measurable difference"}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function ablationCsv(r: AblationReport): string {
  const out = ["kind,variant,metric,mean,low,high,verdict"];
  for (const x of r.rows) out.push(["value", x.variant, x.metric, x.value.mean, x.value.low, x.value.high, ""].join(","));
  for (const x of r.adds) out.push(["source_adds", x.source, x.metric, x.adds.mean, x.adds.low, x.adds.high, x.verdict].join(","));
  return out.join("\n") + "\n";
}

export function smoothingCsv(r: SmoothingReport): string {
  const out = ["kind,scenario,strength,metric,mean,low,high,verdict"];
  for (const x of r.rows) out.push(["value", x.scenario, x.strength, x.metric, x.value.mean, x.value.low, x.value.high, ""].join(","));
  for (const x of r.versus) out.push(["minus_stored", x.scenario, x.strength, x.metric, x.difference.mean, x.difference.low, x.difference.high, x.verdict].join(","));
  return out.join("\n") + "\n";
}
