import { describe, expect, it } from "vitest";
import { DEGRADATIONS, cloneSim } from "../src/eval/degrade";
import { runQuality } from "../src/eval/quality";
import { runRobustness } from "../src/eval/robustness";
import { runSensitivity } from "../src/eval/sensitivity";
import { SimData, generate, weeklyCases } from "../src/sim/generator";
import { mulberry32 } from "../src/sim/random";

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
const same = (a: SimData, b: SimData) =>
  (["answersTotal", "answersYes", "reportsTotal", "reportsWithBreeding", "symptomChecks", "symptomWarning", "surveys", "containers", "positive", "cases"] as const).every(
    (k) => sum(a[k]) === sum(b[k]),
  ) && sum(a.meanTempC) === sum(b.meanTempC) && sum(a.rainfallMm) === sum(b.rainfallMm);

describe("damaging the data", () => {
  const d = generate({ barangays: 60, weeks: 12, seed: 4 });
  const find = (name: string) => DEGRADATIONS.find((x) => x.name === name)!;

  it("never changes the original data", () => {
    const before = cloneSim(d);
    for (const deg of DEGRADATIONS) for (const level of deg.levels) deg.apply(d, level, mulberry32(1));
    expect(same(d, before)).toBe(true);
  });

  it("thins household answers and reports by about the share asked for, keeping the yes rate", () => {
    const c = find("household").apply(d, 0.5, mulberry32(2));
    expect(sum(c.answersTotal) / sum(d.answersTotal)).toBeGreaterThan(0.45);
    expect(sum(c.answersTotal) / sum(d.answersTotal)).toBeLessThan(0.55);
    const rate = (x: SimData) => sum(x.answersYes) / sum(x.answersTotal);
    expect(Math.abs(rate(c) - rate(d))).toBeLessThan(0.03);
  });

  it("removes about the share of weather days asked for", () => {
    const c = find("weather").apply(d, 0.3, mulberry32(3));
    const missing = Array.from(c.meanTempC).filter((x) => Number.isNaN(x)).length / c.days;
    expect(missing).toBeGreaterThan(0.15);
    expect(missing).toBeLessThan(0.45);
  });

  it("spam floods some barangays with only 'yes' answers and breeding reports", () => {
    const c = find("spam").apply(d, 0.2, mulberry32(5));
    const flooded: number[] = [];
    for (let b = 0; b < c.barangays; b++) {
      const i = b * c.days;
      if (c.answersTotal[i] > d.answersTotal[i] && c.answersYes[i] === c.answersTotal[i]) flooded.push(b);
    }
    expect(flooded.length).toBeGreaterThan(3);
    expect(flooded.length).toBeLessThan(25);
  });

  it("biased surveys survive only where cases were already seen in the previous two weeks", () => {
    const c = find("field_biased").apply(d, 1, mulberry32(6));
    for (let b = 0; b < d.barangays; b++) {
      for (let w = 0; w < d.weeks; w++) {
        const seen = (w >= 1 ? weeklyCases(d, b, w - 1) : 0) + (w >= 2 ? weeklyCases(d, b, w - 2) : 0);
        if (seen === 0) expect(c.surveys[b * d.weeks + w]).toBe(0);
      }
    }
  });

  it("missing case reports zero whole barangay-weeks", () => {
    const c = find("cases").apply(d, 0.5, mulberry32(7));
    expect(sum(c.cases)).toBeLessThan(sum(d.cases));
    expect(sum(c.cases)).toBeGreaterThan(0);
  });
});

