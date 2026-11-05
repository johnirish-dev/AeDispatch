import { describe, it, expect } from "vitest";
import { MAX_PUROKS, SimData, dayIndex, generate, weekIndex, weeklyCases } from "../src/sim/generator";
import { binomial, mulberry32, poisson, splitCount } from "../src/sim/random";

function yesRate(d: SimData, b: number, week: number): number {
  let yes = 0;
  let total = 0;
  for (let k = 0; k < 7; k++) {
    const i = dayIndex(d, b, week * 7 + k);
    yes += d.answersYes[i];
    total += d.answersTotal[i];
  }
  return total > 0 ? yes / total : 0;
}

describe("random helpers", () => {
  it("is reproducible and stays in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it("draws counts with sensible means", () => {
    const rng = mulberry32(1);
    const mean = (f: () => number) => Array.from({ length: 4000 }, f).reduce((s, x) => s + x, 0) / 4000;
    expect(Math.abs(mean(() => poisson(rng, 4)) - 4)).toBeLessThan(0.3);
    expect(Math.abs(mean(() => poisson(rng, 80)) - 80)).toBeLessThan(1.5);
    expect(Math.abs(mean(() => binomial(rng, 20, 0.25)) - 5)).toBeLessThan(0.3);
    expect(Math.abs(mean(() => binomial(rng, 400, 0.25)) - 100)).toBeLessThan(2);
    expect(binomial(rng, 0, 0.5)).toBe(0);
    expect(binomial(rng, 5, 1)).toBe(5);
    expect(poisson(rng, 0)).toBe(0);
  });

  it("splits a count exactly", () => {
    const parts = splitCount(mulberry32(3), 17, 4);
    expect(parts).toHaveLength(4);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(17);
    expect(splitCount(mulberry32(3), 0, 3)).toEqual([0, 0, 0]);
  });
});

describe("generator", () => {
  it("gives identical data for the same seed and different data for another", () => {
    const a = generate({ barangays: 30, weeks: 8, seed: 11 });
    const b = generate({ barangays: 30, weeks: 8, seed: 11 });
    const c = generate({ barangays: 30, weeks: 8, seed: 12 });
    expect(Array.from(a.cases)).toEqual(Array.from(b.cases));
    expect(Array.from(a.answersYes)).toEqual(Array.from(b.answersYes));
    expect(Array.from(a.rainfallMm)).toEqual(Array.from(b.rainfallMm));
    expect(Array.from(a.cases)).not.toEqual(Array.from(c.cases));
  });

  it("keeps values valid", () => {
    const d = generate({ barangays: 200, weeks: 8, seed: 5 });
    for (let b = 0; b < d.barangays; b++) {
      expect(d.purokCount[b] >= 3 && d.purokCount[b] <= MAX_PUROKS).toBe(true);
      for (let day = 0; day < d.days; day++) {
        const i = dayIndex(d, b, day);
        expect(d.answersYes[i] <= d.answersTotal[i]).toBe(true);
        expect(d.reportsWithBreeding[i] <= d.reportsTotal[i]).toBe(true);
        expect(d.symptomWarning[i] <= d.symptomChecks[i]).toBe(true);
      }
      for (let w = 0; w < d.weeks; w++) {
        expect(d.positive[weekIndex(d, b, w)] <= d.containers[weekIndex(d, b, w)]).toBe(true);
      }
    }
    for (let day = 0; day < d.days; day++) {
      expect(d.rainfallMm[day] >= 0).toBe(true);
      expect(d.meanTempC[day] > 20 && d.meanTempC[day] < 40).toBe(true);
    }
  });

  it("shows warning signs before cases in outbreak barangays", () => {
    const d = generate({ barangays: 600, weeks: 8, seed: 21, outbreakFraction: 0.3 });
    const outbreaks: number[] = [];
    const calm: number[] = [];
    for (let b = 0; b < d.barangays; b++) (d.onsetWeek[b] >= 3 ? outbreaks : d.onsetWeek[b] < 0 ? calm : []).push(b);
    expect(outbreaks.length).toBeGreaterThan(20);

    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const early = avg(outbreaks.map((b) => yesRate(d, b, d.onsetWeek[b] - 1)));
    const calmRate = avg(calm.map((b) => yesRate(d, b, 3)));
    expect(early).toBeGreaterThan(calmRate + 0.1); // household signal is already up

    const casesBefore = avg(outbreaks.map((b) => weeklyCases(d, b, d.onsetWeek[b] - 1) / d.population[b]));
    const casesAt = avg(outbreaks.map((b) => weeklyCases(d, b, d.onsetWeek[b]) / d.population[b]));
    expect(casesAt).toBeGreaterThan(casesBefore * 3); // but the cases come later
  });

  it("respects overrides and keeps the hot purok in range", () => {
    const d = generate({
      barangays: 3, weeks: 8, seed: 1,
      overrides: [{ population: 4120, areaKm2: 1.8, purokCount: 6, caseOnsetWeek: 6, hotPurok: 1 }, { caseOnsetWeek: null }, { purokCount: 99, hotPurok: 99 }],
    });
    expect([d.population[0], d.areaKm2[0], d.purokCount[0], d.onsetWeek[0], d.hotPurok[0]]).toEqual([4120, Math.fround(1.8), 6, 6, 1]);
    expect(d.onsetWeek[1]).toBe(-1);
    expect(d.purokCount[2]).toBe(MAX_PUROKS);
    expect(d.hotPurok[2]).toBe(MAX_PUROKS - 1);
  });

  it("can generate the full 42,010 barangays", () => {
    const d = generate({ barangays: 42010, weeks: 8, seed: 2026 });
    expect(d.population).toHaveLength(42010);
    expect(d.cases).toHaveLength(42010 * 8 * MAX_PUROKS);
  }, 120_000);
});
