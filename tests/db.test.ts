import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { runMigrations } from "../src/db/migrate";
import {
  addPurok, createBarangay, deleteBarangay, densityRatios, getBarangay, listBarangays, updateBarangay,
} from "../src/db/repositories/barangayRepo";
import { barangayCases, purokCases, replaceWeekCases } from "../src/db/repositories/caseRepo";
import {
  getActiveParameters, getParameters, insertParameters, listParameterVersions, nextParameterVersion,
} from "../src/db/repositories/parameterRepo";
import { insertScore, latestScoreFor, latestScores, scoreHistory } from "../src/db/repositories/scoreRepo";
import {
  deleteSimulatedWeather, getWeatherSeries, latestWeatherDate, upsertWeather,
} from "../src/db/repositories/signalRepo";
import { createBhw, createStaff, findBhwByTokenHash, findStaffByUsername } from "../src/db/repositories/userRepo";
import {
  addEvent, countAlertsSince, createRecommendation, createTask, decideRecommendation, insertAlert, insertSurvey,
  listEvents, listTasksForBhw, updateTaskStatus,
} from "../src/db/repositories/workflowRepo";
import { hashPassword, hashToken, verifyPassword } from "../src/db/security";
import { count, emptyDb } from "./helpers";

function twoBarangays() {
  const db = emptyDb();
  const a = createBarangay(db, { name: "Alpha", municipality: "Daraga", population: 3000, areaKm2: 2, puroks: ["Purok 1", "Purok 2"] });
  const b = createBarangay(db, { name: "Beta", municipality: "Daraga", population: 1000, areaKm2: 4, puroks: ["Purok 1"] });
  return { db, a, b };
}

describe("schema", () => {
  it("runs migrations once and only once", () => {
    const db = emptyDb();
    expect(runMigrations(db)).toEqual([]);
    expect(count(db, "schema_migrations")).toBe(1);
  });

  it("enforces foreign keys and check constraints", () => {
    const { db, a } = twoBarangays();
    expect(() => db.prepare("INSERT INTO purok (barangay_id, name) VALUES (999, 'x')").run()).toThrow();
    expect(() => createBarangay(db, { name: "Bad", municipality: "Daraga", population: 0, areaKm2: 1, puroks: [] })).toThrow();
    const purok = (db.prepare("SELECT id FROM purok WHERE barangay_id = ? LIMIT 1").get(a) as { id: number }).id;
    expect(() =>
      db
        .prepare("INSERT INTO case_record (barangay_id, purok_id, iso_week, week_start, confirmed_cases) VALUES (?, ?, '2026-W46', '2026-11-09', -1)")
        .run(a, purok),
    ).toThrow();
  });

  it("rejects duplicate barangay names", () => {
    const { db } = twoBarangays();
    expect(() => createBarangay(db, { name: "Alpha", municipality: "Daraga", population: 10, areaKm2: 1, puroks: [] })).toThrow();
  });
});

describe("barangays", () => {
  it("creates, reads, updates and extends a barangay", () => {
    const { db, a } = twoBarangays();
    const row = getBarangay(db, a)!;
    expect(row.name).toBe("Alpha");
    expect(row.puroks.map((p) => p.name)).toEqual(["Purok 1", "Purok 2"]);
    expect(row.densityPerKm2).toBe(1500);

    expect(updateBarangay(db, a, { population: 4000 })).toBe(true);
    expect(getBarangay(db, a)!.population).toBe(4000);
    expect(getBarangay(db, a)!.name).toBe("Alpha");
    expect(updateBarangay(db, 999, { population: 1 })).toBe(false);

    addPurok(db, a, "Purok 3");
    expect(getBarangay(db, a)!.puroks).toHaveLength(3);
    expect(getBarangay(db, 999)).toBeUndefined();
  });

  it("computes density ratios against the densest barangay", () => {
    const { db, a, b } = twoBarangays();
    const r = densityRatios(db);
    expect(r.get(a)).toBe(1); // 1500 per km2
    expect(r.get(b)).toBe(250 / 1500);
  });

  it("deleting a barangay removes everything that belongs to it", () => {
    const { db, a, b } = twoBarangays();
    const purok = getBarangay(db, a)!.puroks[0].id;
    replaceWeekCases(db, "2026-W46", "2026-11-09", [{ barangayId: a, purokId: purok, cases: 2 }]);
    upsertWeather(db, { date: "2026-11-05", municipality: "Daraga", meanTempC: 29, rainfallMm: 1, source: "file" });
    expect(deleteBarangay(db, a)).toBe(true);
    expect(count(db, "purok")).toBe(1);
    expect(count(db, "case_record")).toBe(0);
    expect(listBarangays(db).map((x) => x.id)).toEqual([b]);
    expect(count(db, "weather_record")).toBe(1); // weather belongs to the municipality
    expect(deleteBarangay(db, a)).toBe(false);
  });
});

