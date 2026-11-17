import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { smoothedRate } from "../src/algorithms/scoring";
import {
  ABLATION_METRICS,
  AblationOptions,
  NO_SMOOTHING,
  SCENARIOS,
  SMOOTHING_METRICS,
  SOURCES,
  STRENGTHS,
  SmoothingOptions,
  VARIANTS,
  ablationCsv,
  formatAblation,
  formatSmoothing,
  rankMove,
  runAblation,
  runSmoothing,
  smoothingCsv,
  verdictFor,
  weightsWithout,
} from "../src/eval/ablation";
import { runQuality } from "../src/eval/quality";
import { EvaluationFile, readEvaluation, writeReports } from "../src/eval/reports";
import { startApi } from "./apiHelpers";

// These tests run simulations. With the default 5 s limit they fail when the machine is busy or the tests are slowed down (coverage), so they get a longer one.
vi.setConfig({ testTimeout: 60_000 });

// Leave-one-source-out and the smoothing check (Objective 1). The numbers come from a simulation, so
// the tests check what must always hold: the ranking really is the real model with one source
// removed, the volatility and verdicts mean what they say, and the saved numbers are the ones shown.

const small: AblationOptions = { barangays: 60, weeks: 14, seeds: [1, 2, 3], k: 5 };
const smallSmoothing: SmoothingOptions = { barangays: 50, weeks: 12, seeds: [1, 2], k: 5, smallShare: 0.2, smallPopulation: 120 };
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aed-abl-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  delete process.env.REPORTS_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("weightsWithout", () => {
  it("removes one weight and scales the others to add to 1, keeping their proportions", () => {
    const w = DEFAULT_PARAMETERS.weights;
    for (const source of SOURCES) {
      const out = weightsWithout(w, source);
      expect(out[source]).toBe(0);
      expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      for (const other of SOURCES.filter((s) => s !== source)) expect(out[other] / w[other]).toBeCloseTo(1 / (1 - w[source]), 12);
    }
  });
});

describe("leave-one-source-out", () => {
  const report = runAblation(small);

  it("is the real model with one source removed: the same numbers as the ranking-quality run with those weights", () => {
    const quality = (params?: typeof DEFAULT_PARAMETERS) => runQuality({ barangays: small.barangays, weeks: small.weeks, seeds: small.seeds, ks: [small.k], randomShuffles: 2, params });
    const pick = (q: ReturnType<typeof quality>, metric: string) => q.rows.find((r) => r.method === "AeDispatch" && r.k === small.k && r.metric === metric)!.value.mean;
    const mine = (variant: string, metric: string) => report.rows.find((r) => r.variant === variant && r.metric === metric)!.value.mean;

    const full = quality();
    expect(mine("model", "emergingNdcg")).toBeCloseTo(pick(full, "emergingNdcg"), 10);
    expect(mine("model", "ndcg")).toBeCloseTo(pick(full, "ndcg"), 10);

    for (const source of ["cases", "household"] as const) {
      const without = quality({ ...DEFAULT_PARAMETERS, weights: weightsWithout(DEFAULT_PARAMETERS.weights, source) });
      for (const metric of ["ndcg", "emergingNdcg", "emergingPrecision", "rateNdcg", "coverage"]) {
        expect(mine(source, metric), `${source} ${metric}`).toBeCloseTo(pick(without, metric), 10);
      }
    }
  });

  it("has every variant and metric, and what a source adds is the full model minus the model without it", () => {
    expect(report.rows).toHaveLength(VARIANTS.length * ABLATION_METRICS.length);
    expect(report.adds).toHaveLength(SOURCES.length * ABLATION_METRICS.length);
    for (const a of report.adds) {
      const model = report.rows.find((r) => r.variant === "model" && r.metric === a.metric)!.value.mean;
      const without = report.rows.find((r) => r.variant === a.source && r.metric === a.metric)!.value.mean;
      expect(a.adds.mean).toBeCloseTo(model - without, 10);
    }
  });

  it("is repeatable and prints a readable table", () => {
    expect(JSON.stringify(runAblation(small))).toBe(JSON.stringify(report));
    const text = formatAblation(report);
    expect(text).toContain("Leave-one-source-out");
    for (const source of SOURCES) expect(text).toContain(source);
  });
});

