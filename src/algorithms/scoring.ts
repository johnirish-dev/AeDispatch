// Threat score: five component indices (each in [0,1]) combined into one score.
//
// Pure functions only: no database, no Express, no clock. The caller (the
// ranking service) gathers the numbers; this file only does the maths.
// Every weight and constant comes from the ModelParameters passed in.

import { ModelParameters, validateParameters } from "./parameters";

// "Per 1,000 residents" and "per 10,000 residents" are unit definitions, not
// tunable settings, so they are named here instead of living in the parameters.
const RESIDENTS_PER_THOUSAND = 1000;
const RESIDENTS_PER_TEN_THOUSAND = 10000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function nonNegative(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Triangular curve: 0 at `min`, rising to 1 at `peak`, falling to 0 at `max`,
 * and 0 outside. Mosquitoes breed best around 29 deg C.
 */
export function triangular(
  x: number,
  curve: { min: number; peak: number; max: number },
): number {
  if (x <= curve.min || x >= curve.max) return 0;
  if (x <= curve.peak) return (x - curve.min) / (curve.peak - curve.min);
  return (curve.max - x) / (curve.max - curve.peak);
}

/**
 * Bayesian smoothing of a rate: (hits + m * prior) / (total + m).
 * With no data the result is the prior; with lots of data it approaches the
 * observed rate, so tiny samples cannot swing the score.
 */
export function smoothedRate(
  hits: number,
  total: number,
  prior: number,
  m: number,
): number {
  const n = nonNegative(total);
  const y = Math.min(nonNegative(hits), n);
  return (y + m * prior) / (n + m);
}

// ---------------------------------------------------------------------------
// Weather index
// ---------------------------------------------------------------------------

export interface WeatherInput {
  /** Daily mean temperature in deg C, oldest first, most recent day last. */
  dailyMeanTempC: number[];
  /** Daily rainfall in mm, oldest first, most recent day last. */
  dailyRainfallMm: number[];
}

export interface WeatherResult {
  index: number;
  tempIndex: number;
  rainIndex: number;
  /** Mean temperature over the temperature window; null if there was no data. */
  meanTempC: number | null;
  rainTotalMm: number;
  /** Days with rain above the threshold, inside the rain-days window. */
  rainDays: number;
  rainDaysWindow: number;
}

/** Counts the days above the rain threshold in the last `windowDays` days. */
export function countRainDays(
  dailyRainfallMm: number[],
  windowDays: number,
  thresholdMm: number,
): number {
  return dailyRainfallMm.slice(-windowDays).filter((mm) => mm > thresholdMm)
    .length;
}

export function weatherIndex(
  input: WeatherInput,
  p: ModelParameters,
): WeatherResult {
  const c = p.constants;

  const temps = input.dailyMeanTempC
    .slice(-c.tempWindowDays)
    .filter(Number.isFinite);
  // No temperature data counts as "no signal" (0), not as a guess.
  const meanTempC =
    temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const tempIndex =
    meanTempC === null ? 0 : triangular(meanTempC, c.tempCurve);

  const rainTotalMm = input.dailyRainfallMm
    .slice(-c.rainWindowDays)
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);
  const rainIndex = clamp01(rainTotalMm / c.rainMaxMm);

  const rainDays = countRainDays(
    input.dailyRainfallMm,
    c.rainDaysWindowDays,
    c.rainDayThresholdMm,
  );

  return {
    index:
      c.weatherBlend.temperature * tempIndex +
      c.weatherBlend.rainfall * rainIndex,
    tempIndex,
    rainIndex,
    meanTempC,
    rainTotalMm,
    rainDays,
    rainDaysWindow: c.rainDaysWindowDays,
  };
}

// ---------------------------------------------------------------------------
// Household index
// ---------------------------------------------------------------------------

export type Confidence = "low" | "partial" | "good";

export interface HouseholdInput {
  /** Daily-question answers in the last 7 days. */
  answers: { total: number; yes: number };
  /** Household reports in the last 7 days; `withBreeding` has at least one
   *  breeding item ticked (standing water, clogged drain, old containers). */
  reports: { total: number; withBreeding: number };
  /** The barangay's trailing mean "yes" rate; the global prior is used if absent. */
  answersPrior?: number;
  /** The barangay's trailing mean breeding-report rate; global prior if absent. */
  reportsPrior?: number;
}

export interface HouseholdResult {
  index: number;
  /** Smoothed share of "yes" answers (C_q). */
  answerRate: number;
  /** Smoothed share of reports with breeding items (C_r); null if no reports. */
  reportRate: number | null;
  answerCount: number;
  reportCount: number;
  confidence: Confidence;
}

