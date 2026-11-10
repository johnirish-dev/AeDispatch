import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runQuality } from "../src/eval/quality";
import { EvaluationFile, readEvaluation, writeReports } from "../src/eval/reports";
import { runRobustness } from "../src/eval/robustness";
import { runSensitivity } from "../src/eval/sensitivity";
import { startApi } from "./apiHelpers";

const tiny = { barangays: 20, weeks: 10, seeds: [1, 2, 3], ks: [3], randomShuffles: 20 };
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aed-reports-"));
  dirs.push(dir);
  return dir;
};
const sample = (): EvaluationFile => ({ generatedAt: "2026-11-10T00:00:00.000Z", mode: "quick", node: process.version, quality: runQuality(tiny) });

afterEach(() => {
  delete process.env.REPORTS_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("saved evaluation", () => {
  it("the CSV file shows exactly the numbers of the saved report", () => {
    const dir = tempDir();
    writeReports(dir, sample());
    const saved = readEvaluation(dir)!;
    const lines = fs.readFileSync(path.join(dir, "quality.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    const text = (x: number | null) => (x === null ? "NaN" : String(x)); // JSON has no NaN: it is saved as null

    for (const r of saved.quality.rows) {
      const line = lines.find((c) => c[0] === "value" && c[1] === r.method && c[2] === String(r.k) && c[3] === r.metric)!;
      expect(line, `${r.method} k=${r.k} ${r.metric}`).toBeDefined();
      expect([line[4], line[5], line[6]]).toEqual([text(r.value.mean as number | null), text(r.value.low as number | null), text(r.value.high as number | null)]);
    }
    for (const p of saved.quality.paired) {
      const line = lines.find((c) => c[0] === "paired_difference" && c[1] === `AeDispatch-minus-${p.baseline}` && c[2] === String(p.k) && c[3] === p.metric)!;
      expect(line).toBeDefined();
      expect([line[4], line[7]]).toEqual([text(p.difference.mean as number | null), p.verdict]);
    }
    expect(lines.length).toBe(saved.quality.rows.length + saved.quality.paired.length);
  });

  it("the robustness and sensitivity CSV files also show exactly the saved numbers", () => {
    const dir = tempDir();
    const small = { barangays: 24, weeks: 12, seeds: [1, 2], k: 3, randomShuffles: 10 };
    writeReports(dir, { ...sample(), robustness: runRobustness(small), sensitivity: runSensitivity(small) });
    const saved = readEvaluation(dir)!;
    const text = (x: number | null) => (x === null ? "NaN" : String(x));
    const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));

    const robust = read("robustness.csv");
    expect(robust.length).toBe(saved.robustness!.rows.length);
    for (const r of saved.robustness!.rows) {
      const line = robust.find((c) => c[0] === r.scenario && c[1] === String(r.level) && c[2] === r.method && c[4] === r.metric)!;
      expect(line, `${r.scenario} ${r.level} ${r.method} ${r.metric}`).toBeDefined();
      expect(line[5]).toBe(text(r.value.mean as number | null));
    }

    const sens = read("sensitivity.csv");
    expect(sens.length).toBe(saved.sensitivity!.rows.length + saved.sensitivity!.paired.length);
    for (const r of saved.sensitivity!.rows) {
      const line = sens.find((c) => c[0] === "value" && c[1] === r.variable && c[2] === String(r.value) && c[3] === r.method && c[5] === r.metric)!;
      expect(line).toBeDefined();
      expect(line[6]).toBe(text(r.interval.mean as number | null));
    }
  });

  it("reading a folder with no evaluation gives null", () => {
    expect(readEvaluation(tempDir())).toBeNull();
  });
});

describe("GET /api/officer/evaluation", () => {
  it("needs an officer session", async () => {
    const api = await startApi();
    try {
      expect((await api.client().get("/api/officer/evaluation")).status).toBe(401);
    } finally {
      await api.close();
    }
  });

  it("says so plainly when no evaluation has been run, then returns the saved report unchanged", async () => {
    const dir = tempDir();
    process.env.REPORTS_DIR = dir;
    const api = await startApi();
    try {
      const officer = await api.officer();
      const none = await officer.get("/api/officer/evaluation");
      expect(none.status).toBe(404);
      expect(none.body.error).toMatch(/npm run evaluate/);

      writeReports(dir, sample());
      const res = await officer.get("/api/officer/evaluation");
      expect(res.status).toBe(200);
      // exactly what is in the file (the page and the CSV can only show these numbers)
      expect(res.body).toEqual(JSON.parse(fs.readFileSync(path.join(dir, "evaluation.json"), "utf8")));
      expect(res.body.mode).toBe("quick");
    } finally {
      await api.close();
    }
  });
});
