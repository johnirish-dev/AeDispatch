import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runQuality } from "../src/eval/quality";
import {
  FAIRNESS_METHODS,
  FairnessOptions,
  GROUPINGS,
  SCENARIOS,
  fairnessCsv,
  formatFairness,
  groupIndex,
  groupsOf,
  runFairness,
} from "../src/eval/fairness";
import { EvaluationFile, readEvaluation, writeReports } from "../src/eval/reports";
import { generate, lowReportingBarangays } from "../src/sim/generator";
import { startApi } from "./apiHelpers";

// These tests run simulations. With the default 5 s limit they fail when the machine is busy or the tests are slowed down (coverage), so they get a longer one.
vi.setConfig({ testTimeout: 60_000 });

// Fairness by group (Objective 3). The numbers come from a simulation, so the tests check what must
// always hold: the simulator's new option changes only what it says it changes, the groups are what
// they claim to be, the control really is a control, and the saved numbers are the ones shown.

const tiny: FairnessOptions = { barangays: 60, weeks: 14, seeds: [1, 2, 3], ks: [5, 10], lowReportingShare: 0.3, lowReportingRate: 0.25, randomShuffles: 5 };
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aed-fair-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  delete process.env.REPORTS_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ARRAYS = ["population", "areaKm2", "purokCount", "onsetWeek", "hotPurok", "meanTempC", "rainfallMm", "answersTotal", "answersYes", "reportsTotal", "reportsWithBreeding", "symptomChecks", "symptomWarning", "surveys", "containers", "positive", "cases"] as const;
const REPORTING_ARRAYS = ["answersTotal", "answersYes", "reportsTotal", "reportsWithBreeding", "symptomChecks", "symptomWarning"] as const;

describe("the simulator's option for uneven reporting", () => {
  const options = { barangays: 80, weeks: 14, seed: 4 };
  const base = generate(options);

  it("changes nothing when it is off (the default simulator is exactly what it was)", () => {
    const off = generate({ ...options, lowReportingShare: 0 });
    for (const key of ARRAYS) expect(Array.from(off[key]), key).toEqual(Array.from(base[key]));
    expect(Array.from(base.reportingRate).every((r) => r === 1)).toBe(true);
  });

  it("makes exactly the chosen share of barangays report at the chosen rate, and nothing else about the municipality differs", () => {
    const low = generate({ ...options, lowReportingShare: 0.3, lowReportingRate: 0.25 });
    const chosen = lowReportingBarangays(options.seed, options.barangays, 0.3);
    expect(chosen.size).toBe(24);
    for (let b = 0; b < options.barangays; b++) expect(low.reportingRate[b]).toBe(chosen.has(b) ? 0.25 : 1);

    // the municipality itself: identical
    for (const key of ["population", "areaKm2", "purokCount", "onsetWeek", "hotPurok", "meanTempC", "rainfallMm", "surveys", "containers", "positive", "cases"] as const) {
      expect(Array.from(low[key]), key).toEqual(Array.from(base[key]));
    }
    // the barangays that report as usual: identical reports
    for (let b = 0; b < options.barangays; b++) {
      if (chosen.has(b)) continue;
      for (const key of REPORTING_ARRAYS) {
        for (let k = 0; k < base.days; k++) expect(low[key][b * base.days + k]).toBe(base[key][b * base.days + k]);
      }
    }
  });

  it("thins the low reporters to about the chosen share, and never adds a report or lets 'yes' exceed the total", () => {
    const low = generate({ ...options, lowReportingShare: 0.3, lowReportingRate: 0.25 });
    const chosen = [...lowReportingBarangays(options.seed, options.barangays, 0.3)];
    for (const [total, part] of [["answersTotal", "answersYes"], ["reportsTotal", "reportsWithBreeding"], ["symptomChecks", "symptomWarning"]] as const) {
      let before = 0;
      let after = 0;
      for (const b of chosen) {
        for (let k = 0; k < base.days; k++) {
          const i = b * base.days + k;
          before += base[total][i];
          after += low[total][i];
          expect(low[total][i]).toBeLessThanOrEqual(base[total][i]);
          expect(low[part][i]).toBeLessThanOrEqual(low[total][i]);
        }
      }
      expect(after / before, total).toBeGreaterThan(0.2);
      expect(after / before, total).toBeLessThan(0.3);
    }
  });
});

describe("the groups", () => {
  const d = generate({ barangays: 30, weeks: 12, seed: 2 });

  it("splits the barangays by size into three equal thirds, smallest to largest", () => {
    const index = groupIndex(d, "size", new Set());
    const sizes = [0, 1, 2].map((g) => Array.from(index).filter((x) => x === g).length);
    expect(sizes).toEqual([10, 10, 10]);
    const populations = (g: number) => Array.from(index).flatMap((x, b) => (x === g ? [d.population[b]] : []));
    expect(Math.max(...populations(0))).toBeLessThanOrEqual(Math.min(...populations(1)));
    expect(Math.max(...populations(1))).toBeLessThanOrEqual(Math.min(...populations(2)));
  });

  it("puts exactly the low reporters in the 'reports little' group", () => {
    const low = lowReportingBarangays(2, 30, 0.3);
    const index = groupIndex(d, "reporting", low);
    for (let b = 0; b < 30; b++) expect(index[b]).toBe(low.has(b) ? 1 : 0);
  });
});