export function householdConfidence(
  sampleSize: number,
  p: ModelParameters,
): Confidence {
  const cut = p.constants.confidenceCutoffs;
  if (sampleSize >= cut.good) return "good";
  if (sampleSize >= cut.partial) return "partial";
  return "low";
}

export function householdIndex(
  input: HouseholdInput,
  p: ModelParameters,
): HouseholdResult {
  const c = p.constants;
  const answerCount = nonNegative(input.answers.total);
  const reportCount = nonNegative(input.reports.total);

  const answerRate = smoothedRate(
    input.answers.yes,
    answerCount,
    input.answersPrior ?? c.priors.answers,
    c.smoothing.answers,
  );

  // Reports are optional: without any, the index is the answer rate alone.
  let reportRate: number | null = null;
  let index = answerRate;
  if (reportCount > 0) {
    reportRate = smoothedRate(
      input.reports.withBreeding,
      reportCount,
      input.reportsPrior ?? c.priors.reports,
      c.smoothing.reports,
    );
    index =
      c.householdBlend.answers * answerRate +
      c.householdBlend.reports * reportRate;
  }

  return {
    index: clamp01(index),
    answerRate,
    reportRate,
    answerCount,
    reportCount,
    confidence: householdConfidence(answerCount + reportCount, p),
  };
}

// ---------------------------------------------------------------------------
// Symptom index
// ---------------------------------------------------------------------------

export interface SymptomInput {
  /** Checks in the last 7 days that showed warning signs. */
  warningChecks: number;
  /** All checks in the last 7 days (shown in the breakdown only). */
  totalChecks: number;
  population: number;
}

export interface SymptomResult {
  index: number;
  warningChecksPer1000: number;
  warningChecks: number;
  totalChecks: number;
}

export function symptomIndex(
  input: SymptomInput,
  p: ModelParameters,
): SymptomResult {
  const warningChecks = nonNegative(input.warningChecks);
  const perThousand =
    input.population > 0
      ? (warningChecks / input.population) * RESIDENTS_PER_THOUSAND
      : 0;
  return {
    index: clamp01(perThousand / p.constants.symptomMaxPer1000),
    warningChecksPer1000: perThousand,
    warningChecks,
    totalChecks: nonNegative(input.totalChecks),
  };
}

// ---------------------------------------------------------------------------
// Field index
// ---------------------------------------------------------------------------

export interface FieldInput {
  /** Containers inspected in the surveys of the last 14 days. */
  containers: number;
  /** Containers positive for larvae or pupae. */
  positive: number;
  /** The barangay's trailing mean positive rate; global prior if absent. */
  prior?: number;
}

export interface FieldResult {
  index: number;
  containers: number;
  positive: number;
}

/**
 * Returns null when there was no survey in the window: the field factor is
 * then left out of the score and the other weights are scaled up.
 */
export function fieldIndex(
  input: FieldInput | null,
  p: ModelParameters,
): FieldResult | null {
  if (input === null) return null;
  const containers = nonNegative(input.containers);
  const positive = Math.min(nonNegative(input.positive), containers);
  const index = smoothedRate(
    positive,
    containers,
    input.prior ?? p.constants.priors.field,
    p.constants.smoothing.field,
  );
  return { index: clamp01(index), containers, positive };
}

// ---------------------------------------------------------------------------
// Case indicator
// ---------------------------------------------------------------------------

export interface CaseInput {
  /** Confirmed cases this week and last week (all puroks of the barangay). */
  thisWeek: number;
  lastWeek: number;
  population: number;
}

export interface CaseResult {
  index: number;
  casesPer10k: number;
  /** Week-on-week growth, (this - last) / (last + 1). Can be negative. */
  growth: number;
  thisWeek: number;
  lastWeek: number;
}

export function caseIndex(input: CaseInput, p: ModelParameters): CaseResult {
  const c = p.constants;
  const thisWeek = nonNegative(input.thisWeek);
  const lastWeek = nonNegative(input.lastWeek);

  const casesPer10k =
    input.population > 0
      ? (thisWeek / input.population) * RESIDENTS_PER_TEN_THOUSAND
      : 0;
  // The +1 keeps growth finite when last week had no cases.
  const growth = (thisWeek - lastWeek) / (lastWeek + 1);

  const index = clamp01(
    c.caseBlend.rate * (casesPer10k / c.caseRateMaxPer10k) +
      c.caseBlend.growth * (Math.max(0, growth) / c.caseGrowthMax),
  );
  return { index, casesPer10k, growth, thisWeek, lastWeek };
}