describe("cases", () => {
  it("replaces a week for the barangays in the file and leaves others alone", () => {
    const { db, a, b } = twoBarangays();
    const pa = getBarangay(db, a)!.puroks;
    const pb = getBarangay(db, b)!.puroks;
    replaceWeekCases(db, "2026-W46", "2026-11-09", [
      { barangayId: a, purokId: pa[0].id, cases: 2 },
      { barangayId: a, purokId: pa[1].id, cases: 1 },
      { barangayId: b, purokId: pb[0].id, cases: 5 },
    ]);
    expect(barangayCases(db, a, "2026-W46")).toBe(3);

    // A corrected file for barangay a only: b keeps its old value.
    replaceWeekCases(db, "2026-W46", "2026-11-09", [{ barangayId: a, purokId: pa[0].id, cases: 7 }]);
    // Purok 1 is replaced (7); Purok 2 is not in the file, so it is left alone (1).
    expect(barangayCases(db, a, "2026-W46")).toBe(8);
    expect(barangayCases(db, b, "2026-W46")).toBe(5);
    expect(count(db, "case_record")).toBe(3);
  });

  it("totals cases per purok over several weeks, counting empty puroks as 0", () => {
    const { db, a } = twoBarangays();
    const p = getBarangay(db, a)!.puroks;
    replaceWeekCases(db, "2026-W45", "2026-11-02", [{ barangayId: a, purokId: p[0].id, cases: 1 }]);
    replaceWeekCases(db, "2026-W46", "2026-11-09", [{ barangayId: a, purokId: p[0].id, cases: 2 }]);
    const rows = purokCases(db, a, ["2026-W45", "2026-W46"]);
    expect(rows.map((r) => r.cases)).toEqual([3, 0]);
    expect(purokCases(db, a, [])).toEqual([]);
  });

  it("rolls back the whole replacement if one row is invalid", () => {
    const { db, a } = twoBarangays();
    const p = getBarangay(db, a)!.puroks;
    replaceWeekCases(db, "2026-W46", "2026-11-09", [{ barangayId: a, purokId: p[0].id, cases: 2 }]);
    expect(() =>
      replaceWeekCases(db, "2026-W46", "2026-11-09", [
        { barangayId: a, purokId: p[0].id, cases: 9 },
        { barangayId: a, purokId: p[1].id, cases: -1 },
      ]),
    ).toThrow();
    expect(barangayCases(db, a, "2026-W46")).toBe(2);
  });
});

describe("weather", () => {
  it("prefers simulated over api over file, one row per date", () => {
    const db = emptyDb();
    const w = (date: string, t: number, source: "file" | "api" | "simulated") =>
      upsertWeather(db, { date, municipality: "Daraga", meanTempC: t, rainfallMm: 0, source });
    w("2026-11-04", 28, "file");
    w("2026-11-05", 29, "file");
    w("2026-11-05", 30, "api");
    w("2026-11-05", 31, "simulated");
    const series = getWeatherSeries(db, "Daraga", "2026-11-01", "2026-11-30");
    expect(series.map((d) => [d.date, d.meanTempC, d.source])).toEqual([
      ["2026-11-04", 28, "file"],
      ["2026-11-05", 31, "simulated"],
    ]);
    expect(latestWeatherDate(db, "Daraga")).toBe("2026-11-05");
    expect(latestWeatherDate(db, "Nowhere")).toBeNull();

    expect(deleteSimulatedWeather(db, "Daraga")).toBe(1);
    expect(getWeatherSeries(db, "Daraga", "2026-11-05", "2026-11-05")[0].meanTempC).toBe(30);
  });

  it("updates a record with the same date and source instead of duplicating it", () => {
    const db = emptyDb();
    const rec = { date: "2026-11-05", municipality: "Daraga", meanTempC: 28, rainfallMm: 1, source: "file" as const };
    upsertWeather(db, rec);
    upsertWeather(db, { ...rec, meanTempC: 30 });
    expect(count(db, "weather_record")).toBe(1);
    expect(getWeatherSeries(db, "Daraga", "2026-11-05", "2026-11-05")[0].meanTempC).toBe(30);
  });
});

