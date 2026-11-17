// Seeded synthetic data generator. It builds weather plus per-barangay signals
// and cases, in memory, using typed arrays so it also scales to n = 42,010.
//
// The built-in story: a wet, warm spell hits the municipality. Barangays that
// go on to have an outbreak show rising household, symptom and field signals
// SIM_LEAD_WEEKS before their confirmed cases jump (the ramp is 0 in that first week, so the
// signals are visibly raised from SIM_LEAD_WEEKS - 1 weeks before the jump). That lead time is what the
// evaluation tests. The simulator is not tuned to make AeDispatch win.

import { Rng, binomial, mulberry32, poisson, randInt } from "./random";

export const MAX_PUROKS = 8;
export const SIM_LEAD_WEEKS = 3;

export interface SimOverride {
  population?: number;
  areaKm2?: number;
  purokCount?: number;
  /** Week index when cases jump; null means no outbreak. Omit to let chance decide. */
  caseOnsetWeek?: number | null;
  /** Purok index (0-based) that carries most of an outbreak's cases. */
  hotPurok?: number;
  /**
   * Share of the usual household answers, household reports and symptom checks this barangay sends,
   * above 0 and at most 1 (0.25 = a quarter as many). Omit for 1. The usual counts are generated first
   * and then thinned, so the rest of the data stay exactly as they were. Used to test fairness towards
   * barangays that report little.
   */
  reportingRate?: number;
}

export interface SimOptions {
  barangays: number;
  weeks: number;
  seed: number;
  /** Day of the year for day 0, which sets the season. Default 200. */
  startDayOfYear?: number;
  /** Share of barangays that get an outbreak. Default 0.15. */
  outbreakFraction?: number;
  /**
   * Weeks before the case jump at which the household, symptom and field signals start to rise.
   * Default SIM_LEAD_WEEKS (3). 0 means the signals rise only in the week of the jump (no early
   * warning). The evaluation varies it to show where an early-warning advantage disappears.
   */
  leadWeeks?: number;
  /** Week index where the two-week wet and warm spell starts. Default: random. */
  spellWeek?: number;
  overrides?: SimOverride[];
  /**
   * Share of the barangays (chosen at random) that report at `lowReportingRate` of the usual volume.
   * Default 0: every barangay reports as usual, and the generated data are exactly what they were before
   * this option existed. When it is on, the municipality itself (populations, outbreaks, cases, surveys,
   * weather) is identical to the same seed without it; only the resident reports of those barangays are fewer.
   */
  lowReportingShare?: number;
  /** The reporting volume of those barangays, as a share of the usual. Default 0.25. */
  lowReportingRate?: number;
}

export interface SimData {
  barangays: number;
  weeks: number;
  days: number;
  population: Uint32Array;
  areaKm2: Float32Array;
  purokCount: Uint8Array;
  /** Case-onset week per barangay, -1 when there is no outbreak. */
  onsetWeek: Int16Array;
  /** Share of the usual reporting volume each barangay sends (1 for all unless the options say otherwise). */
  reportingRate: Float32Array;
  hotPurok: Uint8Array;
  /** Municipal weather, one value per day. */
  meanTempC: Float32Array;
  rainfallMm: Float32Array;
  // Per barangay and day (index = b * days + day):
  answersTotal: Uint16Array;
  answersYes: Uint16Array;
  reportsTotal: Uint16Array;
  reportsWithBreeding: Uint16Array;
  symptomChecks: Uint16Array;
  symptomWarning: Uint16Array;
  // Per barangay and week (index = b * weeks + w):
  surveys: Uint8Array;
  containers: Uint16Array;
  positive: Uint16Array;
  // Per barangay, week and purok (index = (b * weeks + w) * MAX_PUROKS + p):
  cases: Uint16Array;
}

export const dayIndex = (d: SimData, b: number, day: number): number => b * d.days + day;
export const weekIndex = (d: SimData, b: number, w: number): number => b * d.weeks + w;
export const caseIndex = (d: SimData, b: number, w: number, p: number): number =>
  (b * d.weeks + w) * MAX_PUROKS + p;

