import { describe, it, expect } from "vitest";
import {
  DEFAULT_PARAMETERS,
  ModelParameters,
  validateParameters,
} from "../src/algorithms/parameters";
import {
  BarangayInputs,
  caseIndex,
  computeThreatScore,
  countRainDays,
  fieldIndex,
  householdIndex,
  scoreBarangay,
  smoothedRate,
  symptomIndex,
  triangular,
  weatherIndex,
} from "../src/algorithms/scoring";

const P = DEFAULT_PARAMETERS;
const curve = P.constants.tempCurve;

describe("triangular temperature curve (18 / 29 / 34.5)", () => {
  it("is 0 at and below the lower edge", () => {
    expect(triangular(18, curve)).toBe(0);
    expect(triangular(10, curve)).toBe(0);
  });
  it("is 1 at the peak", () => {
    expect(triangular(29, curve)).toBe(1);
  });
  it("is 0 at and above the upper edge", () => {
    expect(triangular(34.5, curve)).toBe(0);
    expect(triangular(40, curve)).toBe(0);
  });
  it("rises and falls linearly", () => {
    expect(triangular(23.5, curve)).toBeCloseTo(0.5, 10);
    expect(triangular(31.75, curve)).toBeCloseTo(0.5, 10);
  });
});

describe("smoothedRate", () => {
  it("returns the prior when there is no data (n = 0)", () => {
    expect(smoothedRate(0, 0, 0.2, 10)).toBeCloseTo(0.2, 10);
  });
  it("moves toward the observed rate when n is large", () => {
    // 900 of 1000 with prior 0.2: (900 + 2) / 1010
    expect(smoothedRate(900, 1000, 0.2, 10)).toBeCloseTo(902 / 1010, 10);
    expect(smoothedRate(900, 1000, 0.2, 10)).toBeGreaterThan(0.89);
  });
  it("small samples stay near the prior", () => {
    // 1 yes out of 1 answer must not jump to 100%
    expect(smoothedRate(1, 1, 0.2, 10)).toBeCloseTo(3 / 11, 10);
  });
  it("ignores impossible counts (more hits than total, negatives)", () => {
    expect(smoothedRate(5, 2, 0.2, 10)).toBeCloseTo(smoothedRate(2, 2, 0.2, 10), 10);
    expect(smoothedRate(-3, -4, 0.2, 10)).toBeCloseTo(0.2, 10);
  });
});

describe("weatherIndex", () => {
  const week = (temp: number) => Array(7).fill(temp);

  it("combines temperature and rainfall half and half", () => {
    // 29 deg C -> 1; 75 mm of 150 -> 0.5; W = 0.5*1 + 0.5*0.5
    const r = weatherIndex(
      { dailyMeanTempC: week(29), dailyRainfallMm: [75, ...Array(13).fill(0)] },
      P,
    );
    expect(r.tempIndex).toBe(1);
    expect(r.rainIndex).toBeCloseTo(0.5, 10);
    expect(r.index).toBeCloseTo(0.75, 10);
  });

  it("clamps the rain index at 1", () => {
    const r = weatherIndex(
      { dailyMeanTempC: week(29), dailyRainfallMm: Array(14).fill(100) },
      P,
    );
    expect(r.rainIndex).toBe(1);
  });

  it("only uses the last 7 days of temperature", () => {
    // Old cold days (outside the window) must not change the mean.
    const r = weatherIndex(
      { dailyMeanTempC: [5, 5, 5, ...week(29)], dailyRainfallMm: [] },
      P,
    );
    expect(r.meanTempC).toBe(29);
  });

  it("only adds up the last 14 days of rainfall", () => {
    const r = weatherIndex(
      {
        dailyMeanTempC: week(29),
        dailyRainfallMm: [500, ...Array(14).fill(1)],
      },
      P,
    );
    expect(r.rainTotalMm).toBe(14);
  });

  it("gives no signal (0) when there is no data", () => {
    const r = weatherIndex({ dailyMeanTempC: [], dailyRainfallMm: [] }, P);
    expect(r.meanTempC).toBeNull();
    expect(r.index).toBe(0);
  });

  it("counts rain days only above the 1 mm threshold, in the last 7 days", () => {
    expect(countRainDays([0, 1, 1.1, 5, 0, 20, 0], 7, 1)).toBe(3);
    // Days before the window do not count.
    expect(countRainDays([50, 50, 0, 0, 0, 0, 0, 0, 0], 7, 1)).toBe(0);
  });
});

