// Scores every barangay of a simulated data set at the end of a given week, in memory, with the
// REAL scoring code (`scoreBarangay`) and the same data windows as the live ranking service
// (services/scoringInputs.ts). Nothing here reads the database or the clock.
//
// The rule that matters most: the score for week `t` may only use data dated up to the last day
// of week `t`, and case data are late by `caseDelayWeeks` (hospital files arrive after the week).

import { DEFAULT_PARAMETERS, ModelParameters } from "../algorithms/parameters";
import { BarangayInputs, WeatherInput, scoreBarangay, weatherIndex } from "../algorithms/scoring";
import { SimData, dayIndex, weekIndex, weeklyCases } from "../sim/generator";

export interface RankOptions {
  /** Model parameters (weights and constants). Default: the stored starting values. */
  params?: ModelParameters;
  /** Weeks between a week ending and its confirmed cases being known. Default 1. */
  caseDelayWeeks?: number;
}

export const DEFAULT_CASE_DELAY_WEEKS = 1;

/** First and last week that can be evaluated: the windows must be full and two future weeks must exist. */
export function evaluableWeeks(d: SimData, caseDelayWeeks = DEFAULT_CASE_DELAY_WEEKS): { first: number; last: number } {
  return { first: Math.max(2, caseDelayWeeks + 2), last: d.weeks - 3 };
}

/** Each barangay's density divided by the highest density (what the scoring formula needs). */
export function densityRatios(d: SimData): Float64Array {
  const density = new Float64Array(d.barangays);
  let max = 0;
  for (let b = 0; b < d.barangays; b++) {
    density[b] = d.population[b] / d.areaKm2[b];
    if (density[b] > max) max = density[b];
  }
  return density.map((x) => (max > 0 ? x / max : 0));
}

/** The weather for every barangay (it is municipal): the last 14 days up to the end of week t, oldest first. */
export function weatherAt(d: SimData, t: number): WeatherInput {
  const end = 7 * t + 6;
  const temps: number[] = [];
  const rain: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = end - i;
    temps.push(day >= 0 ? d.meanTempC[day] : NaN);
    rain.push(day >= 0 ? d.rainfallMm[day] : NaN);
  }
  return { dailyMeanTempC: temps, dailyRainfallMm: rain };
}

/** The newest week whose cases are known at the end of week t, or -1 when there is none yet. */
export const latestCaseWeek = (t: number, caseDelayWeeks: number): number => (t - caseDelayWeeks >= 0 ? t - caseDelayWeeks : -1);

/** Everything the score needs for barangay b at the end of week t, using only data up to that day. */
export function inputsAt(d: SimData, b: number, t: number, ratio: number, weather: WeatherInput, caseDelayWeeks: number): BarangayInputs {
  const end = 7 * t + 6;
  let answers = 0;
  let yes = 0;
  let reports = 0;
  let breeding = 0;
  let checks = 0;
  let warning = 0;
  for (let day = Math.max(0, end - 6); day <= end; day++) {
    const i = dayIndex(d, b, day);
    answers += d.answersTotal[i];
    yes += d.answersYes[i];
    reports += d.reportsTotal[i];
    breeding += d.reportsWithBreeding[i];
    checks += d.symptomChecks[i];
    warning += d.symptomWarning[i];
  }
  // The 14-day field window is the week just ended and the one before it.
  let surveys = 0;
  let containers = 0;
  let positive = 0;
  for (let w = Math.max(0, t - 1); w <= t; w++) {
    const i = weekIndex(d, b, w);
    surveys += d.surveys[i];
    containers += d.containers[i];
    positive += d.positive[i];
  }
  const latest = latestCaseWeek(t, caseDelayWeeks);
  return {
    population: d.population[b],
    densityRatio: ratio,
    weather,
    household: { answers: { total: answers, yes }, reports: { total: reports, withBreeding: breeding } },
    symptoms: { warningChecks: warning, totalChecks: checks, population: d.population[b] },
    field: { surveys, containers, positive },
    cases: {
      thisWeek: latest >= 0 ? weeklyCases(d, b, latest) : 0,
      lastWeek: latest - 1 >= 0 ? weeklyCases(d, b, latest - 1) : 0,
      population: d.population[b],
    },
  };
}

/** AeDispatch's raw score (0 to 1) for every barangay at the end of week t. */
export function scoreAll(d: SimData, t: number, ratios: Float64Array, opts: RankOptions = {}): Float64Array {
  const params = opts.params ?? DEFAULT_PARAMETERS;
  const delay = opts.caseDelayWeeks ?? DEFAULT_CASE_DELAY_WEEKS;
  const weather = weatherAt(d, t);
  const out = new Float64Array(d.barangays);
  for (let b = 0; b < d.barangays; b++) out[b] = scoreBarangay(inputsAt(d, b, t, ratios[b], weather, delay), params).score;
  return out;
}

/** The weather index (the same for every barangay) times each barangay's density adjustment. */
export function weatherOnlyScores(d: SimData, t: number, ratios: Float64Array, params: ModelParameters = DEFAULT_PARAMETERS): Float64Array {
  const w = weatherIndex(weatherAt(d, t), params).index;
  const lambda = params.constants.densityLambda;
  return ratios.map((rho) => (w * (1 + lambda * rho)) / (1 + lambda));
}

/** The confirmed cases the barangays really had in the two weeks after week t (what a ranking is judged by). */
export function futureCases(d: SimData, t: number): Float64Array {
  const out = new Float64Array(d.barangays);
  for (let b = 0; b < d.barangays; b++) out[b] = weeklyCases(d, b, t + 1) + weeklyCases(d, b, t + 2);
  return out;
}