describe("parameters", () => {
  it("saves and reads the active parameter set", () => {
    const db = emptyDb();
    insertParameters(db, DEFAULT_PARAMETERS, { activate: true, note: "start" });
    const active = getActiveParameters(db);
    expect(active.version).toBe(DEFAULT_PARAMETERS.version);
    expect(active.weights).toEqual(DEFAULT_PARAMETERS.weights);
    expect(active.constants).toEqual(DEFAULT_PARAMETERS.constants);
    expect(getParameters(db, 99)).toBeUndefined();
  });

  it("keeps only one version active and numbers versions upward", () => {
    const db = emptyDb();
    insertParameters(db, DEFAULT_PARAMETERS, { activate: true });
    const v2 = { ...DEFAULT_PARAMETERS, version: nextParameterVersion(db) };
    insertParameters(db, v2, { activate: true, note: "slider change" });
    expect(getActiveParameters(db).version).toBe(2);
    expect(listParameterVersions(db).map((v) => [v.version, v.isActive])).toEqual([[1, 0], [2, 1]]);
    expect(() => db.prepare("UPDATE model_parameters SET is_active = 1 WHERE version = 1").run()).toThrow();
  });

  it("complains when nothing is active", () => {
    expect(() => getActiveParameters(emptyDb())).toThrow();
  });
});

describe("scores", () => {
  function score(barangayId: number, computedAt: string, value: number) {
    return {
      barangayId, computedAt, score: value, w: 0.5, c: 0.5, s: 0.5, f: 0.5, h: 0.5,
      weightsUsed: { weather: 0.25 }, densityFactor: 0.9, rawSummary: { note: "x" }, paramsVersion: 1,
    };
  }

  it("returns the newest score per barangay and keeps history", () => {
    const { db, a, b } = twoBarangays();
    insertParameters(db, DEFAULT_PARAMETERS, { activate: true });
    insertScore(db, score(a, "2026-11-04T09:00:00.000Z", 0.3));
    insertScore(db, score(a, "2026-11-05T09:00:00.000Z", 0.6));
    insertScore(db, score(b, "2026-11-05T09:00:00.000Z", 0.2));

    expect(latestScoreFor(db, a)!.score).toBe(0.6);
    expect(latestScoreFor(db, a)!.weightsUsed).toEqual({ weather: 0.25 });
    expect(latestScoreFor(db, a)!.f).toBe(0.5);
    expect(latestScores(db).map((s) => [s.barangayId, s.score])).toEqual([[a, 0.6], [b, 0.2]]);
    expect(scoreHistory(db, a).map((s) => s.score)).toEqual([0.6, 0.3]);
    expect(latestScoreFor(db, 999)).toBeUndefined();
  });

  it("refuses scores outside 0 to 1", () => {
    const { db, a } = twoBarangays();
    insertParameters(db, DEFAULT_PARAMETERS, { activate: true });
    expect(() => insertScore(db, score(a, "2026-11-05T09:00:00.000Z", 1.5))).toThrow();
  });
});

