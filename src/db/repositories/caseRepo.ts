import type { Db } from "../connection";

export interface CaseRow {
  barangayId: number;
  purokId: number;
  cases: number;
}

/**
 * Replaces the week's rows for every barangay that appears in `rows`, so a
 * corrected file simply overwrites the earlier one. Other barangays are left alone.
 */
export function replaceWeekCases(
  db: Db,
  isoWeek: string,
  weekStart: string,
  rows: CaseRow[],
  at: string = new Date().toISOString(),
): void {
  const del = db.prepare("DELETE FROM case_record WHERE iso_week = ? AND purok_id = ?");
  const ins = db.prepare(
    `INSERT INTO case_record (barangay_id, purok_id, iso_week, week_start, confirmed_cases, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const r of rows) del.run(isoWeek, r.purokId);
    for (const r of rows) ins.run(r.barangayId, r.purokId, isoWeek, weekStart, r.cases, at);
  })();
}

export interface NewCaseImport {
  importedAt: string;
  officerId: number;
  isoWeek: string;
  rowCount: number;
  status?: "imported" | "rejected";
  errors?: string[];
}

export function insertCaseImport(db: Db, r: NewCaseImport): number {
  const info = db
    .prepare(
      `INSERT INTO case_import (imported_at, officer_id, iso_week, row_count, status, errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.importedAt, r.officerId, r.isoWeek, r.rowCount, r.status ?? "imported", JSON.stringify(r.errors ?? []), r.importedAt);
  return Number(info.lastInsertRowid);
}

export function listCaseImports(db: Db, limit = 20) {
  return db
    .prepare(
      `SELECT id, imported_at AS importedAt, officer_id AS officerId, iso_week AS isoWeek,
              row_count AS rowCount, status, errors
       FROM case_import ORDER BY imported_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    importedAt: string;
    officerId: number;
    isoWeek: string;
    rowCount: number;
    status: string;
    errors: string;
  }[];
}

/** Confirmed cases in one barangay for one week (all puroks). */
export function barangayCases(db: Db, barangayId: number, isoWeek: string): number {
  const r = db
    .prepare("SELECT COALESCE(SUM(confirmed_cases), 0) AS n FROM case_record WHERE barangay_id = ? AND iso_week = ?")
    .get(barangayId, isoWeek) as { n: number };
  return r.n;
}

/** Per-purok totals over the given weeks, for the Tier 2 rule. Puroks with no rows count as 0. */
export function purokCases(
  db: Db,
  barangayId: number,
  isoWeeks: string[],
): { purokId: number; purokName: string; cases: number }[] {
  if (isoWeeks.length === 0) return [];
  const marks = isoWeeks.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT p.id AS purokId, p.name AS purokName,
              COALESCE(SUM(c.confirmed_cases), 0) AS cases
       FROM purok p
       LEFT JOIN case_record c ON c.purok_id = p.id AND c.iso_week IN (${marks})
       WHERE p.barangay_id = ?
       GROUP BY p.id ORDER BY p.id`,
    )
    .all(...isoWeeks, barangayId) as { purokId: number; purokName: string; cases: number }[];
}
