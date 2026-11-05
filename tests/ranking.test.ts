import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { scoreBarangay } from "../src/algorithms/scoring";
import { Db } from "../src/db/connection";
import { densityRatios, getBarangay, listBarangays } from "../src/db/repositories/barangayRepo";
import { getActiveParameters } from "../src/db/repositories/parameterRepo";
import { latestScoreFor, latestScores, scoreAtOrBefore, scoreHistory } from "../src/db/repositories/scoreRepo";
import { insertSurvey } from "../src/db/repositories/workflowRepo";
import { RankingService } from "../src/services/ranking";
import { caseWeeksAsOf, loadInputs } from "../src/services/scoringInputs";
import { count, seededDb } from "./helpers";

// Demo day: the sample case file (week 2026-W46) is already in the past here.
const ANCHOR = "2026-11-19";
const NOON = new Date(`${ANCHOR}T09:00:00.000Z`);

function service(db: Db, now: () => Date = () => NOON) {
  const lines: string[] = [];
  const ranking = new RankingService(db, { clock: now, logger: (l) => lines.push(l) });
  return { ranking, lines };
}

function startedService(now?: () => Date) {
  const db = seededDb(ANCHOR);
  const s = service(db, now);
  s.ranking.start();
  return { db, ...s };
}

const orderOf = (r: RankingService) => r.order().map((e) => [e.id, e.score]);
type RankingService = import("../src/services/ranking").RankingService;

describe("starting the service", () => {
  it("scores every barangay and fills the heap (the seed stores only 3 stub scores)", () => {
    const { db, ranking } = startedService();
    expect(ranking.size).toBe(listBarangays(db).length);
    expect(ranking.isHeapValid()).toBe(true);
    // every barangay now has a stored score
    expect(latestScores(db).length).toBe(listBarangays(db).length);
  });

  it("lists barangays from highest to lowest score, ties by smaller id", () => {
    const { ranking } = startedService();
    const order = ranking.order();
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1], order[i]];
      expect(a.score > b.score || (a.score === b.score && (a.id as number) < (b.id as number))).toBe(true);
    }
  });
});

describe("starting on a later day than the data was seeded", () => {
  const SEEDED_ON = "2026-11-17";

  function seededEarlier() {
    const db = seededDb(SEEDED_ON);
    // what `npm run seed` does: score every day up to the seed date
    new RankingService(db, { clock: () => new Date(`${SEEDED_ON}T12:00:00.000Z`), logger: () => {} }).backfillHistory("2026-09-22", SEEDED_ON);
    return db;
  }
  const asOfOf = (db: Db) =>
    latestScores(db).map((r) => (r.rawSummary as { asOf: string }).asOf);

  it("brings every barangay up to today once, with no alerts", () => {
    const db = seededEarlier();
    expect(new Set(asOfOf(db))).toEqual(new Set([SEEDED_ON]));
    const { ranking, lines } = service(db); // the clock says 2026-11-19
    ranking.start();
    expect(new Set(asOfOf(db))).toEqual(new Set([ANCHOR]));
    expect(lines.some((l) => l.includes("[rescore] 8 barangays") && l.includes("scores from 2026-11-17 brought up to 2026-11-19"))).toBe(true);
    expect(count(db, "alert")).toBe(0);
    expect(ranking.isHeapValid()).toBe(true);
    expect(ranking.size).toBe(listBarangays(db).length);
  });

  it("a second start the same day re-scores nothing and gives the same ranking", () => {
    const db = seededEarlier();
    const first = service(db);
    first.ranking.start();
    const before = orderOf(first.ranking);
    const second = service(db);
    second.ranking.start();
    expect(second.lines.some((l) => l.includes("[rescore]"))).toBe(false);
    expect(orderOf(second.ranking)).toEqual(before);
  });

  it("replaces the seed's few stub scores too", () => {
    const { db } = startedService(); // plain seed: only 3 stub scores, dated days ago
    expect(new Set(asOfOf(db))).toEqual(new Set([ANCHOR]));
  });

  it("a change after the catch-up leaves every barangay on the same date", () => {
    const db = seededEarlier();
    const { ranking } = service(db);
    ranking.start();
    ranking.rescore([1], { reason: "survey", alerts: false });
    expect(new Set(asOfOf(db))).toEqual(new Set([ANCHOR]));
  });
});

