// Recommendations, field tasks, surveys, alerts and the event log.

import type { Db } from "../connection";

const now = () => new Date().toISOString();

// ---- recommendations -------------------------------------------------------

export function createRecommendation(
  db: Db,
  r: { barangayId: number; scoreId: number; tier: 1 | 2; at?: string },
): number {
  const at = r.at ?? now();
  const info = db
    .prepare(
      `INSERT INTO recommendation (barangay_id, score_id, tier, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(r.barangayId, r.scoreId, r.tier, at, at);
  return Number(info.lastInsertRowid);
}

/** Confirm or reject. Rejecting needs a reason (the service checks the length). */
export function decideRecommendation(
  db: Db,
  r: { id: number; status: "confirmed" | "rejected"; officerId: number; reason?: string; at?: string },
): boolean {
  const at = r.at ?? now();
  return (
    db
      .prepare(
        `UPDATE recommendation SET status = ?, officer_id = ?, reason = ?, decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(r.status, r.officerId, r.reason ?? null, at, at, r.id).changes > 0
  );
}

export function listRecommendations(db: Db, status?: "pending" | "confirmed" | "rejected") {
  const sql = `SELECT id, barangay_id AS barangayId, score_id AS scoreId, tier, status, reason,
                      officer_id AS officerId, decided_at AS decidedAt, created_at AS createdAt
               FROM recommendation ${status ? "WHERE status = ?" : ""} ORDER BY id DESC`;
  const stmt = db.prepare(sql);
  return (status ? stmt.all(status) : stmt.all()) as {
    id: number;
    barangayId: number;
    scoreId: number;
    tier: number;
    status: string;
    reason: string | null;
    officerId: number | null;
    decidedAt: string | null;
    createdAt: string;
  }[];
}

// ---- field tasks -----------------------------------------------------------

export type TaskType = "search_and_destroy" | "spot_check" | "tier2_verification";
export type TaskStatus = "new" | "in_progress" | "completed";

