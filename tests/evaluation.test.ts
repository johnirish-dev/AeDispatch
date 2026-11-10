import { describe, expect, it } from "vitest";
import { RankingJudge } from "../src/algorithms/metrics";
import { orderByScore, caseCountScores, randomOrder } from "../src/eval/baselines";
import { QualityOptions, METHODS, runQuality } from "../src/eval/quality";
import { densityRatios, scoreAll, weatherOnlyScores } from "../src/eval/rank";
import { MAX_PUROKS, SimData, generate } from "../src/sim/generator";
import { mulberry32 } from "../src/sim/random";

const tiny: QualityOptions = { barangays: 20, weeks: 10, seeds: [1, 2, 3], ks: [3], randomShuffles: 20 };

describe("quality run", () => {
  it("gives every method a row for every metric, and compares AeDispatch with each baseline", () => {
    const report = runQuality(tiny);
    for (const m of METHODS) {
      expect(report.rows.filter((r) => r.method === m && r.k === 3).length).toBe(9); // 9 metrics
    }
    const six = (b: string) => Array(6).fill(b); // 6 paired comparisons per baseline
    expect(report.paired.map((p) => p.baseline).sort()).toEqual([...six("case-count-only"), ...six("random"), ...six("weather-only")]);
  });

  it("is repeatable: the same seeds give identical numbers", () => {
    expect(JSON.stringify(runQuality(tiny))).toBe(JSON.stringify(runQuality(tiny)));
  });
});

describe("no future data in a score", () => {
  /** A copy of the data in which everything dated after the end of week t (and the cases still unknown) is overwritten. */
  function withFutureScrambled(d: SimData, t: number, caseDelayWeeks: number): SimData {
    const c: SimData = {
      ...d,
      meanTempC: d.meanTempC.slice(),
      rainfallMm: d.rainfallMm.slice(),
      answersTotal: d.answersTotal.slice(),
      answersYes: d.answersYes.slice(),
      reportsTotal: d.reportsTotal.slice(),
      reportsWithBreeding: d.reportsWithBreeding.slice(),
      symptomChecks: d.symptomChecks.slice(),
      symptomWarning: d.symptomWarning.slice(),
      surveys: d.surveys.slice(),
      containers: d.containers.slice(),
      positive: d.positive.slice(),
      cases: d.cases.slice(),
    };
    const lastDay = 7 * t + 6;
    for (let day = lastDay + 1; day < d.days; day++) {
      c.meanTempC[day] = 40;
      c.rainfallMm[day] = 500;
      for (let b = 0; b < d.barangays; b++) {
        const i = b * d.days + day;
        c.answersTotal[i] = 999;
        c.answersYes[i] = 999;
        c.reportsTotal[i] = 999;
        c.reportsWithBreeding[i] = 999;
        c.symptomChecks[i] = 999;
        c.symptomWarning[i] = 999;
      }
    }
    for (let b = 0; b < d.barangays; b++) {
      for (let w = t + 1; w < d.weeks; w++) {
        const i = b * d.weeks + w;
        c.surveys[i] = 9;
        c.containers[i] = 90;
        c.positive[i] = 90;
      }
      // Cases of the weeks that have not been reported yet at the end of week t.
      for (let w = t - caseDelayWeeks + 1; w < d.weeks; w++) {
        for (let p = 0; p < MAX_PUROKS; p++) c.cases[(b * d.weeks + w) * MAX_PUROKS + p] = 50;
      }
    }
    return c;
  }

  const d = generate({ barangays: 30, weeks: 14, seed: 5 });
  const ratios = densityRatios(d);

  it("a score for week t does not change when the data after it change", () => {
    for (const t of [3, 5, 8]) {
      const before = scoreAll(d, t, ratios, { caseDelayWeeks: 1 });
      const after = scoreAll(withFutureScrambled(d, t, 1), t, ratios, { caseDelayWeeks: 1 });
      expect(Array.from(after)).toEqual(Array.from(before));
    }
  });

  it("the case baseline also ignores cases that have not been reported yet", () => {
    const t = 6;
    const before = caseCountScores(d, t, 1);
    const after = caseCountScores(withFutureScrambled(d, t, 1), t, 1);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it("but it does react to data that ARE known (the check can fail)", () => {
    const t = 6;
    const before = scoreAll(d, t, ratios, { caseDelayWeeks: 1 });
    const changed: SimData = { ...d, answersYes: d.answersYes.slice(), answersTotal: d.answersTotal.slice() };
    for (let b = 0; b < d.barangays; b++) {
      for (let day = 7 * t; day <= 7 * t + 6; day++) {
        changed.answersTotal[b * d.days + day] = 200;
        changed.answersYes[b * d.days + day] = 200;
      }
    }
    expect(Array.from(scoreAll(changed, t, ratios, { caseDelayWeeks: 1 }))).not.toEqual(Array.from(before));
  });
});

describe("baselines", () => {
  const d = generate({ barangays: 40, weeks: 12, seed: 9 });
  const ratios = densityRatios(d);

  it("weather-only is really the density ranking (the weather is the same for every barangay)", () => {
    const byWeather = Array.from(orderByScore(weatherOnlyScores(d, 6, ratios)));
    const byDensity = Array.from(orderByScore(ratios));
    expect(byWeather).toEqual(byDensity);
  });

  it("a random order is a permutation and differs from the next one", () => {
    const rng = mulberry32(3);
    const a = randomOrder(25, rng);
    const b = randomOrder(25, rng);
    expect(Array.from(a).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("the random baseline matches what chance predicts: Precision@k = (relevant barangays) / n", () => {
    const n = 50;
    const gains = Array.from({ length: n }, (_, b) => (b < 10 ? 10 - b : 0)); // 10 barangays had cases
    const k = 5; // the true top 5 are among them, so 5 relevant barangays
    const judge = new RankingJudge(gains, [k]);
    const rng = mulberry32(77);
    let sum = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) sum += judge.precision(randomOrder(n, rng), k);
    expect(sum / runs).toBeCloseTo(5 / 50, 1); // within 0.05 of 0.1; the run is far tighter than that
    expect(Math.abs(sum / runs - 5 / 50)).toBeLessThan(0.02);
  });
});