describe("a restart gives the same ranking", () => {
  it("a new service built from the same database has the same order and scores", () => {
    const { db, ranking } = startedService();
    const before = orderOf(ranking);
    const second = service(db);
    second.ranking.start();
    expect(orderOf(second.ranking)).toEqual(before);
    expect(second.lines.some((l) => l.includes("[rescore]"))).toBe(false); // nothing needed re-scoring
  });

  it("keeps a live score even if an earlier-in-the-day score row was stored at midnight", () => {
    // A history backfill stamps rows at T00:00Z. A live rescore later that day
    // (even 01:00Z, 9 am in the Philippines) must still count as the latest.
    const db = seededDb(ANCHOR);
    const first = service(db, () => new Date(`${ANCHOR}T00:00:00.000Z`));
    first.ranking.start();
    first.ranking.rescoreAll({
      reason: "backfill",
      asOf: new Date(`${ANCHOR}T00:00:00.000Z`),
      computedAt: `${ANCHOR}T00:00:00.000Z`,
      alerts: false,
    });

    // New data arrives at 01:00Z: a heavily positive survey in the lowest-ranked barangay.
    const lowest = first.ranking.order().at(-1)!.id as number;
    const b = getBarangay(db, lowest)!;
    insertSurvey(
      db,
      { barangayId: lowest, purokId: b.puroks[0].id, surveyDate: ANCHOR, noContainersFound: false, submittedAt: `${ANCHOR}T01:00:00.000Z` },
      [{ location: "indoor", containerType: "Drum", total: 40, withCover: 0, withoutCover: 40, positive: 40 }],
    );
    const live = service(db, () => new Date(`${ANCHOR}T01:00:00.000Z`));
    live.ranking.start();
    const result = live.ranking.rescore([lowest], { reason: "survey", alerts: false });
    const liveScore = result.results[0].score;

    // The stored "latest" is the live row, not the midnight one...
    expect(latestScoreFor(db, lowest)!.score).toBe(liveScore);
    // ...so a restart sees it too.
    const again = service(db);
    again.ranking.start();
    expect(again.ranking.order().find((e) => e.id === lowest)!.score).toBe(liveScore);
  });
});

