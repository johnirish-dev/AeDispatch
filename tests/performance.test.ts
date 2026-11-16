import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PerformanceOptions, formatPerformance, logLogSlope, performanceCsv, runPerformance } from "../src/eval/performance";
import { EvaluationFile, readEvaluation, writeReports } from "../src/eval/reports";
import { runQuality } from "../src/eval/quality";
import { startApi } from "./apiHelpers";

// The timing of the Max Heap against sorting the whole list again. The numbers themselves change
// from run to run and machine to machine, so these tests check the SHAPE of the report, that both
// methods agree on the answer, and one difference that is large enough never to be noise.

const tiny: PerformanceOptions = { sizes: [8, 50], reps: 5, warmup: 2, scoreReps: 3, scoreRepsLarge: 2, k: 3, seed: 1 };
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aed-perf-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  delete process.env.REPORTS_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("logLogSlope", () => {
  it("is 1 for time that grows with n, 2 for n squared, and 0 for a constant", () => {
    const ns = [100, 1000, 10000];
    expect(logLogSlope(ns.map((n) => ({ n, time: 3 * n })))).toBeCloseTo(1, 6);
    expect(logLogSlope(ns.map((n) => ({ n, time: n * n })))).toBeCloseTo(2, 6);
    expect(logLogSlope(ns.map((n) => ({ n, time: 5 })))).toBeCloseTo(0, 6);
  });

  it("gives null when there are fewer than two usable points", () => {
    expect(logLogSlope([])).toBeNull();
    expect(logLogSlope([{ n: 100, time: 1 }])).toBeNull();
    expect(logLogSlope([{ n: 100, time: 1 }, { n: 1000, time: 0 }])).toBeNull();
  });
});

describe("the timing report", () => {
  it("has every measurement for every size, with median <= slowest 5%", () => {
    const report = runPerformance(tiny);
    expect(report.rows.map((r) => r.n)).toEqual([8, 50]);
    for (const row of report.rows) {
      expect(row.rankingsAgree).toBe(true);
      for (const key of ["heapUpdate", "heapRefresh", "resortRefresh", "heapBatchRefresh", "resortBatchRefresh", "heapBuild", "resortBuild", "scoreAndUpdate", "rescoreAll"] as const) {
        const t = row[key];
        expect(t.median, `${row.n} ${key}`).toBeGreaterThan(0);
        expect(t.p95, `${row.n} ${key}`).toBeGreaterThanOrEqual(t.median);
        expect(t.reps).toBeGreaterThan(0);
      }
      expect(row.heapUpdate.reps).toBe(tiny.reps);
      expect(row.scoreAndUpdate.reps).toBe(tiny.scoreReps);
    }
    // 1 percent of the barangays, but at least one
    expect(report.rows.map((r) => r.batchSize)).toEqual([1, 1]);
  });

  it("records the machine, so a reader knows where the numbers come from", () => {
    const { machine } = runPerformance({ ...tiny, sizes: [8] });
    expect(machine.node).toBe(process.version);
    expect(machine.cores).toBeGreaterThan(0);
    expect(machine.memoryGb).toBeGreaterThan(0);
    expect(machine.cpu.length).toBeGreaterThan(0);
  });

  it("measures slopes only from sizes of 100 or more, and checks the paper's limits from 720 up", () => {
    const small = runPerformance(tiny);
    expect(small.slopes.heapRefresh).toBeNull();
    expect(small.requirements).toEqual([]);

    const bigger = runPerformance({ ...tiny, sizes: [100, 400, 800], reps: 3, warmup: 1 });
    for (const slope of Object.values(bigger.slopes)) expect(Number.isFinite(slope)).toBe(true);
    expect(bigger.requirements.every((r) => r.n >= 720 && r.limitMs > 0)).toBe(true);
    expect(bigger.requirements.map((r) => r.limitMs).sort((a, b) => a - b)).toEqual([50, 2000]);
  });

  it("shows the heap far ahead of sorting everything again once the list is large (a gap that is never noise)", () => {
    const { rows } = runPerformance({ ...tiny, sizes: [3000], reps: 20, warmup: 5, scoreReps: 2, scoreRepsLarge: 2 });
    expect(rows[0].rankingsAgree).toBe(true);
    expect(rows[0].heapRefresh.median * 20).toBeLessThan(rows[0].resortRefresh.median);
  });

  it("prints a table with every size, the machine and the growth", () => {
    const report = runPerformance(tiny);
    const text = formatPerformance(report);
    expect(text).toContain("Machine:");
    expect(text).toContain("Growth with n");
    for (const n of tiny.sizes) expect(text).toMatch(new RegExp(`^${n}\\s`, "m"));
  });
});

describe("saving the timing", () => {
  const sample = (): EvaluationFile => ({
    generatedAt: "2026-11-16T00:00:00.000Z",
    mode: "quick",
    node: process.version,
    quality: runQuality({ barangays: 20, weeks: 10, seeds: [1, 2], ks: [3], randomShuffles: 10 }),
    performance: runPerformance(tiny),
  });

  it("the CSV file shows exactly the numbers of the saved report", () => {
    const dir = tempDir();
    writeReports(dir, sample());
    const saved = readEvaluation(dir)!.performance!;
    const rows = fs.readFileSync(path.join(dir, "performance.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    expect(rows.length).toBe(saved.rows.length * 9);
    const find = (n: number, measure: string) => rows.find((c) => c[0] === String(n) && c[1] === measure)!;
    for (const r of saved.rows) {
      expect(find(r.n, "heap_update").slice(2, 5)).toEqual([String(r.heapUpdate.median), String(r.heapUpdate.p95), String(r.heapUpdate.reps)]);
      expect(find(r.n, "resort_change_and_top_k")[2]).toBe(String(r.resortRefresh.median));
      expect(find(r.n, "rescore_all")[2]).toBe(String(r.rescoreAll.median));
    }
    expect(performanceCsv(saved).split("\n")[0]).toBe("n,measure,median_us,p95_us,reps,batch_size");
  });

  it("is returned unchanged by the read route, for the Demo tools page", async () => {
    const dir = tempDir();
    process.env.REPORTS_DIR = dir;
    const api = await startApi();
    try {
      writeReports(dir, sample());
      const res = await (await api.officer()).get("/api/officer/evaluation");
      expect(res.status).toBe(200);
      expect(res.body.performance).toEqual(JSON.parse(fs.readFileSync(path.join(dir, "evaluation.json"), "utf8")).performance);
      expect(res.body.performance.rows).toHaveLength(2);
    } finally {
      await api.close();
    }
  });
});
