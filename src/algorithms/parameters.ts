// Model parameters for the threat score and the dispatch rules.
//
// Every weight and threshold lives here (and later in the model_parameters
// table), never inside the scoring logic, so the weights can be versioned and
// changed from the Demo tools page without touching the code.
//
// All values are provisional defaults until they are calibrated on real data.

/** Share of the score given to each signal. Must add up to 1. */
export interface Weights {
  weather: number;
  household: number;
  symptom: number;
  field: number;
  cases: number;
}

export interface Constants {
  // --- Weather index ---
  /** Mean temperature curve: 0 at `min`, 1 at `peak`, 0 at `max` (deg C). */
  tempCurve: { min: number; peak: number; max: number };
  /** Days of temperature averaged (T7). */
  tempWindowDays: number;
  /** Days of rainfall added up (R14). */
  rainWindowDays: number;
  /** Days looked at when counting "rain on d of 7 days". */
  rainDaysWindowDays: number;
  /** A day counts as a rain day above this many millimetres. */
  rainDayThresholdMm: number;
  /** Rainfall total (mm over the rain window) that gives the full rain index. */
  rainMaxMm: number;
  /** How the weather index mixes its two parts. Adds up to 1. */
  weatherBlend: { temperature: number; rainfall: number };

  // --- Household index ---
  /** Pseudo-observations that keep small samples near the prior. */
  smoothing: { answers: number; reports: number; field: number };
  /** Rate used when a barangay has no trailing history of its own. */
  priors: { answers: number; reports: number; field: number };
  /** How the household index mixes daily answers and household reports. Adds up to 1. */
  householdBlend: { answers: number; reports: number };
  /** Answers + reports needed for the "partial" and "good" confidence labels. */
  confidenceCutoffs: { partial: number; good: number };

  // --- Symptom index ---
  /** Warning-sign checks per 1,000 residents (7 days) that give the full index. */
  symptomMaxPer1000: number;

  // --- Case indicator ---
  /** Weekly cases per 10,000 residents that give the full rate part. */
  caseRateMaxPer10k: number;
  /** Week-on-week growth that gives the full growth part (1 = +100%). */
  caseGrowthMax: number;
  /** How the case indicator mixes the rate and the growth. Adds up to 1. */
  caseBlend: { rate: number; growth: number };

  // --- Density adjustment ---
  /** Strength of the density adjustment (lambda). */
  densityLambda: number;

  // --- Risk levels and actions (fractions of the 0-1 score) ---
  riskCutoffs: { moderate: number; elevated: number; high: number };
  /** Tier 1 (search and destroy) is recommended from this score. */
  tier1Threshold: number;
  tier2: {
    /** A purok needs at least this many confirmed cases ("more than 2" = 3). */
    minCases: number;
    /** Case window in days; the caller sums the cases over this window. */
    windowDays: number;
  };
  /** Score change (fraction) that still counts as "flat" for the trend arrow. */
  trendDeadBand: number;

  // --- Alerts ---
  /** An alert is considered when the score crosses this value upward. */
  alertThreshold: number;
  /** Maximum alerts per barangay inside the alert window. */
  alertCap: number;
  alertWindowDays: number;

  // --- Dispatch ---
  /** Teams available today when the officer has not changed it. */
  defaultTeams: number;
}

export interface ModelParameters {
  version: number;
  weights: Weights;
  constants: Constants;
}

export const DEFAULT_PARAMETERS: ModelParameters = {
  version: 1,
  weights: {
    weather: 0.2,
    household: 0.15,
    symptom: 0.1,
    field: 0.25,
    cases: 0.3,
  },
  constants: {
    tempCurve: { min: 18, peak: 29, max: 34.5 },
    tempWindowDays: 7,
    rainWindowDays: 14,
    rainDaysWindowDays: 7,
    rainDayThresholdMm: 1,
    // About 10 mm a day for two weeks, i.e. a heavy-rain period.
    rainMaxMm: 150,
    weatherBlend: { temperature: 0.5, rainfall: 0.5 },

    smoothing: { answers: 10, reports: 10, field: 10 },
    priors: { answers: 0.2, reports: 0.3, field: 0.15 },
    householdBlend: { answers: 0.5, reports: 0.5 },
    confidenceCutoffs: { partial: 5, good: 30 },

    // Chosen so that about 2 warning-sign checks in 4,000 residents already
    // reads as a clear signal (matches the wireframe example).
    symptomMaxPer1000: 1,

    caseRateMaxPer10k: 8,
    caseGrowthMax: 1,
    caseBlend: { rate: 0.5, growth: 0.5 },

    densityLambda: 0.5,

    riskCutoffs: { moderate: 0.25, elevated: 0.4, high: 0.7 },
    tier1Threshold: 0.4,
    tier2: { minCases: 3, windowDays: 14 },
    trendDeadBand: 0.02,

    alertThreshold: 0.4,
    alertCap: 3,
    alertWindowDays: 7,

    defaultTeams: 3,
  },
};

/**
 * Turns a stored fraction (0.40) into the whole-point scale the officer sees
 * (40). Math.round avoids float noise such as 0.29 * 100 = 28.999999999999996.
 */
export function toPoints(fraction: number): number {
  return Math.round(fraction * 100);
}

/** Throws if the parameters would break the maths (bad weights, zero divisors). */
export function validateParameters(p: ModelParameters): void {
  const w = p.weights;
  const weightList = [w.weather, w.household, w.symptom, w.field, w.cases];
  if (weightList.some((x) => !(x >= 0))) {
    throw new Error("Weights must not be negative");
  }
  const sum = weightList.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Weights must add up to 1 (got ${sum})`);
  }

  const c = p.constants;
  const mustBePositive: [string, number][] = [
    ["rainMaxMm", c.rainMaxMm],
    ["symptomMaxPer1000", c.symptomMaxPer1000],
    ["caseRateMaxPer10k", c.caseRateMaxPer10k],
    ["caseGrowthMax", c.caseGrowthMax],
    ["tempWindowDays", c.tempWindowDays],
    ["rainWindowDays", c.rainWindowDays],
    ["rainDaysWindowDays", c.rainDaysWindowDays],
    ["alertWindowDays", c.alertWindowDays],
  ];
  for (const [name, value] of mustBePositive) {
    if (!(value > 0)) throw new Error(`${name} must be greater than 0`);
  }

  const curve = c.tempCurve;
  if (!(curve.min < curve.peak && curve.peak < curve.max)) {
    throw new Error("tempCurve needs min < peak < max");
  }

  const blends: [string, number][] = [
    ["weatherBlend", c.weatherBlend.temperature + c.weatherBlend.rainfall],
    ["householdBlend", c.householdBlend.answers + c.householdBlend.reports],
    ["caseBlend", c.caseBlend.rate + c.caseBlend.growth],
  ];
  for (const [name, total] of blends) {
    if (Math.abs(total - 1) > 1e-6) throw new Error(`${name} must add up to 1`);
  }

  const r = c.riskCutoffs;
  if (!(r.moderate < r.elevated && r.elevated < r.high)) {
    throw new Error("riskCutoffs must be increasing");
  }
}