describe("the fairness report", () => {
  const report = runFairness(tiny);

  it("has a row for every group, method and k, and a gap for every method and k", () => {
    let groupRows = 0;
    let gapRows = 0;
    for (const scenario of SCENARIOS) {
      for (const grouping of GROUPINGS[scenario]) {
        groupRows += groupsOf(grouping).length * FAIRNESS_METHODS.length * tiny.ks.length;
        gapRows += FAIRNESS_METHODS.length * tiny.ks.length;
      }
    }
    expect(report.groups).toHaveLength(groupRows);
    expect(report.gaps.length).toBeLessThanOrEqual(gapRows);
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report.costs).toHaveLength(FAIRNESS_METHODS.length * tiny.ks.length);
  });

  it("keeps every share between 0 and 1, and the worst/best ratio at most 1", () => {
    for (const r of report.groups) for (const x of [r.caught.mean, r.caught.low, r.caught.high]) if (Number.isFinite(x)) expect(x >= 0 && x <= 1).toBe(true);
    for (const g of report.gaps) {
      expect(g.bestGroup).not.toBe(g.worstGroup);
      if (Number.isFinite(g.ratio.mean)) expect(g.ratio.mean).toBeLessThanOrEqual(1 + 1e-12);
      expect(g.gap.mean).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("has a real control: ranking methods that ignore resident reports do not change at all when the reporting drops", () => {
    for (const c of report.costs.filter((x) => x.method !== "AeDispatch")) {
      expect(c.change.mean, `${c.method} k=${c.k}`).toBe(0);
      expect(c.withLowReporting.mean).toBe(c.withUsualReporting.mean);
    }
  });

  it("reports the change as the catch rate with low reporting minus the catch rate with usual reporting", () => {
    for (const c of report.costs) {
      if (Number.isFinite(c.change.mean)) expect(c.change.mean).toBeCloseTo(c.withLowReporting.mean - c.withUsualReporting.mean, 10);
    }
  });

  it("is repeatable and prints a readable summary", () => {
    expect(JSON.stringify(runFairness(tiny))).toBe(JSON.stringify(report));
    const text = formatFairness(report);
    expect(text).toContain("Fairness by group");
    expect(text).toContain("What the low reporting itself costs");
    for (const m of FAIRNESS_METHODS) expect(text).toContain(m);
  });
});

describe("saving the fairness report", () => {
  const sample = (): EvaluationFile => ({
    generatedAt: "2026-11-17T00:00:00.000Z",
    mode: "quick",
    node: process.version,
    quality: runQuality({ barangays: 20, weeks: 10, seeds: [1, 2], ks: [3], randomShuffles: 10 }),
    fairness: runFairness({ ...tiny, barangays: 40, weeks: 12, seeds: [1, 2], ks: [5] }),
  });

  it("the CSV file shows exactly the numbers of the saved report", () => {
    const dir = tempDir();
    writeReports(dir, sample());
    const saved = readEvaluation(dir)!.fairness!;
    const text = (x: number | null) => (x === null ? "NaN" : String(x));
    const rows = fs.readFileSync(path.join(dir, "fairness.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    expect(rows).toHaveLength(saved.groups.length + saved.gaps.length * 2 + saved.costs.length);

    for (const g of saved.groups) {
      const line = rows.find((c) => c[0] === "group" && c[1] === g.scenario && c[2] === g.grouping && c[3] === g.group && c[4] === g.method && c[5] === String(g.k))!;
      expect(line[6]).toBe(text(g.caught.mean as number | null));
    }
    for (const c of saved.costs) {
      const line = rows.find((r) => r[0] === "cost_of_low_reporting" && r[4] === c.method && r[5] === String(c.k))!;
      expect([line[6], line[9]]).toEqual([text(c.change.mean as number | null), c.verdict]);
    }
    expect(fairnessCsv(saved).startsWith("kind,scenario,grouping,group,method,k,mean,low,high,note")).toBe(true);
  });

  it("is returned unchanged by the read route, for the Demo tools page", async () => {
    const dir = tempDir();
    process.env.REPORTS_DIR = dir;
    const api = await startApi();
    try {
      writeReports(dir, sample());
      const res = await (await api.officer()).get("/api/officer/evaluation");
      expect(res.status).toBe(200);
      expect(res.body.fairness).toEqual(JSON.parse(fs.readFileSync(path.join(dir, "evaluation.json"), "utf8")).fairness);
    } finally {
      await api.close();
    }
  });
});
