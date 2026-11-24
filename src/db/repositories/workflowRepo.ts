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

export function listTasksForBarangay(db: Db, barangayId: number) {
  const rows = db
    .prepare(
      `SELECT id, recommendation_id AS recommendationId, barangay_id AS barangayId, type, puroks, status,
              created_at AS createdAt
       FROM field_task WHERE barangay_id = ? ORDER BY id DESC`,
    )
    .all(barangayId) as {
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
  /** Made by the phone; the same value sent again is the same survey. */
  clientSubmissionId?: string | null;
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

/** A household's details, as filled in on the form. Only listed when the server is set to share them. */
export interface HouseholdDetails {
  headOfFamily: string | null;
  age: number | null;
  sex: string | null;
  civilStatus: string | null;
  occupation: string | null;
  personsSlept: number | null;
  buildingStructure: string | null;
  storeys: number | null;
  rooms: number | null;
  screened: boolean | null;
}

/**
 * What a BHW sees of the barangay's recent surveys: where, when, by whom and the container counts. A household's
 * details (`household`) are there only when the server is set to share them.
 */
export interface BhwSurveyRow {
  id: number;
  clientSubmissionId: string | null;
  taskId: number | null;
  surveyDate: string;
  submittedAt: string;
  houseNo: string | null;
  purokId: number | null;
  purokName: string | null;
  /** The name typed on the form (or the registered worker's name for older rows). */
  interviewer: string | null;
  noContainersFound: boolean;
  household?: HouseholdDetails;
  containers: {
    location: "indoor" | "outdoor" | "natural";
    containerType: string;
    total: number;
    withCover: number;
    withoutCover: number;
    positive: number;
    larvaeCount: number;
    pupaeCount: number;
  }[];
}

/**
 * The surveys of one barangay with a survey date on or after `sinceDate`, newest submission first, at most `limit`.
 * The head of the family, age, sex, civil status, occupation and the building details are only selected when
 * `withHousehold` is true (the server is set to share them): the barangay link is shared, so by default this list
 * stays free of personal details.
 */
export function listRecentSurveysOfBarangay(db: Db, barangayId: number, sinceDate: string, limit: number, withHousehold = false): BhwSurveyRow[] {
  const household = withHousehold
    ? `, s.head_of_family AS headOfFamily, s.age AS age, s.sex AS sex, s.civil_status AS civilStatus, s.occupation AS occupation,
        s.persons_slept AS personsSlept, s.building_structure AS buildingStructure, s.storeys AS storeys, s.rooms AS rooms,
        s.screened AS screened`
    : "";
  const rows = db
    .prepare(
      `SELECT s.id, s.client_submission_id AS clientSubmissionId, s.task_id AS taskId, s.survey_date AS surveyDate,
              s.submitted_at AS submittedAt, s.house_no AS houseNo, s.purok_id AS purokId, p.name AS purokName,
              COALESCE(s.surveyed_by, h.display_name) AS interviewer,
              s.no_containers_found AS noContainersFound${household}
       FROM entomological_survey s
       LEFT JOIN purok p ON p.id = s.purok_id
       LEFT JOIN bhw h ON h.id = s.bhw_id
       WHERE s.barangay_id = ? AND s.survey_date >= ?
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(barangayId, sinceDate, limit) as (Omit<BhwSurveyRow, "noContainersFound" | "containers" | "household"> & { noContainersFound: number } & Partial<Omit<HouseholdDetails, "screened">> & { screened?: number | null })[];
  if (rows.length === 0) return [];

  const byId = new Map<number, BhwSurveyRow["containers"]>();
  const marks = rows.map(() => "?").join(",");
  const containers = db
    .prepare(
      `SELECT survey_id AS surveyId, location, container_type AS containerType, total, with_cover AS withCover,
              without_cover AS withoutCover, positive, larvae_count AS larvaeCount, pupae_count AS pupaeCount
       FROM survey_container WHERE survey_id IN (${marks}) ORDER BY id`,
    )
    .all(...rows.map((r) => r.id)) as (BhwSurveyRow["containers"][number] & { surveyId: number })[];
  for (const { surveyId, ...c } of containers) byId.set(surveyId, [...(byId.get(surveyId) ?? []), c]);

  return rows.map((r) => {
    const { headOfFamily, age, sex, civilStatus, occupation, personsSlept, buildingStructure, storeys, rooms, screened, ...rest } = r;
    const row: BhwSurveyRow = { ...rest, noContainersFound: r.noContainersFound === 1, containers: byId.get(r.id) ?? [] };
    if (withHousehold) {
      row.household = {
        headOfFamily: headOfFamily ?? null,
        age: age ?? null,
        sex: sex ?? null,
        civilStatus: civilStatus ?? null,
        occupation: occupation ?? null,
        personsSlept: personsSlept ?? null,
        buildingStructure: buildingStructure ?? null,
        storeys: storeys ?? null,
        rooms: rooms ?? null,
        screened: screened === null || screened === undefined ? null : screened === 1,
      };
    }
    return row;
  });
}

/** The survey already saved under this submission id in this barangay, if any. */
export function findSurveyBySubmission(db: Db, barangayId: number, clientSubmissionId: string): number | undefined {
  const r = db
    .prepare("SELECT id FROM entomological_survey WHERE barangay_id = ? AND client_submission_id = ?")
    .get(barangayId, clientSubmissionId) as { id: number } | undefined;
  return r?.id;
}

/** Saves a survey and its container rows together. Returns the survey id. */
export function insertSurvey(db: Db, s: NewSurvey, containers: NewContainer[]): number {
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO entomological_survey
          (task_id, bhw_id, barangay_id, purok_id, house_no, head_of_family, age, sex, civil_status, occupation,
           persons_slept, building_structure, storeys, rooms, screened, surveyed_by, survey_date,
           no_containers_found, submitted_at, created_at, client_submission_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        s.clientSubmissionId ?? null,
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

export const EVENT_TYPES: readonly EventType[] = ["decision", "import", "submission", "weather", "params", "alert"];

/**
 * The newest events, optionally of one type. A submission never carries the surveyor's name: newer rows are written
 * without it, and an older row ("<name> submitted a survey for Mabini (Purok 1)") is shown as "Survey submitted for
 * Mabini (Purok 1)", because a typed name can be misspelled and is not what the log is for.
 */
export function listEvents(db: Db, limit = 50, type?: EventType) {
  const rows = (
    type === undefined
      ? db.prepare("SELECT id, at, type, text FROM event_log ORDER BY at DESC, id DESC LIMIT ?").all(limit)
      : db.prepare("SELECT id, at, type, text FROM event_log WHERE type = ? ORDER BY at DESC, id DESC LIMIT ?").all(type, limit)
  ) as { id: number; at: string; type: EventType; text: string }[];
  return rows.map((r) =>
    r.type === "submission"
      ? { ...r, text: r.text.replace(/^.+? submitted a survey for /, "Survey submitted for ").replace(/^.+? submitted a spot check for /, "Spot check submitted for ") }
      : r,
  );
}

/** When this barangay's alerts were issued since `sinceIso` (for the alert cap). */
export function alertTimesSince(db: Db, barangayId: number, sinceIso: string): Date[] {
  const rows = db
    .prepare("SELECT issued_at AS t FROM alert WHERE barangay_id = ? AND issued_at >= ? ORDER BY issued_at")
    .all(barangayId, sinceIso) as { t: string }[];
  return rows.map((r) => new Date(r.t));
}

export function getTask(db: Db, id: number) {
  const r = db
    .prepare("SELECT id, barangay_id, bhw_id, type, status FROM field_task WHERE id = ?")
    .get(id) as { id: number; barangay_id: number; bhw_id: number; type: TaskType; status: TaskStatus } | undefined;
  return r ? { id: r.id, barangayId: r.barangay_id, bhwId: r.bhw_id, type: r.type, status: r.status } : undefined;
}

/** True if the barangay already has a task of this type that is not finished. */
export function hasOpenTask(db: Db, barangayId: number, type: TaskType): boolean {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM field_task WHERE barangay_id = ? AND type = ? AND status IN ('new','in_progress')")
    .get(barangayId, type) as { n: number };
  return r.n > 0;
}

export function countActiveTasks(db: Db): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM field_task WHERE status IN ('new','in_progress')").get() as { n: number };
  return r.n;
}

/** Every field assignment, open ones first. `households` counts the surveys filed against it. */
export function listTasks(db: Db) {
  const rows = db
    .prepare(
      `SELECT t.id, t.barangay_id AS barangayId, b.name AS barangayName, t.bhw_id AS bhwId,
              h.display_name AS bhwName, h.team_label AS teamLabel, t.type, t.status, t.puroks,
              t.recommendation_id AS recommendationId, t.created_at AS createdAt, t.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM entomological_survey s WHERE s.task_id = t.id) AS households
       FROM field_task t
       JOIN barangay b ON b.id = t.barangay_id
       JOIN bhw h ON h.id = t.bhw_id
       ORDER BY CASE t.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.id DESC`,
    )
    .all() as {
    id: number;
    barangayId: number;
    barangayName: string;
    bhwId: number;
    bhwName: string;
    teamLabel: string | null;
    type: TaskType;
    status: TaskStatus;
    puroks: string;
    recommendationId: number | null;
    createdAt: string;
    updatedAt: string;
    households: number;
  }[];
  return rows.map((r) => ({ ...r, puroks: JSON.parse(r.puroks) as string[] }));
}

export interface FindingFilters {
  barangayId?: number;
  /** Survey date range, inclusive (YYYY-MM-DD). */
  from?: string;
  to?: string;
  limit?: number;
}

/** Submitted surveys, newest first. Household details and the surveyor's name are NOT in this list (a typed name can be misspelled, so it is never used to group or filter). */
export function listFindings(db: Db, f: FindingFilters = {}) {
  return db
    .prepare(
      `SELECT s.id, s.barangay_id AS barangayId, b.name AS barangayName, s.purok_id AS purokId,
              p.name AS purokName, s.house_no AS houseNo, s.survey_date AS surveyDate,
              s.submitted_at AS submittedAt,
              COALESCE(SUM(c.total), 0) AS containers, COALESCE(SUM(c.positive), 0) AS positive
       FROM entomological_survey s
       JOIN barangay b ON b.id = s.barangay_id
       LEFT JOIN purok p ON p.id = s.purok_id
       LEFT JOIN survey_container c ON c.survey_id = s.id
       WHERE (@barangayId IS NULL OR s.barangay_id = @barangayId)
         AND (@from IS NULL OR s.survey_date >= @from)
         AND (@to IS NULL OR s.survey_date <= @to)
       GROUP BY s.id
       ORDER BY s.survey_date DESC, s.id DESC
       LIMIT @limit`,
    )
    .all({
      barangayId: f.barangayId ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      limit: f.limit ?? 200,
    }) as {
    id: number;
    barangayId: number;
    barangayName: string;
    purokId: number | null;
    purokName: string | null;
    houseNo: string | null;
    surveyDate: string;
    submittedAt: string;
    containers: number;
    positive: number;
  }[];
}

/** One whole survey with its containers, as on the paper form. Officers and BHWs only. */
export function getFinding(db: Db, id: number) {
  const s = db
    .prepare(
      `SELECT s.id, s.task_id AS taskId, s.bhw_id AS bhwId, s.barangay_id AS barangayId, b.name AS barangayName,
              s.purok_id AS purokId, p.name AS purokName, s.house_no AS houseNo, s.head_of_family AS headOfFamily,
              s.age, s.sex, s.civil_status AS civilStatus, s.occupation, s.persons_slept AS personsSlept,
              s.building_structure AS buildingStructure, s.storeys, s.rooms, s.screened,
              s.surveyed_by AS surveyedBy, s.survey_date AS surveyDate, s.no_containers_found AS noContainersFound,
              s.submitted_at AS submittedAt
       FROM entomological_survey s
       JOIN barangay b ON b.id = s.barangay_id
       LEFT JOIN purok p ON p.id = s.purok_id
       WHERE s.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!s) return undefined;
  const containers = db
    .prepare(
      `SELECT location, container_type AS containerType, total, with_cover AS withCover, without_cover AS withoutCover,
              positive, larvae_count AS larvaeCount, pupae_count AS pupaeCount
       FROM survey_container WHERE survey_id = ? ORDER BY id`,
    )
    .all(id);
  return { ...s, screened: s.screened === null ? null : Boolean(s.screened), noContainersFound: Boolean(s.noContainersFound), containers };
}
