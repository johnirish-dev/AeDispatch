import { describe, it, expect } from "vitest";
import { OFFICER_PASSWORD, OFFICER_USERNAME, seedDatabase } from "../src/db/seedDatabase";
import { getActiveParameters } from "../src/db/repositories/parameterRepo";
import { listBarangays } from "../src/db/repositories/barangayRepo";
import { purokCases } from "../src/db/repositories/caseRepo";
import { surveyTotals, getWeatherSeries } from "../src/db/repositories/signalRepo";
import { findBhwByTokenHash, findStaffByUsername } from "../src/db/repositories/userRepo";
import { listEvents, listTasksForBhw } from "../src/db/repositories/workflowRepo";
import { hashToken, verifyPassword } from "../src/db/security";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { SAMPLE_BARANGAYS } from "../src/db/sampleData";
import { count, emptyDb, SEED_DATE, seededDb } from "./helpers";

const TABLES = [
  "barangay", "purok", "staff_user", "bhw", "resident", "daily_answer", "household_report", "symptom_count",
  "weather_record", "case_record", "case_import", "model_parameters", "threat_score", "recommendation",
  "field_task", "entomological_survey", "survey_container", "event_log",
];

function dump(db: ReturnType<typeof emptyDb>): string {
  return TABLES.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).join("\n");
}

describe("seed", () => {
  it("fills the main tables with the expected amounts", () => {
    const db = seededDb();
    expect(count(db, "barangay")).toBe(8);
    expect(count(db, "purok")).toBe(SAMPLE_BARANGAYS.reduce((n, b) => n + b.puroks, 0));
    expect(count(db, "bhw")).toBe(8);
    expect(count(db, "case_record")).toBe(8 * count(db, "purok")); // 8 weeks, every purok
    expect(count(db, "case_import")).toBe(8);
    expect(count(db, "symptom_count")).toBe(8 * 53); // 53 days from 2026-09-14 to 2026-11-05
    expect(count(db, "model_parameters")).toBe(1);
    expect(count(db, "entomological_survey")).toBeGreaterThan(20);
    expect(count(db, "daily_answer")).toBeGreaterThan(1000);
  });

  it("uses the wireframe values for Peñafrancia", () => {
    const b = listBarangays(seededDb()).find((x) => x.name === "Peñafrancia")!;
    expect([b.population, b.areaKm2, b.puroks.length]).toEqual([4120, 1.8, 6]);
  });

  it("makes the officer login work and stores no plain password", () => {
    const db = seededDb();
    const officer = findStaffByUsername(db, OFFICER_USERNAME)!;
    expect(verifyPassword(OFFICER_PASSWORD, officer.passwordHash)).toBe(true);
    expect(verifyPassword("nope", officer.passwordHash)).toBe(false);
    expect(officer.passwordHash).not.toContain(OFFICER_PASSWORD);
  });

  it("gives each BHW a working token link, stored only as a hash", () => {
    const db = emptyDb();
    const summary = seedDatabase(db, { anchorDate: SEED_DATE });
    expect(summary.bhwTokens).toHaveLength(8);
    for (const t of summary.bhwTokens) {
      expect(findBhwByTokenHash(db, hashToken(t.token))!.displayName).toBe(t.name);
      const stored = JSON.stringify(db.prepare("SELECT access_token_hash FROM bhw").all());
      expect(stored).not.toContain(t.token);
    }
  });

  it("stores residents only as hashed phone numbers", () => {
    const rows = seededDb().prepare("SELECT phone_hash FROM resident").all() as { phone_hash: string }[];
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) expect(/^[0-9a-f]{64}$/.test(r.phone_hash)).toBe(true);
  });

  it("loads the default parameters as the active version", () => {
    const p = getActiveParameters(seededDb());
    expect(p.version).toBe(DEFAULT_PARAMETERS.version);
    expect(p.weights).toEqual(DEFAULT_PARAMETERS.weights);
  });

  it("unlocks the Tier 2 rule only for Bascaran Purok 4", () => {
    const db = seededDb();
    const unlocked: string[] = [];
    for (const b of listBarangays(db)) {
      for (const p of purokCases(db, b.id, ["2026-W44", "2026-W45"])) if (p.cases > 2) unlocked.push(`${b.name} ${p.purokName}`);
    }
    expect(unlocked).toEqual(["Bascaran Purok 4"]);
  });

  it("keeps weather up to the sample date, with no future days", () => {
    const db = seededDb();
    const series = getWeatherSeries(db, "Daraga", "2026-09-01", "2026-12-31");
    expect(series[0].date).toBe("2026-09-14");
    expect(series[series.length - 1].date).toBe(SEED_DATE);
    expect(series).toHaveLength(53);
  });

  it("includes the demo workflow rows: decisions, tasks and a completed spot check", () => {
    const db = seededDb();
    const statuses = (db.prepare("SELECT status FROM recommendation ORDER BY id").all() as { status: string }[]).map((r) => r.status);
    expect(statuses).toEqual(["confirmed", "confirmed", "rejected"]);
    const rejected = db.prepare("SELECT reason FROM recommendation WHERE status = 'rejected'").get() as { reason: string };
    expect(rejected.reason.length).toBeGreaterThanOrEqual(10);

    const taskStatuses = (db.prepare("SELECT status FROM field_task ORDER BY id").all() as { status: string }[]).map((r) => r.status);
    expect(taskStatuses.sort()).toEqual(["completed", "in_progress", "new"]);
    expect(listTasksForBhw(db, 1).length).toBeGreaterThanOrEqual(1);
    expect(listEvents(db, 100).map((e) => e.type)).toContain("submission");
  });

  it("has survey rows that add up", () => {
    const db = seededDb();
    const total = surveyTotals(db, 5, "2026-09-01", "2026-12-31");
    expect(total.surveys).toBeGreaterThan(0);
    expect(total.positive <= total.containers).toBe(true);
    const bad = db.prepare("SELECT COUNT(*) AS n FROM survey_container WHERE positive > total OR with_cover + without_cover <> total").get() as { n: number };
    expect(bad.n).toBe(0);
  });

  it("gives the same database every time for the same date", () => {
    expect(dump(seededDb())).toBe(dump(seededDb()));
  });

  it("gives different history for a different date", () => {
    expect(dump(seededDb("2026-11-05"))).not.toBe(dump(seededDb("2026-11-12")));
  });

  it("works when the sample date is a Monday or a Sunday", () => {
    for (const date of ["2026-11-02", "2026-11-08"]) {
      const db = seededDb(date);
      expect(count(db, "barangay")).toBe(8);
      const latest = (db.prepare("SELECT MAX(date) AS d FROM weather_record").get() as { d: string }).d;
      expect(latest).toBe(date);
    }
  });
});