describe("householdIndex", () => {
  it("equals the prior with no answers and no reports (n = 0)", () => {
    const r = householdIndex(
      { answers: { total: 0, yes: 0 }, reports: { total: 0, withBreeding: 0 } },
      P,
    );
    expect(r.index).toBeCloseTo(P.constants.priors.answers, 10);
    expect(r.reportRate).toBeNull();
    expect(r.confidence).toBe("low");
  });

  it("uses the barangay's own trailing rate as the prior when given", () => {
    const r = householdIndex(
      {
        answers: { total: 0, yes: 0 },
        reports: { total: 0, withBreeding: 0 },
        answersPrior: 0.5,
      },
      P,
    );
    expect(r.index).toBeCloseTo(0.5, 10);
  });

  it("uses only the answer rate when there are no reports", () => {
    const r = householdIndex(
      { answers: { total: 20, yes: 10 }, reports: { total: 0, withBreeding: 0 }, answersPrior: 0.5 },
      P,
    );
    expect(r.index).toBeCloseTo((10 + 5) / 30, 10);
  });

  it("blends answers and reports half and half when reports exist", () => {
    const r = householdIndex(
      {
        answers: { total: 20, yes: 12 },
        reports: { total: 10, withBreeding: 6 },
        answersPrior: 0.6,
        reportsPrior: 0.6,
      },
      P,
    );
    expect(r.answerRate).toBeCloseTo(0.6, 10); // (12 + 6) / 30
    expect(r.reportRate).toBeCloseTo(0.6, 10); // (6 + 6) / 20
    expect(r.index).toBeCloseTo(0.6, 10);
  });

  it("labels confidence low / partial / good by sample size", () => {
    const label = (answers: number, reports: number) =>
      householdIndex(
        {
          answers: { total: answers, yes: 0 },
          reports: { total: reports, withBreeding: 0 },
        },
        P,
      ).confidence;
    expect(label(4, 0)).toBe("low");
    expect(label(5, 0)).toBe("partial");
    expect(label(20, 9)).toBe("partial"); // 29
    expect(label(20, 10)).toBe("good"); // 30
  });
});

describe("symptomIndex", () => {
  it("scales warning-sign checks per 1,000 residents by s_max", () => {
    // 2 of 4,000 residents = 0.5 per 1,000; s_max = 4 -> 0.125
    const r = symptomIndex({ warningChecks: 2, totalChecks: 9, population: 4000 }, P);
    expect(r.warningChecksPer1000).toBeCloseTo(0.5, 10);
    expect(r.index).toBeCloseTo(0.125, 10);
  });
  it("reaches 1 at the s_max rate (4 per 1,000)", () => {
    expect(symptomIndex({ warningChecks: 16, totalChecks: 40, population: 4000 }, P).index).toBeCloseTo(1, 10);
  });
  it("is 0 with no warning checks", () => {
    expect(symptomIndex({ warningChecks: 0, totalChecks: 30, population: 4000 }, P).index).toBe(0);
  });
  it("clamps at 1", () => {
    expect(symptomIndex({ warningChecks: 50, totalChecks: 60, population: 1000 }, P).index).toBe(1);
  });
  it("does not divide by zero when the population is 0", () => {
    expect(symptomIndex({ warningChecks: 3, totalChecks: 3, population: 0 }, P).index).toBe(0);
  });
});

