import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { recommendedAction } from "../src/algorithms/risk";
import { runQuality } from "../src/eval/quality";
import { evaluateSeed } from "../src/eval/quality";
import { EvaluationFile, readEvaluation, writeReports } from "../src/eval/reports";
import { TIER_METHODS, TierOptions, capacityCsv, checkTier2Property, evaluateTierSeed, formatTiers, runTiers, tiersCsv } from "../src/eval/tiers";
import { generate } from "../src/sim/generator";
import { startApi } from "./apiHelpers";

// Tier 1, the capacity curve and Tier 2 (Objective 2). The numbers are results of a simulation, so the
// tests check what must always hold: the rules are the real ones, the comparison is at equal
// workload, coverage can only rise with more teams, and the saved numbers are the ones shown.

const tiny: TierOptions = { barangays: 40, weeks: 14, seeds: [1, 2, 3], maxK: 8, overCapacityKs: [3, 5], randomShuffles: 10 };
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aed-tiers-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  delete process.env.REPORTS_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("the Tier 2 property check", () => {
  it("finds no combination of score and purok counts that breaks the rule", () => {
    const result = checkTier2Property();
    expect(result.checks).toBeGreaterThan(50);
    expect(result.violations).toBe(0);
  });

  it("rests on the real rule: a top score never unlocks Tier 2, and a cluster always does and brings Tier 1", () => {
    const min = DEFAULT_PARAMETERS.constants.tier2.minCases;
    const justBelow = recommendedAction(100, [{ purok: "P0", cases: min - 1 }, { purok: "P1", cases: min - 1 }], DEFAULT_PARAMETERS);
    expect(justBelow.tier2.unlocked).toBe(false);
    expect(justBelow.action).toBe("tier1"); // the score of 100 still asks for a Tier 1 inspection

    const cluster = recommendedAction(0, [{ purok: "P0", cases: min }], DEFAULT_PARAMETERS);
    expect(cluster.tier2.unlocked).toBe(true);
    expect(cluster.action).toBe("tier1"); // even a score of 0 does not read Monitor where a cluster is open
  });
});

describe("the tier report", () => {
  const report = runTiers(tiny);

  it("has every method for every measure, and every k", () => {
    expect(report.tier1).toHaveLength(TIER_METHODS.length * 3);
    expect(report.capacity).toHaveLength(TIER_METHODS.length * tiny.maxK);
    expect(report.burden.filter((b) => b.metric === "weeksOverCapacity").map((b) => b.k)).toEqual([3, 5]);
    expect(report.settings.tier1ScoreThreshold).toBe(40);
    expect(report.settings.tier2MinCases).toBe(3);
  });

  it("keeps every share between 0 and 1", () => {
    const shares = [...report.tier1.map((r) => r.value), ...report.capacity.map((r) => r.value), report.tier2.shareOfBarangayWeeks, report.tier2.shareStillWithCases, report.tier2.shareBelowTier1Score];
    for (const v of shares) {
      for (const x of [v.mean, v.low, v.high]) if (Number.isFinite(x)) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThanOrEqual(1);
    }
  });

  it("can only gain coverage with more teams (the capacity curve never falls)", () => {
    for (const method of TIER_METHODS) {
      const curve = report.capacity.filter((r) => r.method === method).sort((a, b) => a.k - b.k).map((r) => r.value.mean);
      for (let i = 1; i < curve.length; i++) {
        if (Number.isFinite(curve[i]) && Number.isFinite(curve[i - 1])) expect(curve[i], `${method} k=${i + 1}`).toBeGreaterThanOrEqual(curve[i - 1] - 1e-12);
      }
    }
  });

  it("is repeatable: the same seeds give identical numbers", () => {
    expect(JSON.stringify(runTiers(tiny))).toBe(JSON.stringify(report));
  });

  it("prints a readable summary with the three parts", () => {
    const text = formatTiers(report);
    expect(text).toContain("(a) Tier 1");
    expect(text).toContain("(b) Capacity");
    expect(text).toContain("(c) Tier 2");
    for (const m of TIER_METHODS) expect(text).toContain(m);
  });

  it("copes with a municipality that has no outbreak at all (shows n/a instead of failing)", () => {
    const none = runTiers({ ...tiny, outbreakFraction: 0, seeds: [1, 2] });
    expect(() => formatTiers(none)).not.toThrow();
    expect(none.capacity.every((r) => Number.isNaN(r.value.mean))).toBe(true);
  });
});