describe("the smoothing check", () => {
  const report = runSmoothing(smallSmoothing);

  it("'no smoothing' is a plain rate where there is data, and the prior only where there is nothing (never 0 / 0)", () => {
    expect(smoothedRate(0, 0, 0.2, NO_SMOOTHING)).toBeCloseTo(0.2, 6);
    expect(smoothedRate(3, 10, 0.2, NO_SMOOTHING)).toBeCloseTo(0.3, 6);
    expect(smoothedRate(3, 10, 0.2, 10)).toBeCloseTo((3 + 2) / 20, 12); // the stored strength
    expect(Number.isNaN(smoothedRate(0, 0, 0.2, 0))).toBe(true); // why exactly 0 cannot be used
  });

  it("has every scenario, smoothing strength and metric, and compares the others with the stored one", () => {
    expect(report.rows).toHaveLength(SCENARIOS.length * STRENGTHS.length * SMOOTHING_METRICS.length);
    expect(report.versus).toHaveLength(SCENARIOS.length * (STRENGTHS.length - 1) * SMOOTHING_METRICS.length);
    for (const v of report.versus) {
      const pick = (strength: string) => report.rows.find((r) => r.scenario === v.scenario && r.strength === strength && r.metric === v.metric)!.value.mean;
      expect(v.difference.mean).toBeCloseTo(pick(v.strength) - pick("stored"), 10);
    }
  });

  it("each strength with no damage equals the ranking-quality run made with that smoothing (and the strengths really differ)", () => {
    const o = { barangays: 120, weeks: 16, seeds: [1, 2, 3], k: 10, smallShare: 0.2, smallPopulation: 120 };
    const rep = runSmoothing(o);
    const stored = DEFAULT_PARAMETERS.constants.smoothing;
    const mineOf = (strength: string, metric: string) => rep.rows.find((r) => r.scenario === "full reporting" && r.strength === strength && r.metric === metric)!.value.mean;

    // Written out here on purpose (not read from the code under test): none, the stored strength, three times it.
    const expected = [{ name: "none", times: 0 }, { name: "stored", times: 1 }, { name: "3x stored", times: 3 }];
    expect(STRENGTHS.map((s) => s.name)).toEqual(expected.map((e) => e.name));
    const seen = new Set<string>();
    for (const strength of expected) {
      const scale = (m: number) => (strength.times === 0 ? NO_SMOOTHING : m * strength.times);
      const params = { ...DEFAULT_PARAMETERS, constants: { ...DEFAULT_PARAMETERS.constants, smoothing: { answers: scale(stored.answers), reports: scale(stored.reports), field: scale(stored.field) } } };
      const q = runQuality({ barangays: o.barangays, weeks: o.weeks, seeds: o.seeds, ks: [o.k], randomShuffles: 2, params });
      for (const metric of ["ndcg", "emergingNdcg"] as const) {
        const theirs = q.rows.find((r) => r.method === "AeDispatch" && r.metric === metric)!.value.mean;
        expect(mineOf(strength.name, metric), `${strength.name} ${metric}`).toBeCloseTo(theirs, 10);
      }
      seen.add(`${mineOf(strength.name, "ndcg")}|${mineOf(strength.name, "emergingNdcg")}`);
    }
    expect(seen.size).toBe(expected.length); // the three strengths give three different results, so the check can fail
  });

  it("is repeatable and prints a readable summary", () => {
    expect(JSON.stringify(runSmoothing(smallSmoothing))).toBe(JSON.stringify(report));
    const text = formatSmoothing(report);
    expect(text).toContain("Rank volatility");
    for (const s of SCENARIOS) expect(text).toContain(s.name);
  });
});

