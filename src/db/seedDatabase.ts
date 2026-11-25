// Builds the sample Daraga data inside an empty, migrated database.
// Everything here is made up. The data is reproducible: the same anchor date
// always gives the same database. The `npm run seed` command is in seed.ts.

import { createHash } from "node:crypto";
import { DEFAULT_PARAMETERS } from "../algorithms/parameters";
import { computeThreatScore, Indices } from "../algorithms/scoring";
import { SimOverride, caseIndex, dayIndex, generate, weekIndex } from "../sim/generator";
import { mulberry32, pick, randInt, splitCount } from "../sim/random";
import {
  addDays,
  dayOfYear,
  daysBetween,
  formatIsoWeek,
  isoWeekOf,
  isoWeekStart,
} from "../util/dates";
import type { Db } from "./connection";
import { SAMPLE_BARANGAYS, SAMPLE_BHWS, SAMPLE_MUNICIPALITY } from "./sampleData";
import { hashPassword, hashPhone, hashToken } from "./security";

export const SEED_WEEKS = 8;
const SEED_DAYS = SEED_WEEKS * 7;
/**
 * The access token of the sample barangay at this position of SAMPLE_BARANGAYS. The seed stores only its hash.
 * The Demo tools page rebuilds the phone links from the same rule, so these links work for the SAMPLE data only.
 */
export function sampleBarangayToken(index: number): string {
  return createHash("sha256").update(`sample-barangay-token-${index}`).digest("hex").slice(0, 24);
}

export const OFFICER_USERNAME = "officer";
export const OFFICER_PASSWORD = "demo1234";

export interface SeedOptions {
  /** The "today" of the sample data, YYYY-MM-DD. */
  anchorDate: string;
  phoneSalt?: string;
}

export interface SeedSummary {
  anchorDate: string;
  startDate: string;
  currentWeek: string;
  counts: Record<string, number>;
  barangayTokens: { barangay: string; token: string }[];
}

const TABLES = [
  "barangay", "purok", "staff_user", "bhw", "barangay_access", "resident", "daily_answer", "household_report",
  "symptom_count", "weather_record", "case_record", "case_import", "model_parameters",
  "threat_score", "recommendation", "field_task", "entomological_survey", "survey_container", "event_log",
];

const HEAD_NAMES = ["A. Dela Cruz", "B. Garcia", "C. Mendoza", "D. Villanueva", "E. Bautista", "F. Aquino",
  "G. Ramos", "H. Torres", "I. Navarro", "J. Castillo", "K. Domingo", "L. Salazar"];
const OCCUPATIONS = ["Vendor", "Driver", "Teacher", "Farmer", "Laborer", "Housekeeper", "Tricycle driver"];
// the same four words the BHW form offers, so the paper copy of a sample form ticks the right box
const STRUCTURES = ["Concrete", "Semi-concrete", "Light/wooden", "Shanty"];
const CONTAINER_TYPES = ["Jar", "Jug/pitcher", "Drum", "Tin can", "Flower vase", "Bottle", "Ant trap", "Others"];

