import { describe, expect, it } from "vitest";
import { Db } from "../src/db/connection";
import { getBarangay, listBarangays } from "../src/db/repositories/barangayRepo";
import { latestScoreFor, latestScores } from "../src/db/repositories/scoreRepo";
import { listEvents } from "../src/db/repositories/workflowRepo";
import { hashPhone } from "../src/db/security";
import { listBhws } from "../src/db/repositories/userRepo";
import { AppError } from "../src/errors";
import { DataChanges } from "../src/services/changes";
import { RankingService } from "../src/services/ranking";
import { count, dataFile, officerId, seededDb } from "./helpers";

const ANCHOR = "2026-11-19";
const NOON = new Date(`${ANCHOR}T09:00:00.000Z`);

function setup() {
  const db = seededDb(ANCHOR);
  const lines: string[] = [];
  const ranking = new RankingService(db, { clock: () => NOON, logger: (l) => lines.push(l) });
  ranking.start();
  // The seed holds a few stub scores; replace them so comparisons start from real ones.
  ranking.rescoreAll({ reason: "baseline", alerts: false });
  lines.length = 0;
  return { db, ranking, changes: new DataChanges(db, ranking), lines };
}

const scoreOf = (db: Db, barangayId: number) => latestScoreFor(db, barangayId)!.score;
const idOf = (db: Db, name: string) => listBarangays(db).find((b) => b.name === name)!.id;
const bhwOf = (db: Db, name: string) => listBhws(db).find((b) => b.displayName === name)!;

function expectError(fn: () => unknown, status: number, message: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
    expect((err as AppError).message).toMatch(message);
    return;
  }
  throw new Error("expected an AppError but nothing was thrown");
}

describe("case import", () => {
  it("re-scores the barangays in the file and the ranking changes", () => {
    const { db, changes, lines } = setup();
    const before = new Map(latestScores(db).map((r) => [r.barangayId, r.score]));
    const result = changes.importCases(dataFile("cases_valid.csv"), officerId(db));
    expect(result.success).toBe(true);
    expect(result.affectedBarangayIds).toHaveLength(listBarangays(db).length);
    expect(lines.some((l) => l.includes("(case import)"))).toBe(true);
    const changed = latestScores(db).filter((r) => r.score !== before.get(r.barangayId));
    expect(changed.length).toBeGreaterThan(0);
  });

  it("only re-scores the barangays that appear in a partial file", () => {
    const { db, changes } = setup();
    const rows = count(db, "threat_score");
    const result = changes.importCases("week,barangay,purok,cases\n2026-W46,Mabini,Purok 1,5\n", officerId(db));
    expect(result.success).toBe(true);
    expect(result.affectedBarangayIds).toEqual([idOf(db, "Mabini")]);
    expect(count(db, "threat_score")).toBe(rows + 1);
  });

  it("a file with errors changes nothing and re-scores nothing", () => {
    const { db, changes } = setup();
    const scores = count(db, "threat_score");
    const cases = count(db, "case_record");
    const imports = count(db, "case_import");
    const result = changes.importCases(dataFile("cases_with_errors.csv"), officerId(db));
    expect(result.success).toBe(false);
    expect(count(db, "threat_score")).toBe(scores);
    expect(count(db, "case_record")).toBe(cases);
    expect(count(db, "case_import")).toBe(imports);
  });
});