describe("rank volatility and its verdict", () => {
  it("is 0 for a ranking that did not change, and the average move otherwise", () => {
    const same = Int32Array.from([0, 1, 2, 3]);
    expect(rankMove(same, same, 4)).toBe(0);
    expect(rankMove(Int32Array.from([0, 1, 2, 3]), Int32Array.from([1, 0, 2, 3]), 4)).toBe(0.5); // two barangays swapped: 2 places in all, over 4
    expect(rankMove(Int32Array.from([0, 1, 2, 3]), Int32Array.from([3, 2, 1, 0]), 2)).toBe(2); // only the first 2 barangays count: they move 3 and 1 places, so 2 on average
  });

  it("calls LOWER volatility better, and HIGHER NDCG better", () => {
    const below = { mean: -1, low: -2, high: -0.5 };
    expect(verdictFor("rankVolatility", below)).toBe("better");
    expect(verdictFor("rankVolatility", { mean: 1, low: 0.5, high: 2 })).toBe("worse");
    expect(verdictFor("ndcg", { mean: 1, low: 0.5, high: 2 })).toBe("better");
    expect(verdictFor("ndcg", below)).toBe("worse");
    expect(verdictFor("rankVolatility", { mean: 0, low: -1, high: 1 })).toBe("tie");
  });
});

describe("saving the two reports", () => {
  const sample = (): EvaluationFile => ({
    generatedAt: "2026-11-17T00:00:00.000Z",
    mode: "quick",
    node: process.version,
    quality: runQuality({ barangays: 20, weeks: 10, seeds: [1, 2], ks: [3], randomShuffles: 10 }),
    ablation: runAblation({ barangays: 30, weeks: 12, seeds: [1, 2], k: 3 }),
    smoothing: runSmoothing({ ...smallSmoothing, barangays: 30, weeks: 10 }),
  });

  it("the CSV files show exactly the numbers of the saved report", () => {
    const dir = tempDir();
    writeReports(dir, sample());
    const saved = readEvaluation(dir)!;
    const text = (x: number | null) => (x === null ? "NaN" : String(x));
    const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));

    const ablation = read("ablation.csv");
    expect(ablation).toHaveLength(saved.ablation!.rows.length + saved.ablation!.adds.length);
    for (const r of saved.ablation!.rows) {
      const line = ablation.find((c) => c[0] === "value" && c[1] === r.variant && c[2] === r.metric)!;
      expect(line[3]).toBe(text(r.value.mean as number | null));
    }
    for (const a of saved.ablation!.adds) {
      const line = ablation.find((c) => c[0] === "source_adds" && c[1] === a.source && c[2] === a.metric)!;
      expect([line[3], line[6]]).toEqual([text(a.adds.mean as number | null), a.verdict]);
    }

    const smoothing = read("smoothing.csv");
    expect(smoothing).toHaveLength(saved.smoothing!.rows.length + saved.smoothing!.versus.length);
    for (const r of saved.smoothing!.rows) {
      const line = smoothing.find((c) => c[0] === "value" && c[1] === r.scenario && c[2] === r.strength && c[3] === r.metric)!;
      expect(line[4]).toBe(text(r.value.mean as number | null));
    }
    expect(ablationCsv(saved.ablation!).startsWith("kind,variant,metric")).toBe(true);
    expect(smoothingCsv(saved.smoothing!).startsWith("kind,scenario,strength,metric")).toBe(true);
  });

  it("is returned unchanged by the read route, for the Demo tools page", async () => {
    const dir = tempDir();
    process.env.REPORTS_DIR = dir;
    const api = await startApi();
    try {
      writeReports(dir, sample());
      const res = await (await api.officer()).get("/api/officer/evaluation");
      expect(res.status).toBe(200);
      const file = JSON.parse(fs.readFileSync(path.join(dir, "evaluation.json"), "utf8"));
      expect(res.body.ablation).toEqual(file.ablation);
      expect(res.body.smoothing).toEqual(file.smoothing);
    } finally {
      await api.close();
    }
  });
});