describe("one simulated municipality", () => {
  const d = generate({ barangays: 60, weeks: 16, seed: 5 });
  const resolved = { maxK: 10, overCapacityKs: [3], caseDelayWeeks: 1, randomShuffles: 8, params: DEFAULT_PARAMETERS };
  const result = evaluateTierSeed(d, 5, resolved);

  it("holds the baselines to the same workload as the Tier 1 rule (otherwise recommending everyone would win)", () => {
    expect(result.flagged.AeDispatch).toBeGreaterThan(0);
    for (const m of TIER_METHODS) expect(result.flagged[m], m).toBeCloseTo(result.flagged.AeDispatch, 6);
  });

  it("measures coverage the same way as the ranking-quality run (AeDispatch, any k)", () => {
    const ks = [3, 10];
    const quality = evaluateSeed(d, 5, { ks, caseDelayWeeks: 1, randomShuffles: 2, params: DEFAULT_PARAMETERS });
    ks.forEach((k, i) => {
      expect(result.capacity.AeDispatch[k - 1]).toBeCloseTo(quality.AeDispatch[i].coverage, 10);
      expect(result.capacity["case-count-only"][k - 1]).toBeCloseTo(quality["case-count-only"][i].coverage, 10);
    });
  });
});

describe("saving the tiers", () => {
  const sample = (): EvaluationFile => ({
    generatedAt: "2026-11-17T00:00:00.000Z",
    mode: "quick",
    node: process.version,
    quality: runQuality({ barangays: 20, weeks: 10, seeds: [1, 2], ks: [3], randomShuffles: 10 }),
    tiers: runTiers(tiny),
  });

  it("the CSV files show exactly the numbers of the saved report", () => {
    const dir = tempDir();
    writeReports(dir, sample());
    const saved = readEvaluation(dir)!.tiers!;
    const text = (x: number | null) => (x === null ? "NaN" : String(x));

    const capacity = fs.readFileSync(path.join(dir, "capacity.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    expect(capacity).toHaveLength(saved.capacity.length);
    for (const r of saved.capacity) {
      const line = capacity.find((c) => c[0] === r.method && c[1] === String(r.k))!;
      expect(line.slice(2)).toEqual([text(r.value.mean as number | null), text(r.value.low as number | null), text(r.value.high as number | null)]);
    }

    const tiers = fs.readFileSync(path.join(dir, "tiers.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    for (const r of saved.tier1) {
      const line = tiers.find((c) => c[0] === "tier1" && c[1] === r.method && c[2] === r.metric)!;
      expect(line[4]).toBe(text(r.value.mean as number | null));
    }
    expect(tiers.find((c) => c[2] === "property_violations")![4]).toBe(String(saved.tier2.property.violations));
    expect(tiersCsv(saved).startsWith("section,method,metric,k,mean,low,high")).toBe(true);
    expect(capacityCsv(saved).startsWith("method,k,coverage_mean")).toBe(true);
  });

  it("is returned unchanged by the read route, for the Demo tools page", async () => {
    const dir = tempDir();
    process.env.REPORTS_DIR = dir;
    const api = await startApi();
    try {
      writeReports(dir, sample());
      const res = await (await api.officer()).get("/api/officer/evaluation");
      expect(res.status).toBe(200);
      expect(res.body.tiers).toEqual(JSON.parse(fs.readFileSync(path.join(dir, "evaluation.json"), "utf8")).tiers);
    } finally {
      await api.close();
    }
  });
});