describe("rescore", () => {
  it("stores the same score the scoring function computes, with the full breakdown", () => {
    const { db, ranking } = startedService();
    const b = listBarangays(db)[0];
    const params = getActiveParameters(db);
    const weeks = caseWeeksAsOf(db, ANCHOR);
    const expected = scoreBarangay(loadInputs(db, b, densityRatios(db).get(b.id)!, ANCHOR, weeks, params), params);

    ranking.rescore([b.id], { reason: "test", alerts: false });
    const row = latestScoreFor(db, b.id)!;
    expect(row.score).toBeCloseTo(expected.score, 12);
    expect(row.paramsVersion).toBe(params.version);
    // columns hold the five indices
    expect(row.w).toBeCloseTo(expected.factors.weather.index, 12);
    expect(row.f).toBeCloseTo(expected.factors.field.index, 12);
    // weights_used holds the per-factor index, weight and points
    const factors = row.weightsUsed as typeof expected.factors;
    expect(Object.keys(factors).sort()).toEqual(["cases", "field", "household", "symptom", "weather"]);
    expect(factors.cases.weight).toBe(0.3);
    expect(factors.field.points).toBeCloseTo(expected.factors.field.points, 12);
    // raw_summary carries the data behind each index
    const raw = row.rawSummary as { asOf: string; score100: number; details: { cases: { thisWeek: number } } };
    expect(raw.asOf).toBe(ANCHOR);
    expect(raw.score100).toBe(expected.score100);
    expect(raw.details.cases.thisWeek).toBe(expected.details.cases.thisWeek);
  });

  it("only re-scores the barangays asked for", () => {
    const { db, ranking } = startedService();
    const rowsBefore = count(db, "threat_score");
    const target = listBarangays(db)[2].id;
    const untouched = latestScoreFor(db, listBarangays(db)[0].id)!.id;
    const summary = ranking.rescore([target], { reason: "test", alerts: false });
    expect(summary.count).toBe(1);
    expect(count(db, "threat_score")).toBe(rowsBefore + 1);
    expect(latestScoreFor(db, listBarangays(db)[0].id)!.id).toBe(untouched);
  });

  it("logs how long each rescore took", () => {
    const { ranking, lines } = startedService();
    lines.length = 0;
    ranking.rescore([1, 2], { reason: "case import", alerts: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[rescore\] 2 barangays in \d+\.\d ms \(case import\)$/);
  });

  it("moves a barangay up the ranking when a survey finds many positive containers", () => {
    const { db, ranking } = startedService();
    const order = ranking.order();
    const mid = order[Math.floor(order.length / 2)];
    const rankBefore = order.findIndex((e) => e.id === mid.id);
    const b = getBarangay(db, mid.id as number)!;
    insertSurvey(
      db,
      { barangayId: b.id, purokId: b.puroks[0].id, surveyDate: ANCHOR, noContainersFound: false, submittedAt: NOON.toISOString() },
      [{ location: "outdoor", containerType: "Drum", total: 50, withCover: 0, withoutCover: 50, positive: 45 }],
    );
    ranking.rescore([b.id], { reason: "survey" });
    expect(ranking.order().find((e) => e.id === mid.id)!.score).toBeGreaterThan(mid.score);
    expect(ranking.order().findIndex((e) => e.id === mid.id)).toBeLessThanOrEqual(rankBefore);
    expect(ranking.isHeapValid()).toBe(true);
  });

  it("copes with a barangay that has no weather data at all", () => {
    const { db, ranking } = startedService();
    db.prepare("DELETE FROM weather_record").run();
    const summary = ranking.rescoreAll({ reason: "no weather", alerts: false });
    expect(summary.count).toBe(listBarangays(db).length);
    const raw = latestScoreFor(db, 1)!.rawSummary as { details: { weather: { meanTempC: number | null } } };
    expect(raw.details.weather.meanTempC).toBeNull();
  });

  it("removing a barangay takes it out of the heap", () => {
    const { db, ranking } = startedService();
    const id = ranking.order()[0].id as number;
    ranking.removeBarangay(id);
    expect(ranking.order().some((e) => e.id === id)).toBe(false);
    expect(ranking.size).toBe(listBarangays(db).length - 1);
    expect(ranking.isHeapValid()).toBe(true);
  });
});

describe("history backfill", () => {
  const FROM = "2026-11-01";

  function backfilled() {
    const db = seededDb(ANCHOR);
    const { ranking, lines } = service(db);
    ranking.backfillHistory(FROM, ANCHOR);
    return { db, ranking, lines };
  }

  it("stores one score per barangay per day, stamped at the start of the day", () => {
    const { db } = backfilled();
    const days = 19; // Nov 1 to Nov 19
    const barangays = listBarangays(db).length;
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM threat_score WHERE computed_at >= ?")
      .get(`${FROM}T00:00:00.000Z`) as { n: number };
    expect(rows.n).toBeGreaterThanOrEqual(days * barangays);
    const sample = scoreHistory(db, 1, 100).filter((r) => r.computedAt.startsWith("2026-11-1"));
    expect(sample.every((r) => r.computedAt.endsWith("T00:00:00.000Z") || r.computedAt.endsWith("10:00:00.000Z"))).toBe(true);
  });

  it("issues no alerts for past days", () => {
    const { db } = backfilled();
    expect(count(db, "alert")).toBe(0);
  });

  it("leaves the newest day's score as the latest, so a restart needs no re-scoring", () => {
    const { db } = backfilled();
    const second = service(db);
    second.ranking.start();
    expect(second.ranking.size).toBe(listBarangays(db).length);
    expect(second.lines.some((l) => l.includes("[rescore]"))).toBe(false);
    expect(latestScoreFor(db, 1)!.computedAt).toBe(`${ANCHOR}T00:00:00.000Z`);
  });

  it("gives every barangay a score from 7 days earlier for the trend arrow", () => {
    const { db } = backfilled();
    for (const b of listBarangays(db)) {
      const earlier = scoreAtOrBefore(db, b.id, `2026-11-12T00:00:00.000Z`);
      expect(earlier).toBeDefined();
      expect(earlier!.computedAt <= "2026-11-12T00:00:00.000Z").toBe(true);
    }
  });

  it("a live rescore later the same day replaces the backfilled score as the latest", () => {
    const { db, ranking } = backfilled();
    ranking.rescore([1], { reason: "live", alerts: false });
    expect(latestScoreFor(db, 1)!.computedAt).toBe(NOON.toISOString());
    const again = service(db);
    again.ranking.start();
    expect(again.ranking.order().find((e) => e.id === 1)!.score).toBe(latestScoreFor(db, 1)!.score);
  });

  it("logs one summary line, not one per day", () => {
    const { lines } = backfilled();
    expect(lines.filter((l) => l.includes("[rescore]"))).toHaveLength(0);
    expect(lines.filter((l) => l.includes("history backfilled"))).toHaveLength(1);
  });
});

describe("alerts", () => {
  /**
   * A fresh database scored once as a baseline, with a clock the test can move.
   * The weather presets cannot push a seeded barangay over 40 (they move every
   * score by about 15 points and the quiet barangays start far below), so the
   * tests cross the line with a survey that finds many positive containers.
   */
  function alertSetup() {
    const db = seededDb(ANCHOR);
    let t = NOON.getTime();
    const s = service(db, () => new Date(t));
    s.ranking.start();
    s.ranking.rescoreAll({ reason: "baseline", alerts: false });
    const candidate = latestScores(db)
      .filter((r) => r.score < 0.4)
      .sort((a, b) => b.score - a.score)[0];
    const step = (minutes: number) => {
      t += minutes * 60_000;
    };
    const alertsFor = (barangayId: number) =>
      db.prepare("SELECT level, message FROM alert WHERE barangay_id = ? ORDER BY id").all(barangayId) as {
        level: string;
        message: string;
      }[];
    const addPositiveSurvey = () => {
      const b = getBarangay(db, candidate.barangayId)!;
      return insertSurvey(
        db,
        { barangayId: b.id, purokId: b.puroks[0].id, surveyDate: ANCHOR, noContainersFound: false, submittedAt: new Date(t).toISOString() },
        [{ location: "outdoor", containerType: "Drum", total: 60, withCover: 0, withoutCover: 60, positive: 60 }],
      );
    };
    const removeSurvey = (id: number) => db.prepare("DELETE FROM entomological_survey WHERE id = ?").run(id);
    return { db, ranking: s.ranking, candidate, step, alertsFor, addPositiveSurvey, removeSurvey };
  }

  it("the scenario starts below 40 and a positive survey really crosses it", () => {
    const { ranking, candidate, addPositiveSurvey, step } = alertSetup();
    expect(candidate).toBeDefined();
    expect(candidate.score).toBeLessThan(0.4);
    addPositiveSurvey();
    step(1);
    const after = ranking.rescore([candidate.barangayId], { reason: "survey", alerts: false }).results[0];
    expect(after.score).toBeGreaterThanOrEqual(0.4);
  });

  it("issues an alert when a barangay's score crosses 40 upward", () => {
    const { ranking, candidate, addPositiveSurvey, alertsFor, step } = alertSetup();
    addPositiveSurvey();
    step(1);
    ranking.rescore([candidate.barangayId], { reason: "survey" });
    const alerts = alertsFor(candidate.barangayId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toMatch(/elevated|high/);
    expect(alerts[0].message).toMatch(/Dengue risk in your barangay is now (ELEVATED|HIGH)/);
    expect(alerts[0].message).not.toMatch(/d+ (confirmed )?cases?/i); // no case counts in alerts
  });

  it("does not alert again while the score stays above 40", () => {
    const { ranking, candidate, addPositiveSurvey, alertsFor, step } = alertSetup();
    addPositiveSurvey();
    step(1);
    ranking.rescore([candidate.barangayId], { reason: "survey" });
    step(1);
    ranking.rescore([candidate.barangayId], { reason: "again" });
    expect(alertsFor(candidate.barangayId)).toHaveLength(1);
  });

  it("does not alert when no score crosses the line", () => {
    const { ranking, db, step, alertsFor } = alertSetup();
    step(1);
    ranking.rescoreAll({ reason: "nothing changed" });
    expect(count(db, "alert")).toBe(0);
    expect(alertsFor(1)).toHaveLength(0);
  });

  it("issues at most 3 alerts per barangay in 7 days", () => {
    const { ranking, candidate, addPositiveSurvey, removeSurvey, alertsFor, step } = alertSetup();
    for (let i = 0; i < 6; i++) {
      const id = addPositiveSurvey();
      step(1);
      ranking.rescore([candidate.barangayId], { reason: "up" }); // crosses 40 upward
      removeSurvey(id);
      step(1);
      ranking.rescore([candidate.barangayId], { reason: "down" }); // falls back below
    }
    expect(alertsFor(candidate.barangayId)).toHaveLength(DEFAULT_PARAMETERS.constants.alertCap);
  });

  it("alerts again once the 7-day window has passed", () => {
    const { ranking, candidate, addPositiveSurvey, removeSurvey, alertsFor, step } = alertSetup();
    for (let i = 0; i < 4; i++) {
      const id = addPositiveSurvey();
      step(1);
      ranking.rescore([candidate.barangayId], { reason: "up" });
      removeSurvey(id);
      step(1);
      ranking.rescore([candidate.barangayId], { reason: "down" });
    }
    expect(alertsFor(candidate.barangayId)).toHaveLength(3);
    step(8 * 24 * 60); // eight days later the old alerts no longer count
    addPositiveSurvey();
    step(1);
    ranking.rescore([candidate.barangayId], { reason: "up again" });
    expect(alertsFor(candidate.barangayId)).toHaveLength(4);
  });
});