/** Confirmed cases in barangay b during week w (all puroks). */
export function weeklyCases(d: SimData, b: number, w: number): number {
  let total = 0;
  for (let p = 0; p < d.purokCount[b]; p++) total += d.cases[caseIndex(d, b, w, p)];
  return total;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

function generateWeather(rng: Rng, days: number, startDoy: number, spellWeek: number, meanTempC: Float32Array, rainfallMm: Float32Array): void {
  for (let day = 0; day < days; day++) {
    const doy = startDoy + day;
    const inSpell = Math.floor(day / 7) === spellWeek || Math.floor(day / 7) === spellWeek + 1;
    const seasonTemp = 28.5 + 2.5 * Math.sin((2 * Math.PI * (doy - 100)) / 365);
    const rainProb = inSpell ? 0.9 : 0.35 + 0.25 * Math.sin((2 * Math.PI * (doy - 150)) / 365);
    const rainMean = inSpell ? 35 : 10;
    meanTempC[day] = round1(seasonTemp + (rng() - 0.5) * 1.6 + (inSpell ? 0.5 : 0));
    rainfallMm[day] = rng() < rainProb ? round1(-Math.log(1 - rng()) * rainMean) : 0;
  }
}

export function generate(opts: SimOptions): SimData {
  const n = opts.barangays;
  const weeks = opts.weeks;
  const days = weeks * 7;
  const rng = mulberry32(opts.seed);
  const outbreakFraction = opts.outbreakFraction ?? 0.15;
  const lead = opts.leadWeeks ?? SIM_LEAD_WEEKS;

  const d: SimData = {
    barangays: n,
    weeks,
    days,
    population: new Uint32Array(n),
    areaKm2: new Float32Array(n),
    purokCount: new Uint8Array(n),
    onsetWeek: new Int16Array(n).fill(-1),
    reportingRate: new Float32Array(n).fill(1),
    hotPurok: new Uint8Array(n),
    meanTempC: new Float32Array(days),
    rainfallMm: new Float32Array(days),
    answersTotal: new Uint16Array(n * days),
    answersYes: new Uint16Array(n * days),
    reportsTotal: new Uint16Array(n * days),
    reportsWithBreeding: new Uint16Array(n * days),
    symptomChecks: new Uint16Array(n * days),
    symptomWarning: new Uint16Array(n * days),
    surveys: new Uint8Array(n * weeks),
    containers: new Uint16Array(n * weeks),
    positive: new Uint16Array(n * weeks),
    cases: new Uint16Array(n * weeks * MAX_PUROKS),
  };

  const drawnSpell = weeks > 4 ? randInt(rng, 1, weeks - 4) : 0; // always drawn, so seeds stay comparable
  const spellWeek = opts.spellWeek ?? drawnSpell;
  generateWeather(rng, days, opts.startDayOfYear ?? 200, spellWeek, d.meanTempC, d.rainfallMm);

  // Which barangays report little. Chosen from a stream of its own, so the main stream (and with it the
  // rest of the data) is untouched.
  const lowShare = opts.lowReportingShare ?? 0;
  const lowRate = opts.lowReportingRate ?? 0.25;
  const lowBarangays = lowShare > 0 ? lowReportingBarangays(opts.seed, n, lowShare) : new Set<number>();

  for (let b = 0; b < n; b++) {
    const o = opts.overrides?.[b] ?? {};
    const population = o.population ?? Math.round(800 + 11000 * rng() ** 2);
    d.population[b] = population;
    d.areaKm2[b] = o.areaKm2 ?? Math.round((0.6 + 6 * rng()) * 100) / 100;
    const purokCount = Math.min(MAX_PUROKS, o.purokCount ?? randInt(rng, 3, 8));
    d.purokCount[b] = purokCount;
    d.hotPurok[b] = Math.min(purokCount - 1, o.hotPurok ?? Math.floor(rng() * purokCount));

    let onset = -1;
    if (o.caseOnsetWeek !== undefined) {
      onset = o.caseOnsetWeek === null ? -1 : o.caseOnsetWeek;
    } else if (rng() < outbreakFraction) {
      onset = Math.min(weeks - 1, spellWeek + 2 + randInt(rng, 0, 2));
    }
    d.onsetWeek[b] = onset;

    const bias = 0.8 + 0.4 * rng(); // some barangays are simply more active
    d.reportingRate[b] = o.reportingRate ?? (lowBarangays.has(b) ? lowRate : 1);
    for (let w = 0; w < weeks; w++) {
      // 0 until `lead` weeks before onset, then rises to 1 at onset (a step when lead is 0).
      const ramp = onset < 0 ? 0 : lead === 0 ? (w >= onset ? 1 : 0) : clamp01((w - (onset - lead)) / lead);

      for (let k = 0; k < 7; k++) {
        const i = b * days + w * 7 + k;
        const answers = poisson(rng, population * 0.004 * bias);
        d.answersTotal[i] = answers;
        d.answersYes[i] = binomial(rng, answers, 0.08 + 0.55 * ramp);
        const reports = poisson(rng, population * 0.0015 * bias);
        d.reportsTotal[i] = reports;
        d.reportsWithBreeding[i] = binomial(rng, reports, 0.12 + 0.6 * ramp);
        const checks = poisson(rng, population * 0.003 * bias);
        d.symptomChecks[i] = checks;
        d.symptomWarning[i] = binomial(rng, checks, 0.03 + 0.14 * ramp);
      }

      const wi = b * weeks + w;
      const surveys = ramp > 0 ? randInt(rng, 1, 2) : rng() < 0.35 ? 1 : 0;
      const containers = surveys * randInt(rng, 8, 20);
      d.surveys[wi] = surveys;
      d.containers[wi] = containers;
      d.positive[wi] = binomial(rng, containers, 0.06 + 0.5 * ramp);

      // Cases: a low baseline, then a jump at onset that keeps growing.
      const outbreak = onset >= 0 && w >= onset;
      const mean = outbreak
        ? (population / 10000) * 6 * (1 + 0.3 * (w - onset))
        : (population / 10000) * 0.8 * bias;
      let weightTotal = 0;
      for (let p = 0; p < purokCount; p++) weightTotal += outbreak && p === d.hotPurok[b] ? 3 : 1;
      for (let p = 0; p < purokCount; p++) {
        const weight = outbreak && p === d.hotPurok[b] ? 3 : 1;
        d.cases[caseIndex(d, b, w, p)] = poisson(rng, (mean * weight) / weightTotal);
      }
    }
  }
  thinLowReporters(d, opts.seed);
  return d;
}

/**
 * Barangays that report less send only a share of the household answers, household reports and symptom
 * checks the usual counts would give. Done after the main generation, from a stream of its own, so every
 * other number of the municipality is exactly what it would have been.
 */
/**
 * The barangays that would report little when `share` of the barangays do (the same choice `generate` makes with
 * the `lowReportingShare` option). Exported so an evaluation can name the same barangays in a run where they
 * report as usual: the control that shows what the low reporting itself costs.
 */
export function lowReportingBarangays(seed: number, n: number, share: number): Set<number> {
  const pick = mulberry32(seed * 7907 + 3);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Set(order.slice(0, Math.round(n * share)));
}

function thinLowReporters(d: SimData, seed: number): void {
  const rng = mulberry32(seed * 6151 + 11);
  for (let b = 0; b < d.barangays; b++) {
    const rate = d.reportingRate[b];
    if (rate >= 1) continue;
    for (let k = 0; k < d.days; k++) {
      const i = b * d.days + k;
      const answers = d.answersTotal[i];
      const keptAnswers = binomial(rng, answers, rate);
      d.answersYes[i] = answers === 0 ? 0 : Math.round((d.answersYes[i] * keptAnswers) / answers);
      d.answersTotal[i] = keptAnswers;
      const reports = d.reportsTotal[i];
      const keptReports = binomial(rng, reports, rate);
      d.reportsWithBreeding[i] = reports === 0 ? 0 : Math.round((d.reportsWithBreeding[i] * keptReports) / reports);
      d.reportsTotal[i] = keptReports;
      const checks = d.symptomChecks[i];
      const keptChecks = binomial(rng, checks, rate);
      d.symptomWarning[i] = checks === 0 ? 0 : Math.round((d.symptomWarning[i] * keptChecks) / checks);
      d.symptomChecks[i] = keptChecks;
    }
  }
}