describe("users and security", () => {
  it("hashes and verifies passwords", () => {
    const stored = hashPassword("demo1234");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("demo1234", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("demo1234", "garbage")).toBe(false);
    expect(hashPassword("demo1234")).not.toBe(stored); // random salt
    expect(hashPassword("demo1234", "00".repeat(16))).toBe(hashPassword("demo1234", "00".repeat(16)));
  });

  it("finds staff by username and BHWs by token hash", () => {
    const { db, a } = twoBarangays();
    createStaff(db, { username: "officer", displayName: "O", passwordHash: hashPassword("pw") });
    expect(findStaffByUsername(db, "officer")!.displayName).toBe("O");
    expect(findStaffByUsername(db, "nobody")).toBeUndefined();
    createBhw(db, { displayName: "H", barangayId: a, teamLabel: "Team A", tokenHash: hashToken("secret") });
    expect(findBhwByTokenHash(db, hashToken("secret"))!.barangayId).toBe(a);
    expect(findBhwByTokenHash(db, hashToken("other"))).toBeUndefined();
  });
});

describe("workflow", () => {
  function setup() {
    const { db, a } = twoBarangays();
    insertParameters(db, DEFAULT_PARAMETERS, { activate: true });
    const officer = createStaff(db, { username: "officer", displayName: "O", passwordHash: "x" });
    const bhw = createBhw(db, { displayName: "H", barangayId: a, tokenHash: hashToken("t") });
    const scoreId = insertScore(db, {
      barangayId: a, computedAt: "2026-11-05T09:00:00.000Z", score: 0.5, w: 0.5, c: 0.5, s: 0.5, f: 0.5, h: 0.5,
      weightsUsed: {}, densityFactor: 1, rawSummary: {}, paramsVersion: 1,
    });
    return { db, a, officer, bhw, scoreId };
  }

  it("confirms a recommendation once and creates a task", () => {
    const { db, a, officer, bhw, scoreId } = setup();
    const rec = createRecommendation(db, { barangayId: a, scoreId, tier: 1 });
    expect(decideRecommendation(db, { id: rec, status: "confirmed", officerId: officer })).toBe(true);
    expect(decideRecommendation(db, { id: rec, status: "rejected", officerId: officer, reason: "changed my mind" })).toBe(false);

    const task = createTask(db, { recommendationId: rec, barangayId: a, bhwId: bhw, type: "search_and_destroy", puroks: ["Purok 1"] });
    expect(listTasksForBhw(db, bhw)[0]).toMatchObject({ id: task, status: "new", puroks: ["Purok 1"] });
    expect(updateTaskStatus(db, task, "completed")).toBe(true);
    expect(listTasksForBhw(db, bhw)[0].status).toBe("completed");
    expect(updateTaskStatus(db, 999, "completed")).toBe(false);
  });

  it("saves a survey with its containers, or nothing at all", () => {
    const { db, a, bhw } = setup();
    const good = { location: "indoor" as const, containerType: "Jar", total: 3, withCover: 1, withoutCover: 2, positive: 1 };
    insertSurvey(db, { barangayId: a, bhwId: bhw, surveyDate: "2026-11-05", noContainersFound: false, submittedAt: "2026-11-05T10:00:00.000Z" }, [good]);
    expect(count(db, "entomological_survey")).toBe(1);
    expect(count(db, "survey_container")).toBe(1);

    const bad = { ...good, withCover: 5 }; // 5 + 2 does not add up to 3
    expect(() =>
      insertSurvey(db, { barangayId: a, surveyDate: "2026-11-05", noContainersFound: false, submittedAt: "2026-11-05T10:00:00.000Z" }, [good, bad]),
    ).toThrow();
    expect(count(db, "entomological_survey")).toBe(1);
    expect(count(db, "survey_container")).toBe(1);
  });

  it("counts recent alerts and lists events newest first", () => {
    const { db, a } = setup();
    insertAlert(db, { barangayId: a, level: "elevated", message: "m", issuedAt: "2026-11-01T08:00:00.000Z" });
    insertAlert(db, { barangayId: a, level: "high", message: "m", issuedAt: "2026-11-04T08:00:00.000Z" });
    expect(countAlertsSince(db, a, "2026-11-03T00:00:00.000Z")).toBe(1);
    expect(countAlertsSince(db, a, "2026-10-01T00:00:00.000Z")).toBe(2);

    addEvent(db, "import", "first", "2026-11-01T08:00:00.000Z");
    addEvent(db, "weather", "second", "2026-11-02T08:00:00.000Z");
    expect(listEvents(db).map((e) => e.text)).toEqual(["second", "first"]);
    expect(() => addEvent(db, "bogus" as never, "x")).toThrow();
  });
});