// ---------------------------------------------------------------------------
// Combining the indices
// ---------------------------------------------------------------------------

export interface Indices {
  weather: number;
  household: number;
  symptom: number;
  /** null when there was no recent survey. */
  field: number | null;
  cases: number;
}

export interface FactorBreakdown {
  /** The index in [0,1]; null for an omitted factor. */
  index: number | null;
  /** The weight stored in the parameters. */
  weightConfigured: number;
  /** The weight actually used (rescaled so the used weights add up to 1). */
  weightUsed: number;
  /** Points this factor adds on the 0-100 scale: 100 * weightUsed * index. */
  points: number;
}

export interface ScoreBreakdown {
  factors: {
    weather: FactorBreakdown;
    household: FactorBreakdown;
    symptom: FactorBreakdown;
    field: FactorBreakdown;
    cases: FactorBreakdown;
  };
  fieldOmitted: boolean;
  /** Sum of the factor points, before the density adjustment (0-100). */
  subtotal: number;
  /** Density ratio (this barangay's density / the highest density), in [0,1]. */
  densityRatio: number;
  /** (1 + lambda * ratio) / (1 + lambda). Never above 1. */
  densityFactor: number;
  /** Threat score in [0,1]. The heap ranks by this value. */
  score: number;
  /** The same score on the 0-100 scale, rounded: what the officer sees. */
  score100: number;
  paramsVersion: number;
}

const FACTOR_NAMES = [
  "weather",
  "household",
  "symptom",
  "field",
  "cases",
] as const;

/**
 * T = (sum of weight * index) * (1 + lambda * rho) / (1 + lambda)
 *
 * If the field index is missing, its weight is dropped and the remaining
 * weights are divided by their sum, so they again add up to 100%.
 */
export function computeThreatScore(
  indices: Indices,
  densityRatio: number,
  p: ModelParameters,
): ScoreBreakdown {
  const weightsSum = FACTOR_NAMES.reduce(
    (sum, name) => (indices[name] === null ? sum : sum + p.weights[name]),
    0,
  );

  const factors = {} as ScoreBreakdown["factors"];
  let subtotal = 0;
  for (const name of FACTOR_NAMES) {
    const index = indices[name];
    const weightConfigured = p.weights[name];
    const weightUsed = index === null ? 0 : weightConfigured / weightsSum;
    const points = index === null ? 0 : 100 * weightUsed * index;
    factors[name] = { index, weightConfigured, weightUsed, points };
    subtotal += points;
  }

  const rho = clamp01(densityRatio);
  const lambda = p.constants.densityLambda;
  const densityFactor = (1 + lambda * rho) / (1 + lambda);

  const score = clamp01((subtotal / 100) * densityFactor);
  return {
    factors,
    fieldOmitted: indices.field === null,
    subtotal,
    densityRatio: rho,
    densityFactor,
    score,
    score100: Math.round(score * 100),
    paramsVersion: p.version,
  };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface BarangayInputs {
  population: number;
  /** This barangay's density divided by the highest density among barangays. */
  densityRatio: number;
  weather: WeatherInput;
  household: HouseholdInput;
  symptoms: SymptomInput;
  /** null when there was no survey in the last 14 days. */
  field: FieldInput | null;
  cases: CaseInput;
}

/** The raw numbers behind each index, for the "Why this barangay?" table. */
export interface ScoreDetails {
  weather: WeatherResult;
  household: HouseholdResult;
  symptom: SymptomResult;
  field: FieldResult | null;
  cases: CaseResult;
}

export type ThreatScoreResult = ScoreBreakdown & { details: ScoreDetails };

export function scoreBarangay(
  inputs: BarangayInputs,
  p: ModelParameters,
): ThreatScoreResult {
  validateParameters(p);

  const details: ScoreDetails = {
    weather: weatherIndex(inputs.weather, p),
    household: householdIndex(inputs.household, p),
    symptom: symptomIndex(inputs.symptoms, p),
    field: fieldIndex(inputs.field, p),
    cases: caseIndex(inputs.cases, p),
  };

  const breakdown = computeThreatScore(
    {
      weather: details.weather.index,
      household: details.household.index,
      symptom: details.symptom.index,
      field: details.field === null ? null : details.field.index,
      cases: details.cases.index,
    },
    inputs.densityRatio,
    p,
  );
  return { ...breakdown, details };
}