export function createTask(
  db: Db,
  t: {
    recommendationId?: number | null;
    barangayId: number;
    bhwId: number;
    type: TaskType;
    puroks: string[];
    status?: TaskStatus;
    at?: string;
  },
): number {
  const at = t.at ?? now();
  const info = db
    .prepare(
      `INSERT INTO field_task (recommendation_id, barangay_id, bhw_id, type, puroks, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.recommendationId ?? null, t.barangayId, t.bhwId, t.type, JSON.stringify(t.puroks), t.status ?? "new", at, at);
  return Number(info.lastInsertRowid);
}

export function listTasksForBhw(db: Db, bhwId: number) {
  const rows = db
    .prepare(
      `SELECT id, recommendation_id AS recommendationId, barangay_id AS barangayId, type, puroks, status,
              created_at AS createdAt
       FROM field_task WHERE bhw_id = ? ORDER BY id DESC`,
    )
    .all(bhwId) as {
    id: number;
    recommendationId: number | null;
    barangayId: number;
    type: TaskType;
    puroks: string;
    status: TaskStatus;
    createdAt: string;
  }[];
  return rows.map((r) => ({ ...r, puroks: JSON.parse(r.puroks) as string[] }));
}

export function updateTaskStatus(db: Db, id: number, status: TaskStatus, at: string = now()): boolean {
  return db.prepare("UPDATE field_task SET status = ?, updated_at = ? WHERE id = ?").run(status, at, id).changes > 0;
}

// ---- entomological surveys -------------------------------------------------

export interface NewSurvey {
  taskId?: number | null;
  bhwId?: number | null;
  barangayId: number;
  purokId?: number | null;
  houseNo?: string;
  headOfFamily?: string;
  age?: number;
  sex?: string;
  civilStatus?: string;
  occupation?: string;
  personsSlept?: number;
  buildingStructure?: string;
  storeys?: number;
  rooms?: number;
  screened?: boolean;
  surveyedBy?: string;
  surveyDate: string;
  noContainersFound: boolean;
  submittedAt: string;
}

export interface NewContainer {
  location: "indoor" | "outdoor" | "natural";
  containerType: string;
  total: number;
  withCover: number;
  withoutCover: number;
  positive: number;
  larvaeCount?: number;
  pupaeCount?: number;
}

/** Saves a survey and its container rows together. Returns the survey id. */
export function insertSurvey(db: Db, s: NewSurvey, containers: NewContainer[]): number {
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO entomological_survey
          (task_id, bhw_id, barangay_id, purok_id, house_no, head_of_family, age, sex, civil_status, occupation,
           persons_slept, building_structure, storeys, rooms, screened, surveyed_by, survey_date,
           no_containers_found, submitted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.taskId ?? null,
        s.bhwId ?? null,
        s.barangayId,
        s.purokId ?? null,
        s.houseNo ?? null,
        s.headOfFamily ?? null,
        s.age ?? null,
        s.sex ?? null,
        s.civilStatus ?? null,
        s.occupation ?? null,
        s.personsSlept ?? null,
        s.buildingStructure ?? null,
        s.storeys ?? null,
        s.rooms ?? null,
        s.screened === undefined ? null : s.screened ? 1 : 0,
        s.surveyedBy ?? null,
        s.surveyDate,
        s.noContainersFound ? 1 : 0,
        s.submittedAt,
        s.submittedAt,
      );
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO survey_container
        (survey_id, location, container_type, total, with_cover, without_cover, positive, larvae_count, pupae_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of containers) {
      ins.run(id, c.location, c.containerType, c.total, c.withCover, c.withoutCover, c.positive, c.larvaeCount ?? 0, c.pupaeCount ?? 0, s.submittedAt);
    }
    return id;
  })();
}

export function listSurveysForBarangay(db: Db, barangayId: number, limit = 50) {
  return db
    .prepare(
      `SELECT s.id, s.survey_date AS surveyDate, s.submitted_at AS submittedAt, s.purok_id AS purokId,
              COALESCE(SUM(c.total), 0) AS containers, COALESCE(SUM(c.positive), 0) AS positive
       FROM entomological_survey s LEFT JOIN survey_container c ON c.survey_id = s.id
       WHERE s.barangay_id = ? GROUP BY s.id ORDER BY s.survey_date DESC, s.id DESC LIMIT ?`,
    )
    .all(barangayId, limit) as {
    id: number;
    surveyDate: string;
    submittedAt: string;
    purokId: number | null;
    containers: number;
    positive: number;
  }[];
}

// ---- alerts ----------------------------------------------------------------

export type AlertLevel = "low" | "moderate" | "elevated" | "high";

export function insertAlert(db: Db, a: { barangayId: number; level: AlertLevel; message: string; issuedAt?: string }): number {
  const at = a.issuedAt ?? now();
  const info = db
    .prepare("INSERT INTO alert (barangay_id, level, issued_at, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(a.barangayId, a.level, at, a.message, at);
  return Number(info.lastInsertRowid);
}

export function countAlertsSince(db: Db, barangayId: number, sinceIso: string): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM alert WHERE barangay_id = ? AND issued_at >= ?")
    .get(barangayId, sinceIso) as { n: number };
  return r.n;
}

export function listAlerts(db: Db, barangayId: number, limit = 10) {
  return db
    .prepare(
      "SELECT id, level, issued_at AS issuedAt, message FROM alert WHERE barangay_id = ? ORDER BY issued_at DESC, id DESC LIMIT ?",
    )
    .all(barangayId, limit) as { id: number; level: AlertLevel; issuedAt: string; message: string }[];
}

// ---- event log -------------------------------------------------------------

export type EventType = "decision" | "import" | "submission" | "weather" | "params" | "alert";

export function addEvent(db: Db, type: EventType, text: string, at: string = now()): number {
  const info = db.prepare("INSERT INTO event_log (at, type, text, created_at) VALUES (?, ?, ?, ?)").run(at, type, text, at);
  return Number(info.lastInsertRowid);
}

export function listEvents(db: Db, limit = 50) {
  return db
    .prepare("SELECT id, at, type, text FROM event_log ORDER BY at DESC, id DESC LIMIT ?")
    .all(limit) as { id: number; at: string; type: EventType; text: string }[];
}