describe("weather changes", () => {
  it("a simulated heavy-rain week re-scores every barangay and raises the weather index", () => {
    const { db, changes, lines } = setup();
    const rows = count(db, "threat_score");
    changes.simulateWeather({ preset: "dry" });
    const dryWeather = latestScoreFor(db, 1)!.w;
    changes.simulateWeather({ preset: "heavy_rain" });
    expect(count(db, "threat_score")).toBe(rows + 2 * listBarangays(db).length);
    expect(latestScoreFor(db, 1)!.w).toBeGreaterThan(dryWeather);
    expect(lines.some((l) => l.includes("(weather simulator)"))).toBe(true);
  });

  it("clearing the simulator brings the stored weather back", () => {
    const { db, changes } = setup();
    const before = latestScoreFor(db, 1)!.w;
    changes.simulateWeather({ preset: "dry" });
    expect(latestScoreFor(db, 1)!.w).not.toBeCloseTo(before, 3);
    changes.clearSimulatedWeather();
    expect(latestScoreFor(db, 1)!.w).toBeCloseTo(before, 10);
  });

  it("a rejected weather file changes nothing", () => {
    const { db, changes } = setup();
    const rows = count(db, "threat_score");
    const result = changes.importWeatherFile("date,municipality,mean_temp_c,rainfall_mm\nnot-a-date,Daraga,30,1\n");
    expect(result.success).toBe(false);
    expect(count(db, "threat_score")).toBe(rows);
  });
});