describe("fieldIndex", () => {
  const noSurvey = { surveys: 0, containers: 0, positive: 0 };

  it("uses the global prior when nobody was surveyed", () => {
    const r = fieldIndex(noSurvey, P);
    expect(r.surveyed).toBe(false);
    expect(r.index).toBeCloseTo(P.constants.priors.field, 10);
    expect(r.prior).toBe(P.constants.priors.field);
  });
  it("uses the barangay's trailing rate as the prior when given", () => {
    const r = fieldIndex({ ...noSurvey, prior: 0.3 }, P);
    expect(r.surveyed).toBe(false);
    expect(r.index).toBeCloseTo(0.3, 10);
  });
  it("smooths the share of positive containers", () => {
    // 6 of 60, prior 0.1: (6 + 1) / 70
    const r = fieldIndex({ surveys: 4, containers: 60, positive: 6, prior: 0.1 }, P);
    expect(r.surveyed).toBe(true);
    expect(r.index).toBeCloseTo(0.1, 10);
  });
  it("still counts as surveyed when the survey found no containers", () => {
    const r = fieldIndex({ surveys: 1, containers: 0, positive: 0, prior: 0.3 }, P);
    expect(r.surveyed).toBe(true);
    expect(r.index).toBeCloseTo(0.3, 10);
  });
  it("cannot count more positive containers than inspected", () => {
    const r = fieldIndex({ surveys: 1, containers: 10, positive: 99, prior: 0 }, P);
    expect(r.positive).toBe(10);
    expect(r.index).toBeCloseTo(0.5, 10); // 10 / 20
  });
});

describe("caseIndex", () => {
  it("combines the case rate and the growth half and half", () => {
    // 3 cases in 4,120 residents = 7.28 per 10,000; growth (3-1)/(1+1) = 1
    const r = caseIndex({ thisWeek: 3, lastWeek: 1, population: 4120 }, P);
    expect(r.casesPer10k).toBeCloseTo(7.2816, 3);
    expect(r.growth).toBe(1);
    expect(r.index).toBeCloseTo(0.5 * (7.2816 / 8) + 0.5, 3);
  });
  it("ignores negative growth", () => {
    const r = caseIndex({ thisWeek: 0, lastWeek: 5, population: 4000 }, P);
    expect(r.growth).toBeLessThan(0);
    expect(r.index).toBe(0);
  });
  it("keeps growth finite when last week had no cases", () => {
    const r = caseIndex({ thisWeek: 2, lastWeek: 0, population: 5000 }, P);
    expect(r.growth).toBe(2);
  });
  it("clamps at 1", () => {
    expect(caseIndex({ thisWeek: 50, lastWeek: 0, population: 1000 }, P).index).toBe(1);
  });
  it("does not divide by zero when the population is 0", () => {
    expect(caseIndex({ thisWeek: 3, lastWeek: 3, population: 0 }, P).casesPer10k).toBe(0);
  });
});

describe("computeThreatScore", () => {
  const all = { weather: 1, household: 1, symptom: 1, field: 1, cases: 1 };

  it("gives points that add up to the subtotal", () => {
    const r = computeThreatScore(
      { weather: 0.5, household: 0.5, symptom: 0.5, field: 0.5, cases: 0.5 },
      1,
      P,
    );
    const pts = Object.values(r.factors).reduce((s, f) => s + f.points, 0);
    expect(pts).toBeCloseTo(r.subtotal, 10);
    expect(r.subtotal).toBeCloseTo(50, 10);
  });

  it("keeps all indices at 1 and the densest barangay at 100", () => {
    const r = computeThreatScore(all, 1, P);
    expect(r.score).toBeCloseTo(1, 10);
    expect(r.score100).toBe(100);
  });

  it("lowers the score for a less dense barangay, never raises it", () => {
    const dense = computeThreatScore(all, 1, P);
    const sparse = computeThreatScore(all, 0, P);
    // rho = 0: factor is 1 / (1 + lambda)
    expect(sparse.densityFactor).toBeCloseTo(1 / 1.5, 10);
    expect(sparse.score).toBeLessThan(dense.score);
    expect(dense.densityFactor).toBeLessThanOrEqual(1);
  });

  it("clamps a density ratio outside [0,1]", () => {
    expect(computeThreatScore(all, 7, P).densityRatio).toBe(1);
    expect(computeThreatScore(all, -2, P).densityRatio).toBe(0);
  });

  it("always uses the configured weights, whatever the field index is", () => {
    const r = computeThreatScore({ ...all, field: 0 }, 1, P);
    expect(r.factors.weather.weight).toBe(0.2);
    expect(r.factors.household.weight).toBe(0.15);
    expect(r.factors.symptom.weight).toBe(0.1);
    expect(r.factors.field.weight).toBe(0.25);
    expect(r.factors.cases.weight).toBe(0.3);
    // The other four factors are not boosted: 100 - 25 points from the field.
    expect(r.subtotal).toBeCloseTo(75, 10);
  });

  it("uses the weights it is given, not fixed numbers", () => {
    const heavyCases: ModelParameters = {
      ...P,
      weights: { weather: 0, household: 0, symptom: 0, field: 0, cases: 1 },
    };
    const r = computeThreatScore(
      { weather: 1, household: 1, symptom: 1, field: 1, cases: 0.4 },
      1,
      heavyCases,
    );
    expect(r.score).toBeCloseTo(0.4, 10);
  });

  it("records the parameter version used", () => {
    expect(computeThreatScore(all, 1, { ...P, version: 7 }).paramsVersion).toBe(7);
  });
});

