// Weather and the resident / field signals that feed the scoring formula.
// The "totals" functions take an inclusive date range (YYYY-MM-DD).

import type { Db } from "../connection";

export type WeatherSource = "file" | "api" | "simulated";

export interface WeatherDay {
  date: string;
  municipality: string;
  meanTempC: number;
  rainfallMm: number;
  source: WeatherSource;
}

export function upsertWeather(db: Db, w: WeatherDay, at: string = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO weather_record (date, municipality, mean_temp_c, rainfall_mm, source, created_at)
     VALUES (@date, @municipality, @meanTempC, @rainfallMm, @source, @at)
     ON CONFLICT (date, municipality, source)
     DO UPDATE SET mean_temp_c = excluded.mean_temp_c, rainfall_mm = excluded.rainfall_mm`,
  ).run({ ...w, at });
}

/** One row per date: simulated beats api, and api beats file. Oldest first. */
export function getWeatherSeries(db: Db, municipality: string, from: string, to: string): WeatherDay[] {
  const rows = db
    .prepare(
      `SELECT date, municipality, mean_temp_c, rainfall_mm, source FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY date
           ORDER BY CASE source WHEN 'simulated' THEN 0 WHEN 'api' THEN 1 ELSE 2 END
         ) AS rn
         FROM weather_record
         WHERE municipality = ? AND date BETWEEN ? AND ?
       ) WHERE rn = 1 ORDER BY date`,
    )
    .all(municipality, from, to) as {
    date: string;
    municipality: string;
    mean_temp_c: number;
    rainfall_mm: number;
    source: WeatherSource;
  }[];
  return rows.map((r) => ({
    date: r.date,
    municipality: r.municipality,
    meanTempC: r.mean_temp_c,
    rainfallMm: r.rainfall_mm,
    source: r.source,
  }));
}

export function latestWeatherDate(db: Db, municipality: string): string | null {
  const r = db.prepare("SELECT MAX(date) AS d FROM weather_record WHERE municipality = ?").get(municipality) as {
    d: string | null;
  };
  return r.d;
}

export function deleteSimulatedWeather(db: Db, municipality: string): number {
  return db.prepare("DELETE FROM weather_record WHERE municipality = ? AND source = 'simulated'").run(municipality).changes;
}

export function answerTotals(db: Db, barangayId: number, from: string, to: string) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(answer = 'yes'), 0) AS yes
       FROM daily_answer WHERE barangay_id = ? AND date BETWEEN ? AND ?`,
    )
    .get(barangayId, from, to) as { total: number; yes: number };
}

export function reportTotals(db: Db, barangayId: number, from: string, to: string) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(standing_water = 1 OR clogged_gutter = 1 OR old_containers = 1), 0) AS withBreeding
       FROM household_report WHERE barangay_id = ? AND date BETWEEN ? AND ?`,
    )
    .get(barangayId, from, to) as { total: number; withBreeding: number };
}

export function symptomTotals(db: Db, barangayId: number, from: string, to: string) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(checks), 0) AS checks,
              COALESCE(SUM(checks_with_warning_signs), 0) AS warning
       FROM symptom_count WHERE barangay_id = ? AND date BETWEEN ? AND ?`,
    )
    .get(barangayId, from, to) as { checks: number; warning: number };
}

/** Surveys, containers inspected and containers positive for larvae or pupae. */
export function surveyTotals(db: Db, barangayId: number, from: string, to: string) {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS surveys,
              COALESCE(SUM(c.total), 0) AS containers,
              COALESCE(SUM(c.positive), 0) AS positive
       FROM entomological_survey s
       LEFT JOIN survey_container c ON c.survey_id = s.id
       WHERE s.barangay_id = ? AND s.survey_date BETWEEN ? AND ?`,
    )
    .get(barangayId, from, to) as { surveys: number; containers: number; positive: number };
}

// ---- resident and symptom writes -------------------------------------------

/** One answer per resident per day. Returns false if they already answered today. */
export function insertDailyAnswer(
  db: Db,
  a: { residentId: number; barangayId: number; date: string; answer: "yes" | "no"; at?: string },
): boolean {
  const at = a.at ?? new Date().toISOString();
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO daily_answer (resident_id, barangay_id, date, answer, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(a.residentId, a.barangayId, a.date, a.answer, at).changes > 0
  );
}

export function insertHouseholdReport(
  db: Db,
  r: {
    residentId: number;
    barangayId: number;
    date: string;
    standingWater: boolean;
    cloggedGutter: boolean;
    oldContainers: boolean;
    bitesIndoors: boolean;
    at?: string;
  },
): number {
  const at = r.at ?? new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO household_report
        (resident_id, barangay_id, date, standing_water, clogged_gutter, old_containers, bites_indoors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.residentId, r.barangayId, r.date, +r.standingWater, +r.cloggedGutter, +r.oldContainers, +r.bitesIndoors, at);
  return Number(info.lastInsertRowid);
}

/** Adds one anonymous symptom check to the barangay's daily total. No resident is stored. */
export function addSymptomCheck(
  db: Db,
  c: { barangayId: number; date: string; warningSigns: boolean; at?: string },
): void {
  const at = c.at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO symptom_count (barangay_id, date, checks, checks_with_warning_signs, created_at)
     VALUES (@barangayId, @date, 1, @warning, @at)
     ON CONFLICT (barangay_id, date) DO UPDATE SET
       checks = checks + 1,
       checks_with_warning_signs = checks_with_warning_signs + @warning`,
  ).run({ barangayId: c.barangayId, date: c.date, warning: c.warningSigns ? 1 : 0, at });
}