describe("resident contributions", () => {
  function newResident(db: Db, barangayName: string, n = 1) {
    const barangayId = idOf(db, barangayName);
    const info = db
      .prepare("INSERT INTO resident (phone_hash, barangay_id, consent_at, created_at) VALUES (?, ?, ?, ?)")
      .run(hashPhone(`0999000000${n}`, "test-salt"), barangayId, NOON.toISOString(), NOON.toISOString());
    return { residentId: Number(info.lastInsertRowid), barangayId };
  }

  it("a daily answer is saved once per day and re-scores that barangay", () => {
    const { db, changes } = setup();
    const { residentId, barangayId } = newResident(db, "Busay");
    const rows = count(db, "threat_score");
    expect(changes.recordDailyAnswer(residentId, "yes")).toEqual({ saved: true });
    expect(count(db, "threat_score")).toBe(rows + 1);
    // the same resident again today: nothing saved, nothing re-scored
    expect(changes.recordDailyAnswer(residentId, "no")).toEqual({ saved: false });
    expect(count(db, "threat_score")).toBe(rows + 1);
    const stored = db.prepare("SELECT answer FROM daily_answer WHERE resident_id = ? AND date = ?").get(residentId, ANCHOR) as { answer: string };
    expect(stored.answer).toBe("yes");
    expect(latestScoreFor(db, barangayId)).toBeDefined();
  });

  it("rejects an answer that is not yes or no, and an unknown resident", () => {
    const { changes } = setup();
    expectError(() => changes.recordDailyAnswer(1, "maybe"), 400, /answer/);
    expectError(() => changes.recordDailyAnswer(999999, "yes"), 401, /Sign in/);
  });

  it("a household report with breeding sites raises the household index", () => {
    const { db, changes } = setup();
    const { residentId, barangayId } = newResident(db, "Mabini", 2);
    const before = latestScoreFor(db, barangayId)!.c;
    for (let i = 0; i < 3; i++) {
      changes.recordHouseholdReport(residentId, { standingWater: true, cloggedGutter: true, oldContainers: false, bitesIndoors: true });
    }
    expect(latestScoreFor(db, barangayId)!.c).toBeGreaterThan(before);
  });

  it("a symptom check adds to the daily total and stores no resident", () => {
    const { db, changes } = setup();
    const barangayId = idOf(db, "Tagas");
    const before = db.prepare("SELECT checks, checks_with_warning_signs AS w FROM symptom_count WHERE barangay_id = ? AND date = ?").get(barangayId, ANCHOR) as { checks: number; w: number };
    changes.recordSymptomCheck(barangayId, true);
    const after = db.prepare("SELECT checks, checks_with_warning_signs AS w FROM symptom_count WHERE barangay_id = ? AND date = ?").get(barangayId, ANCHOR) as { checks: number; w: number };
    expect(after.checks).toBe(before.checks + 1);
    expect(after.w).toBe(before.w + 1);
    const columns = (db.prepare("PRAGMA table_info(symptom_count)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain("resident_id");
  });
});

describe("BHW survey", () => {
  function survey(db: Db, extra: Record<string, unknown> = {}) {
    const bhw = bhwOf(db, "Rico T. Mendoza"); // Mabini
    const purokId = getBarangay(db, bhw.barangayId)!.puroks[0].id;
    return {
      bhw,
      purokId,
      body: {
        purokId,
        houseNo: "12",
        headOfFamily: "Secret Name",
        age: 41,
        sex: "Female",
        surveyedBy: bhw.displayName,
        surveyDate: ANCHOR,
        noContainersFound: false,
        containers: [{ location: "natural", containerType: "Jar", total: 50, withCover: 0, withoutCover: 50, positive: 45, larvaeCount: 100, pupaeCount: 5 }],
        ...extra,
      },
    };
  }

  it("saves the survey, logs it without household details, and moves the barangay up", () => {
    const { db, changes } = setup();
    const { bhw, body } = survey(db);
    const before = scoreOf(db, bhw.barangayId);
    const { surveyId } = changes.submitSurvey(bhw, body);
    expect(surveyId).toBeGreaterThan(0);
    expect(scoreOf(db, bhw.barangayId)).toBeGreaterThan(before);
    const event = listEvents(db, 1)[0];
    expect(event.type).toBe("submission");
    expect(event.text).toContain("Rico T. Mendoza");
    expect(event.text).not.toContain("Secret Name");
    // natural containers are accepted (indoor / outdoor / natural)
    const saved = db.prepare("SELECT location FROM survey_container WHERE survey_id = ?").get(surveyId) as { location: string };
    expect(saved.location).toBe("natural");
  });

  it("marks the task in progress, or completed when the BHW says so", () => {
    const { db, changes } = setup();
    const jun = bhwOf(db, "Jun M. Santos");
    const taskId = (db.prepare("SELECT id FROM field_task WHERE bhw_id = ? AND status = 'new'").get(jun.id) as { id: number }).id;
    const purokId = getBarangay(db, jun.barangayId)!.puroks[0].id;
    const base = { purokId, houseNo: "3", surveyedBy: jun.displayName, surveyDate: ANCHOR, noContainersFound: true, taskId };
    changes.submitSurvey(jun, base);
    expect((db.prepare("SELECT status FROM field_task WHERE id = ?").get(taskId) as { status: string }).status).toBe("in_progress");
    changes.submitSurvey(jun, { ...base, houseNo: "4", completeTask: true });
    expect((db.prepare("SELECT status FROM field_task WHERE id = ?").get(taskId) as { status: string }).status).toBe("completed");
  });

  it.each([
    ["covers that do not add up", { containers: [{ location: "indoor", containerType: "Jar", total: 5, withCover: 1, withoutCover: 1, positive: 0 }] }, /with cover \+ without cover/],
    ["more positive than the total", { containers: [{ location: "indoor", containerType: "Jar", total: 2, withCover: 1, withoutCover: 1, positive: 3 }] }, /positive/],
    ["an unknown location", { containers: [{ location: "attic", containerType: "Jar", total: 1, withCover: 1, withoutCover: 0, positive: 0 }] }, /location/],
    ["a date in the future", { surveyDate: "2026-11-20" }, /future/],
    ["a date that does not exist", { surveyDate: "2026-02-31" }, /surveyDate/],
    ["no containers and no tick", { containers: [] }, /at least one container/],
    ["containers and the no-containers tick", { noContainersFound: true }, /untick/],
    ["a missing house number", { houseNo: "  " }, /houseNo/],
  ])("rejects %s, and saves nothing", (_label, extra, message) => {
    const { db, changes } = setup();
    const { bhw, body } = survey(db, extra as Record<string, unknown>);
    const surveys = count(db, "entomological_survey");
    const scores = count(db, "threat_score");
    expectError(() => changes.submitSurvey(bhw, body), 400, message);
    expect(count(db, "entomological_survey")).toBe(surveys);
    expect(count(db, "threat_score")).toBe(scores);
  });

  it("rejects a purok from another barangay and a task assigned to someone else", () => {
    const { db, changes } = setup();
    const { bhw, body } = survey(db);
    const otherPurok = getBarangay(db, idOf(db, "Tagas"))!.puroks[0].id;
    expectError(() => changes.submitSurvey(bhw, { ...body, purokId: otherPurok }), 400, /not in your barangay/);
    const juns = (db.prepare("SELECT id FROM field_task WHERE bhw_id = ?").get(bhwOf(db, "Jun M. Santos").id) as { id: number }).id;
    expectError(() => changes.submitSurvey(bhw, { ...body, taskId: juns }), 400, /not assigned to you/);
  });
});

describe("barangay profiles", () => {
  const valid = { name: "Test Barangay", population: 3000, areaKm2: 2.5, puroks: ["Purok 1", "Purok 2"] };

  it("a new barangay is scored and ranked", () => {
    const { db, ranking, changes } = setup();
    const before = ranking.size;
    const id = changes.createBarangay(valid);
    expect(ranking.size).toBe(before + 1);
    expect(latestScoreFor(db, id)).toBeDefined();
    expect(getBarangay(db, id)!.puroks.map((p) => p.name)).toEqual(["Purok 1", "Purok 2"]);
    expect(ranking.isHeapValid()).toBe(true);
  });

  it.each([
    ["no name", { name: "" }, /name/],
    ["population 0", { population: 0 }, /population/],
    ["a fractional population", { population: 10.5 }, /whole number/],
    ["area 0", { areaKm2: 0 }, /area/],
    ["no puroks", { puroks: [] }, /at least one purok/],
    ["repeated purok names", { puroks: ["Purok 1", "purok 1"] }, /different/],
  ])("rejects %s", (_label, change, message) => {
    const { changes } = setup();
    expectError(() => changes.createBarangay({ ...valid, ...change }), 400, message);
  });

  it("rejects a name that already exists", () => {
    const { changes } = setup();
    expectError(() => changes.createBarangay({ ...valid, name: "Mabini" }), 409, /already exists/);
  });

  it("a population change re-scores everyone (density), a name change only that barangay", () => {
    const { db, changes, lines } = setup();
    const id = idOf(db, "Mabini");
    lines.length = 0;
    changes.updateBarangay(id, { name: "Mabini Norte" });
    expect(lines[0]).toMatch(/^\[rescore\] 1 barangays .*\(barangay profile\)$/);
    lines.length = 0;
    changes.updateBarangay(id, { population: 9000 });
    expect(lines[0]).toMatch(new RegExp(`^\\[rescore\\] ${listBarangays(db).length} barangays .*\\(barangay profile \\(density\\)\\)$`));
  });

  it("the purok list is replaced: new names added, removed names deleted", () => {
    const { db, changes } = setup();
    const id = idOf(db, "Mabini");
    const before = getBarangay(db, id)!.puroks.map((p) => p.name);
    expect(before.length).toBeGreaterThan(2);
    changes.updateBarangay(id, { puroks: ["Purok 1", "Purok 2", "Purok 99"] });
    expect(getBarangay(db, id)!.puroks.map((p) => p.name)).toEqual(["Purok 1", "Purok 2", "Purok 99"]);
  });

  it("deleting a barangay removes it from the heap, the database and the ranking", () => {
    const { db, ranking, changes } = setup();
    const id = idOf(db, "Mabini");
    const before = ranking.size;
    changes.deleteBarangay(id);
    expect(ranking.size).toBe(before - 1);
    expect(ranking.order().some((e) => e.id === id)).toBe(false);
    expect(getBarangay(db, id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM threat_score WHERE barangay_id = ?").get(id)).toEqual({ n: 0 });
    expect(ranking.isHeapValid()).toBe(true);
    expectError(() => changes.deleteBarangay(id), 404, /not found/);
  });

  it("a restart after a delete still has the same ranking", () => {
    const { db, ranking, changes } = setup();
    changes.deleteBarangay(idOf(db, "Mabini"));
    const before = ranking.order().map((e) => [e.id, e.score]);
    const again = new RankingService(db, { clock: () => NOON, logger: () => {} });
    again.start();
    expect(again.order().map((e) => [e.id, e.score])).toEqual(before);
  });
});