describe("validateParameters", () => {
  it("accepts the defaults (weights 20/15/10/25/30)", () => {
    expect(() => validateParameters(P)).not.toThrow();
    expect(P.weights).toEqual({
      weather: 0.2,
      household: 0.15,
      symptom: 0.1,
      field: 0.25,
      cases: 0.3,
    });
  });
  it("rejects weights that do not add up to 1", () => {
    expect(() =>
      validateParameters({ ...P, weights: { ...P.weights, cases: 0.5 } }),
    ).toThrow(/add up to 1/);
  });
  it("rejects a missing or zero data window", () => {
    expect(() =>
      validateParameters({
        ...P,
        constants: { ...P.constants, windows: { ...P.constants.windows, fieldDays: 0 } },
      }),
    ).toThrow(/windows.fieldDays/);
  });
  it("rejects a zero divisor", () => {
    expect(() =>
      validateParameters({ ...P, constants: { ...P.constants, rainMaxMm: 0 } }),
    ).toThrow(/rainMaxMm/);
  });
});

// ---------------------------------------------------------------------------
// Worked example: Penafrancia (decision wireframe), hand-calculated with the
// confirmed weights 20 / 15 / 10 / 25 / 30.
//
//   Weather   29.8 deg C -> f_T = (34.5 - 29.8) / 5.5 = 0.85455
//             160 mm / 14 days -> f_R = 1 (capped)
//             W = 0.5 * 0.85455 + 0.5 * 1                   = 0.92727
//   Household C = 0.5 * 0.6 + 0.5 * 0.6                     = 0.60000
//   Symptom   2 / 4,120 residents = 0.4854 per 1,000; / s_max 4 = 0.12136
//   Field     (6 + 10 * 0.1) / (60 + 10)                    = 0.10000
//   Cases     r = 3 / 4,120 * 10,000 = 7.2816, g = 2/2 = 1
//             H = 0.5 * 7.2816 / 8 + 0.5 * 1                = 0.95510
//
//   Points    0.92727*20 = 18.545     0.6*15 = 9.000
//             0.12136*10 =  1.214     0.1*25 = 2.500
//             0.95510*30 = 28.653
//   Subtotal  59.912
//   Density   rho = 0.95 -> (1 + 0.5 * 0.95) / 1.5 = 0.98333
//   Score     59.912 * 0.98333 = 58.91  -> shown as 59 (Elevated)
//
// (With the earlier 25/20/10/15/30 weights and s_max = 1 the same data gave
// about 70 and then 62; the weights and s_max were changed, so the expected
// value changed with them.)
// ---------------------------------------------------------------------------
describe("worked example: Penafrancia", () => {
  const penafrancia: BarangayInputs = {
    population: 4120,
    densityRatio: 0.95,
    weather: {
      dailyMeanTempC: Array(14).fill(29.8),
      // 160 mm in total, rain on 4 of the last 7 days
      dailyRainfallMm: [10, 0, 10, 0, 20, 0, 30, 0, 20, 0, 15, 25, 0, 30],
    },
    household: {
      answers: { total: 20, yes: 12 },
      reports: { total: 10, withBreeding: 6 },
      answersPrior: 0.6,
      reportsPrior: 0.6,
    },
    symptoms: { warningChecks: 2, totalChecks: 9, population: 4120 },
    field: { surveys: 4, containers: 60, positive: 6, prior: 0.1 },
    cases: { thisWeek: 3, lastWeek: 1, population: 4120 },
  };

  it("matches the hand calculation", () => {
    const r = scoreBarangay(penafrancia, P);

    expect(r.details.weather.rainDays).toBe(4);
    expect(r.details.weather.index).toBeCloseTo(0.92727, 4);
    expect(r.details.household.index).toBeCloseTo(0.6, 6);
    expect(r.details.household.confidence).toBe("good");
    expect(r.details.symptom.index).toBeCloseTo(0.12136, 4);
    expect(r.details.field.index).toBeCloseTo(0.1, 6);
    expect(r.details.cases.index).toBeCloseTo(0.9551, 4);

    expect(r.factors.weather.points).toBeCloseTo(18.545, 2);
    expect(r.factors.household.points).toBeCloseTo(9.0, 2);
    expect(r.factors.symptom.points).toBeCloseTo(1.214, 2);
    expect(r.factors.field.points).toBeCloseTo(2.5, 2);
    expect(r.factors.cases.points).toBeCloseTo(28.653, 2);

    expect(r.subtotal).toBeCloseTo(59.912, 2);
    expect(r.densityFactor).toBeCloseTo(0.98333, 4);
    expect(r.score).toBeCloseTo(0.5891, 3);
    expect(r.score100).toBe(59);
    expect(r.paramsVersion).toBe(1);
  });

  it("uses the prior, not boosted weights, when there is no recent survey", () => {
    const noSurvey = scoreBarangay(
      { ...penafrancia, field: { surveys: 0, containers: 0, positive: 0 } },
      P,
    );
    expect(noSurvey.details.field.surveyed).toBe(false);
    expect(noSurvey.details.field.index).toBeCloseTo(0.15, 10); // global prior
    expect(noSurvey.factors.field.weight).toBe(0.25);
    expect(noSurvey.factors.weather.weight).toBe(0.2);
    // Field points: 0.15 * 25 = 3.75 instead of 2.5 -> subtotal 61.162
    expect(noSurvey.subtotal).toBeCloseTo(61.162, 2);
    expect(noSurvey.score100).toBe(60);
  });

  it("scores a surveyed and an unsurveyed barangay on the same weights", () => {
    const surveyed = scoreBarangay(penafrancia, P);
    const unsurveyed = scoreBarangay(
      { ...penafrancia, field: { surveys: 0, containers: 0, positive: 0, prior: 0.1 } },
      P,
    );
    // Same prior (0.1) as the surveyed barangay's own rate: identical scores.
    expect(unsurveyed.score).toBeCloseTo(surveyed.score, 10);
  });

  it("no survey can lift a score by at most the prior's share of the field weight", () => {
    // A thoroughly clean survey: (0 + 10 * 0.15) / (100 + 10) = 0.0136
    const clean = scoreBarangay(
      { ...penafrancia, field: { surveys: 3, containers: 100, positive: 0 } },
      P,
    );
    const unsurveyed = scoreBarangay(
      { ...penafrancia, field: { surveys: 0, containers: 0, positive: 0 } },
      P,
    );
    // The gap is the field-index difference times its 25-point weight, shrunk
    // by the density factor: (0.15 - 0.0136) * 25 * 0.9833 = about 3.35 points.
    // Never the +18 points that rescaling the other weights used to give.
    const gap = (unsurveyed.score - clean.score) * 100;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeCloseTo(3.35, 1);
    expect(gap).toBeLessThan(0.15 * 25);
  });

  it("more positive containers raise the score", () => {
    const low = scoreBarangay(
      { ...penafrancia, field: { surveys: 1, containers: 60, positive: 3 } },
      P,
    );
    const high = scoreBarangay(
      { ...penafrancia, field: { surveys: 1, containers: 60, positive: 30 } },
      P,
    );
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("refuses to score with invalid parameters", () => {
    const bad = { ...P, weights: { ...P.weights, weather: 0.9 } };
    expect(() => scoreBarangay(penafrancia, bad)).toThrow();
  });
});