export function seedDatabase(db: Db, opts: SeedOptions): SeedSummary {
  const anchor = opts.anchorDate;
  const current = isoWeekOf(anchor);
  const startMonday = addDays(isoWeekStart(current), -7 * (SEED_WEEKS - 1));
  const availableDays = Math.min(SEED_DAYS, daysBetween(startMonday, anchor) + 1);
  const NOW = `${anchor}T09:00:00.000Z`;
  const stamp = (date: string, hour = "12") => `${date}T${hour}:00:00.000Z`;
  const weekStart = (w: number) => addDays(startMonday, 7 * w);
  const weekLabel = (w: number) => formatIsoWeek(isoWeekOf(weekStart(w)));
  const phoneSalt = opts.phoneSalt ?? "sample-phone-salt";
  const rng = mulberry32(2026);
  const barangayTokens: SeedSummary["barangayTokens"] = [];

  db.transaction(() => {
    // --- parameters (version from the code defaults, active) -----------------
    db.prepare(
      `INSERT INTO model_parameters (version, weights, constants, note, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(
      DEFAULT_PARAMETERS.version,
      JSON.stringify(DEFAULT_PARAMETERS.weights),
      JSON.stringify(DEFAULT_PARAMETERS.constants),
      "Default starting values (sample)",
      NOW,
    );

    // --- officer -----------------------------------------------------------
    const officerSalt = createHash("sha256").update("sample-officer-salt").digest("hex").slice(0, 32);
    const officerId = Number(
      db
        .prepare(
          `INSERT INTO staff_user (username, display_name, role, password_hash, created_at, updated_at)
           VALUES (?, ?, 'officer', ?, ?, ?)`,
        )
        .run(OFFICER_USERNAME, "Health Officer (sample)", hashPassword(OFFICER_PASSWORD, officerSalt), NOW, NOW)
        .lastInsertRowid,
    );

    // --- barangays and puroks ----------------------------------------------
    const barangayId: number[] = [];
    const purokIds: number[][] = [];
    const insBarangay = db.prepare(
      `INSERT INTO barangay (name, municipality, population, area_km2, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insPurok = db.prepare("INSERT INTO purok (barangay_id, name, created_at) VALUES (?, ?, ?)");
    for (const s of SAMPLE_BARANGAYS) {
      const id = Number(insBarangay.run(s.name, SAMPLE_MUNICIPALITY, s.population, s.areaKm2, NOW, NOW).lastInsertRowid);
      barangayId.push(id);
      const ids: number[] = [];
      for (let p = 1; p <= s.puroks; p++) ids.push(Number(insPurok.run(id, `Purok ${p}`, NOW).lastInsertRowid));
      purokIds.push(ids);
    }

    // --- health workers ----------------------------------------------------
    const bhwOfBarangay = new Map<number, { id: number; name: string }>();
    const insBhw = db.prepare(
      `INSERT INTO bhw (display_name, barangay_id, team_label, access_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    SAMPLE_BHWS.forEach((b, i) => {
      const index = SAMPLE_BARANGAYS.findIndex((s) => s.name === b.barangay);
      // The per-person token column is not used any more; it only needs a unique value.
      const id = Number(insBhw.run(b.displayName, barangayId[index], b.team, hashToken(`unused-bhw-token-${i}`), NOW, NOW).lastInsertRowid);
      bhwOfBarangay.set(index, { id, name: b.displayName });
    });
    // One access token per barangay: the BHW screens open with it.
    const insAccess = db.prepare("INSERT INTO barangay_access (barangay_id, access_token_hash, created_at) VALUES (?, ?, ?)");
    SAMPLE_BARANGAYS.forEach((s, index) => {
      const token = sampleBarangayToken(index);
      insAccess.run(barangayId[index], hashToken(token), NOW);
      barangayTokens.push({ barangay: s.name, token });
    });

    // --- simulated signals -------------------------------------------------
    const overrides: SimOverride[] = SAMPLE_BARANGAYS.map((s) => ({
      population: s.population,
      areaKm2: s.areaKm2,
      purokCount: s.puroks,
      caseOnsetWeek: s.onsetWeek,
      hotPurok: s.hotPurok,
    }));
    const sim = generate({
      barangays: SAMPLE_BARANGAYS.length,
      weeks: SEED_WEEKS,
      seed: 2026,
      startDayOfYear: dayOfYear(startMonday),
      spellWeek: SEED_WEEKS - 3,
      overrides,
    });

    // Peñafrancia: many cases, but spread out (1 per purok per week), so its
    // score is high while the Tier 2 rule stays locked. This shows that a high
    // score alone never authorizes fogging.
    const penafrancia = SAMPLE_BARANGAYS.findIndex((s) => s.name === "Peñafrancia");
    for (let w = SEED_WEEKS - 2; w < SEED_WEEKS; w++) {
      for (let p = 0; p < SAMPLE_BARANGAYS[penafrancia].puroks; p++) sim.cases[caseIndex(sim, penafrancia, w, p)] = 1;
    }

    // The wireframe story: Bascaran Purok 4 has 3 confirmed cases in the last two weeks.
    const bascaran = SAMPLE_BARANGAYS.findIndex((s) => s.name === "Bascaran");
    sim.cases[caseIndex(sim, bascaran, SEED_WEEKS - 2, 3)] = 0;
    sim.cases[caseIndex(sim, bascaran, SEED_WEEKS - 1, 3)] = 3;

    // --- weather (a file load) ---------------------------------------------
    const insWeather = db.prepare(
      `INSERT INTO weather_record (date, municipality, mean_temp_c, rainfall_mm, source, created_at)
       VALUES (?, ?, ?, ?, 'file', ?)`,
    );
    for (let day = 0; day < availableDays; day++) {
      const date = addDays(startMonday, day);
      insWeather.run(date, SAMPLE_MUNICIPALITY, sim.meanTempC[day], sim.rainfallMm[day], stamp(date));
    }

    // --- residents, answers, reports, symptom counts -----------------------
    const insResident = db.prepare(
      "INSERT INTO resident (phone_hash, barangay_id, consent_at, created_at) VALUES (?, ?, ?, ?)",
    );
    const insAnswer = db.prepare(
      "INSERT INTO daily_answer (resident_id, barangay_id, date, answer, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const insReport = db.prepare(
      `INSERT INTO household_report
        (resident_id, barangay_id, date, standing_water, clogged_gutter, old_containers, bites_indoors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insSymptom = db.prepare(
      `INSERT INTO symptom_count (barangay_id, date, checks, checks_with_warning_signs, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    SAMPLE_BARANGAYS.forEach((_, b) => {
      let pool = 1;
      for (let day = 0; day < availableDays; day++) {
        const i = dayIndex(sim, b, day);
        pool = Math.max(pool, sim.answersTotal[i], sim.reportsTotal[i]);
      }
      const residents: number[] = [];
      for (let r = 0; r < pool; r++) {
        residents.push(
          Number(insResident.run(hashPhone(`09000${b}${String(r).padStart(5, "0")}`, phoneSalt), barangayId[b], stamp(startMonday, "00"), stamp(startMonday, "00")).lastInsertRowid),
        );
      }
      for (let day = 0; day < availableDays; day++) {
        const date = addDays(startMonday, day);
        const at = stamp(date);
        const i = dayIndex(sim, b, day);
        for (let r = 0; r < sim.answersTotal[i]; r++) {
          insAnswer.run(residents[r], barangayId[b], date, r < sim.answersYes[i] ? "yes" : "no", at);
        }
        for (let r = 0; r < sim.reportsTotal[i]; r++) {
          const breeding = r < sim.reportsWithBreeding[i];
          const item = randInt(rng, 0, 2);
          insReport.run(
            residents[r], barangayId[b], date,
            breeding && item === 0 ? 1 : 0,
            breeding && item === 1 ? 1 : 0,
            breeding && item === 2 ? 1 : 0,
            rng() < (breeding ? 0.4 : 0.1) ? 1 : 0,
            at,
          );
        }
        insSymptom.run(barangayId[b], date, sim.symptomChecks[i], sim.symptomWarning[i], at);
      }
    });

    // --- weekly cases and the import log -----------------------------------
    const insCase = db.prepare(
      `INSERT INTO case_record (barangay_id, purok_id, iso_week, week_start, confirmed_cases, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insImport = db.prepare(
      `INSERT INTO case_import (imported_at, officer_id, iso_week, row_count, status, errors, created_at)
       VALUES (?, ?, ?, ?, 'imported', '[]', ?)`,
    );
    const insEvent = db.prepare("INSERT INTO event_log (at, type, text, created_at) VALUES (?, ?, ?, ?)");
    const importedAt = (w: number) => {
      const date = addDays(weekStart(w), 7) > anchor ? anchor : addDays(weekStart(w), 7);
      return stamp(date, "08");
    };
    for (let w = 0; w < SEED_WEEKS; w++) {
      let rows = 0;
      SAMPLE_BARANGAYS.forEach((s, b) => {
        for (let p = 0; p < s.puroks; p++) {
          insCase.run(barangayId[b], purokIds[b][p], weekLabel(w), weekStart(w), sim.cases[caseIndex(sim, b, w, p)], importedAt(w));
          rows++;
        }
      });
      insImport.run(importedAt(w), officerId, weekLabel(w), rows, importedAt(w));
      if (w >= SEED_WEEKS - 2) {
        insEvent.run(importedAt(w), "import", `Case file for ${weekLabel(w)} imported: ${rows} rows, ${SAMPLE_BARANGAYS.length} barangays`, importedAt(w));
      }
    }
    insEvent.run(stamp(startMonday, "07"), "params", `Parameter version ${DEFAULT_PARAMETERS.version} created (default starting values)`, stamp(startMonday, "07"));
    insEvent.run(stamp(anchor, "07"), "weather", `Weather file loaded for ${SAMPLE_MUNICIPALITY} up to ${anchor}`, stamp(anchor, "07"));

    // --- past decisions, the two assignments and their surveys ---------------
    // These need a score to point at, so a few sample score rows are written
    // for the past decision dates. Current scores are computed by the ranking
    // service when the server starts.
    const maxDensity = Math.max(...SAMPLE_BARANGAYS.map((s) => s.population / s.areaKm2));
    const insScore = db.prepare(
      `INSERT INTO threat_score
        (barangay_id, computed_at, score, w, c, s, f, h, weights_used, density_factor, raw_summary, params_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const addDecision = (
      name: string,
      daysAgo: number,
      indices: Indices,
      status: "confirmed" | "rejected",
      reason: string | null,
      taskStatus: "new" | "in_progress" | null,
      taskPuroks: string[],
    ) => {
      const b = SAMPLE_BARANGAYS.findIndex((s) => s.name === name);
      const s = SAMPLE_BARANGAYS[b];
      const at = stamp(addDays(anchor, -daysAgo), "10");
      const result = computeThreatScore(indices, s.population / s.areaKm2 / maxDensity, DEFAULT_PARAMETERS);
      const scoreId = Number(
        insScore.run(
          barangayId[b], at, result.score, indices.weather, indices.household, indices.symptom, indices.field, indices.cases,
          JSON.stringify(result.factors), result.densityFactor, JSON.stringify({ sample: true }), DEFAULT_PARAMETERS.version, at,
        ).lastInsertRowid,
      );
      const recId = Number(
        db
          .prepare(
            `INSERT INTO recommendation (barangay_id, score_id, tier, status, reason, officer_id, decided_at, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(barangayId[b], scoreId, status, reason, officerId, at, at, at).lastInsertRowid,
      );
      insEvent.run(at, "decision", status === "confirmed" ? `Confirmed Tier 1 for ${name}` : `Rejected Tier 1 for ${name}: "${reason}"`, at);
      const bhw = bhwOfBarangay.get(b);
      if (!taskStatus || !bhw) return null;
      return Number(
        db
          .prepare(
            `INSERT INTO field_task (recommendation_id, barangay_id, bhw_id, type, puroks, status, created_at, updated_at)
             VALUES (?, ?, ?, 'search_and_destroy', ?, ?, ?, ?)`,
          )
          .run(recId, barangayId[b], bhw.id, JSON.stringify(taskPuroks), taskStatus, at, at).lastInsertRowid,
      );
    };
    // The field work in the sample: only two barangays, each with a Tier 1 assignment and the household surveys
    // done for it (every survey belongs to its task and has its own log line). The other barangays have no field work
    // yet, so a task can be confirmed and surveyed live during a demonstration.
    const sagponTask = addDecision("Sagpon", 9, { weather: 0.7, household: 0.6, symptom: 0.45, field: 0.4, cases: 0.55 }, "confirmed", null, "in_progress", ["Purok 1", "Purok 2", "Purok 4"]);
    const penaTask = addDecision("Peñafrancia", 4, { weather: 0.72, household: 0.55, symptom: 0.4, field: 0.35, cases: 0.5 }, "confirmed", null, "in_progress", ["Purok 1", "Purok 2", "Purok 3"]);
    addDecision("Kilicao", 6, { weather: 0.55, household: 0.4, symptom: 0.15, field: 0.25, cases: 0.1 }, "rejected", "Cases still low; recheck after the next weekly report.", null, []);

    const insSurvey = db.prepare(
      `INSERT INTO entomological_survey
        (task_id, bhw_id, barangay_id, purok_id, house_no, head_of_family, age, sex, civil_status, occupation,
         persons_slept, building_structure, storeys, rooms, screened, surveyed_by, survey_date,
         no_containers_found, submitted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insContainer = db.prepare(
      `INSERT INTO survey_container
        (survey_id, location, container_type, total, with_cover, without_cover, positive, larvae_count, pupae_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    /**
     * The households surveyed for one task: `days` lists, for each household, how many days before the sample date it
     * was surveyed (oldest first); `positiveRate` is how often a container row holds larvae.
     */
    const surveyTask = (name: string, taskId: number | null, puroks: string[], days: number[], positiveRate: number, completed: boolean) => {
      const b = SAMPLE_BARANGAYS.findIndex((s) => s.name === name);
      const bhw = bhwOfBarangay.get(b);
      if (taskId === null || !bhw) return;
      const purokRows = db.prepare("SELECT id, name FROM purok WHERE barangay_id = ? ORDER BY id").all(barangayId[b]) as { id: number; name: string }[];
      const heads = [...HEAD_NAMES];
      const houses = new Set<string>();
      let last = "";
      days.forEach((daysAgo, k) => {
        const date = addDays(anchor, -daysAgo);
        const submitted = stamp(date, String(1 + (k % 7)).padStart(2, "0")); // 09:00 to 15:00 in Manila (the stamps are UTC)
        const purok = purokRows.find((p) => p.name === puroks[k % puroks.length])!;
        let house = String(randInt(rng, 1, 220));
        while (houses.has(house)) house = String(randInt(rng, 1, 220));
        houses.add(house);
        const head = heads.splice(randInt(rng, 0, heads.length - 1), 1)[0] ?? pick(rng, HEAD_NAMES);
        const rows = [];
        const rowCount = randInt(rng, 1, 3);
        for (let r = 0; r < rowCount; r++) {
          const total = randInt(rng, 1, 6);
          const positive = rng() < positiveRate ? randInt(rng, 1, Math.min(3, total)) : 0;
          const withCover = randInt(rng, 0, total);
          rows.push({
            location: (rng() < 0.5 ? "indoor" : "outdoor") as "indoor" | "outdoor",
            containerType: pick(rng, CONTAINER_TYPES),
            total, withCover, withoutCover: total - withCover, positive,
            larvae: positive * randInt(rng, 5, 40), pupae: positive * randInt(rng, 0, 8),
          });
        }
        const surveyId = Number(
          insSurvey.run(
            taskId, bhw.id, barangayId[b], purok.id, house, head, randInt(rng, 22, 70), pick(rng, ["Male", "Female"]),
            pick(rng, ["Single", "Married", "Widowed"]), pick(rng, OCCUPATIONS), randInt(rng, 1, 8), pick(rng, STRUCTURES),
            randInt(rng, 1, 2), randInt(rng, 1, 5), rng() < 0.4 ? 1 : 0, bhw.name, date, 0, submitted, submitted,
          ).lastInsertRowid,
        );
        for (const c of rows) insContainer.run(surveyId, c.location, c.containerType, c.total, c.withCover, c.withoutCover, c.positive, c.larvae, c.pupae, submitted);
        // the same words the server writes when a BHW submits
        insEvent.run(submitted, "submission", `Survey submitted for ${name} (${purok.name})`, submitted);
        last = submitted;
      });
      db.prepare("UPDATE field_task SET status = ?, updated_at = ? WHERE id = ?").run(completed ? "completed" : "in_progress", last, taskId);
    };
    surveyTask("Sagpon", sagponTask, ["Purok 1", "Purok 2", "Purok 4"], [8, 8, 7, 7, 6, 6, 5, 5, 4, 4], 0.55, true);
    surveyTask("Peñafrancia", penaTask, ["Purok 1", "Purok 2", "Purok 3"], [3, 3, 2, 2, 2, 1, 1], 0.4, false);
  })();

  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { anchorDate: anchor, startDate: startMonday, currentWeek: formatIsoWeek(current), counts, barangayTokens };
}