describe("judging uses what really happened, not the damaged data", () => {
  const opts = { barangays: 60, weeks: 14, seeds: [1, 2, 3, 4], ks: [5], randomShuffles: 10 };
  const value = (report: ReturnType<typeof runQuality>, method: string, metric: string) => report.rows.find((r) => r.method === method && r.metric === metric)!.value.mean;

  it("losing half of the case reports makes the case-count ranking worse, and the random baseline does not move", () => {
    const clean = runQuality(opts);
    const damaged = runQuality({ ...opts, degrade: (truth, rng) => DEGRADATIONS.find((x) => x.name === "cases")!.apply(truth, 0.5, rng) });
    expect(value(damaged, "case-count-only", "ndcg")).toBeLessThan(value(clean, "case-count-only", "ndcg"));
    // random is judged against the same truth with the same seeds: unchanged
    expect(value(damaged, "random", "ndcg")).toBeCloseTo(value(clean, "random", "ndcg"), 10);
  });

  it("reports the per-10,000 view too, between 0 and 1", () => {
    const r = runQuality(opts);
    for (const m of ["AeDispatch", "case-count-only", "weather-only", "random"]) {
      for (const metric of ["ratePrecision", "rateNdcg"]) {
        const v = value(r, m, metric);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the early-signal lead of the simulator", () => {
  it("the default is unchanged (3)", () => {
    const a = generate({ barangays: 30, weeks: 12, seed: 8 });
    const b = generate({ barangays: 30, weeks: 12, seed: 8, leadWeeks: 3 });
    expect(Array.from(a.answersYes)).toEqual(Array.from(b.answersYes));
  });

  it("lead 1 and lead 0 both mean no early warning (the ramp is 0 in its first week)", () => {
    const a = generate({ barangays: 30, weeks: 12, seed: 8, leadWeeks: 1 });
    const b = generate({ barangays: 30, weeks: 12, seed: 8, leadWeeks: 0 });
    expect(Array.from(a.answersYes)).toEqual(Array.from(b.answersYes));
  });

  it("a longer lead raises the signals earlier: the 'yes' rate two weeks before the jump is higher", () => {
    // Compare rates inside each data set's own outbreak barangays (the data sets differ in other draws).
    const yesRateTwoWeeksBefore = (d: SimData) => {
      let yes = 0;
      let total = 0;
      for (let b = 0; b < d.barangays; b++) {
        const onset = d.onsetWeek[b];
        if (onset < 3 || onset >= d.weeks) continue;
        for (let k = 0; k < 7; k++) {
          const i = b * d.days + (onset - 2) * 7 + k;
          yes += d.answersYes[i];
          total += d.answersTotal[i];
        }
      }
      return yes / total;
    };
    const short = generate({ barangays: 200, weeks: 14, seed: 8, leadWeeks: 1, outbreakFraction: 0.4 });
    const long = generate({ barangays: 200, weeks: 14, seed: 8, leadWeeks: 4, outbreakFraction: 0.4 });
    expect(yesRateTwoWeeksBefore(long)).toBeGreaterThan(yesRateTwoWeeksBefore(short) + 0.1);
  });
});

describe("robustness and sensitivity reports", () => {
  const small = { barangays: 30, weeks: 12, seeds: [1, 2], k: 3, randomShuffles: 10 };

  it("cover every kind of damage and every variable, and are repeatable", () => {
    const r = runRobustness(small);
    for (const deg of DEGRADATIONS) expect(r.rows.some((x) => x.scenario === deg.name)).toBe(true);
    expect(r.rows.some((x) => x.scenario === "clean")).toBe(true);
    expect(JSON.stringify(runRobustness(small))).toBe(JSON.stringify(r));

    const s = runSensitivity(small);
    for (const variable of ["leadWeeks", "caseDelayWeeks", "outbreakFraction"]) expect(s.rows.some((x) => x.variable === variable)).toBe(true);
    // the lead is reported as visible early-signal weeks: 4, 3, 2, 1, 0
    expect([...new Set(s.rows.filter((x) => x.variable === "leadWeeks").map((x) => x.value))].sort()).toEqual([0, 1, 2, 3, 4]);
  }, 60_000); // runs the simulation several times; the default 5 s is too short on a slow or busy machine
});
