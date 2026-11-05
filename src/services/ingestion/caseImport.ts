// Weekly confirmed-case import (SF2). The whole file is checked first; it is
// saved only if every row is valid, otherwise nothing is written.
//
// File format (one reporting week per file, header required, any column order):
//   week,barangay,purok,cases
//   2026-W46,Peñafrancia,Purok 1,0
// Row numbers in messages count records like a spreadsheet: row 1 is the header.
// This file is the only place that knows the format. Change it here if the
// hospital's real format turns out to be different.

import type { Db } from "../../db/connection";
import { listBarangays } from "../../db/repositories/barangayRepo";
import { insertCaseImport, replaceWeekCases, CaseRow } from "../../db/repositories/caseRepo";
import { addEvent } from "../../db/repositories/workflowRepo";
import { formatIsoWeek, isoWeekStart, parseIsoWeek } from "../../util/dates";
import { parseDelimited } from "./csv";

export const CASE_FILE_MAX_BYTES = 1024 * 1024;
const REQUIRED_COLUMNS = ["week", "barangay", "purok", "cases"] as const;

export interface RowResult {
  row: number;
  ok: boolean;
  error?: string;
}

export interface CaseImportResult {
  success: boolean;
  /** The file's week, e.g. "2026-W46", or null if it could not be read. */
  isoWeek: string | null;
  /** Problems with the file as a whole (size, header, no rows). */
  fileErrors: string[];
  /** One entry per data row. */
  rows: RowResult[];
  rowCount: number;
  affectedBarangayIds: number[];
  importId: number | null;
}

/** Lower case, no accents, single spaces: "  PEÑAFRANCIA " matches "Peñafrancia". */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizePurok(s: string): string {
  const n = normalizeName(s);
  return /^\d+$/.test(n) ? `purok ${n}` : n; // "4" is accepted as "Purok 4"
}

interface BarangayLookup {
  id: number;
  name: string;
  puroks: Map<string, { id: number; name: string }>;
}

function buildLookup(db: Db): Map<string, BarangayLookup> {
  const lookup = new Map<string, BarangayLookup>();
  for (const b of listBarangays(db)) {
    lookup.set(normalizeName(b.name), {
      id: b.id,
      name: b.name,
      puroks: new Map(b.puroks.map((p) => [normalizePurok(p.name), { id: p.id, name: p.name }])),
    });
  }
  return lookup;
}

function reject(fileErrors: string[], rows: RowResult[] = [], isoWeek: string | null = null): CaseImportResult {
  return { success: false, isoWeek, fileErrors, rows, rowCount: rows.length, affectedBarangayIds: [], importId: null };
}

/** Checks the text without saving anything. */
export function validateCaseText(
  db: Db,
  text: string,
): { result: CaseImportResult; valid: CaseRow[]; weekStart: string | null } {
  if (Buffer.byteLength(text, "utf8") > CASE_FILE_MAX_BYTES) {
    return { result: reject(["The file is larger than 1 MB."]), valid: [], weekStart: null };
  }
  const records = parseDelimited(text);
  const headerIndex = records.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIndex === -1) return { result: reject(["The file is empty."]), valid: [], weekStart: null };

  const header = records[headerIndex].map((c) => normalizeName(c));
  const column: Record<string, number> = {};
  for (const name of REQUIRED_COLUMNS) column[name] = header.indexOf(name);
  const missing = REQUIRED_COLUMNS.filter((name) => column[name] === -1);
  if (missing.length > 0) {
    return {
      result: reject([`Header must have the columns week, barangay, purok, cases. Missing: ${missing.join(", ")}.`]),
      valid: [],
      weekStart: null,
    };
  }

  const lookup = buildLookup(db);
  const rows: RowResult[] = [];
  const valid: CaseRow[] = [];
  const seen = new Map<string, number>(); // "barangayId:purokId" -> row number
  let fileWeek: string | null = null;
  let dataRows = 0;

  for (let i = headerIndex + 1; i < records.length; i++) {
    const cells = records[i];
    if (cells.every((c) => c.trim() === "")) continue; // blank line
    const row = i + 1;
    dataRows++;
    const fail = (error: string) => rows.push({ row, ok: false, error: `Row ${row}: ${error}` });

    if (cells.length !== header.length) {
      fail(`expected ${header.length} values but found ${cells.length}.`);
      continue;
    }
    const weekText = cells[column.week].trim();
    const barangayText = cells[column.barangay].trim();
    const purokText = cells[column.purok].trim();
    const casesText = cells[column.cases].trim();

    const problems: string[] = [];

    const parsedWeek = weekText === "" ? null : parseIsoWeek(weekText);
    if (weekText === "") problems.push("week is missing.");
    else if (!parsedWeek) problems.push(`week "${weekText}" is not a valid ISO week like 2026-W46.`);
    else {
      const label = formatIsoWeek(parsedWeek);
      if (fileWeek === null) fileWeek = label;
      else if (label !== fileWeek) problems.push(`week ${label} differs from ${fileWeek}; one week per file.`);
    }

    const barangay = barangayText === "" ? undefined : lookup.get(normalizeName(barangayText));
    if (barangayText === "") problems.push("barangay is missing.");
    else if (!barangay) problems.push(`barangay "${barangayText}" is not in the system.`);

    const purok = barangay && purokText !== "" ? barangay.puroks.get(normalizePurok(purokText)) : undefined;
    if (purokText === "") problems.push("purok is missing.");
    else if (barangay && !purok) problems.push(`purok "${purokText}" does not exist in ${barangay.name}.`);

    let cases = 0;
    if (casesText === "") problems.push("cases is missing.");
    else if (!/^\d+$/.test(casesText)) problems.push(`cases "${casesText}" must be a whole number of 0 or more.`);
    else cases = Number(casesText);

    if (barangay && purok) {
      const key = `${barangay.id}:${purok.id}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) problems.push(`duplicate of row ${earlier} (${barangay.name}, ${purok.name}).`);
      else seen.set(key, row);
    }

    if (problems.length > 0) {
      fail(problems.join(" "));
    } else if (barangay && purok) {
      rows.push({ row, ok: true });
      valid.push({ barangayId: barangay.id, purokId: purok.id, cases });
    }
  }

  const fileErrors: string[] = [];
  if (dataRows === 0) fileErrors.push("The file has a header but no data rows.");
  const failed = rows.some((r) => !r.ok);
  const success = fileErrors.length === 0 && !failed;
  const weekStart = fileWeek ? isoWeekStart(parseIsoWeek(fileWeek)!) : null;
  return {
    result: {
      success,
      isoWeek: fileWeek,
      fileErrors,
      rows,
      rowCount: dataRows,
      affectedBarangayIds: success ? [...new Set(valid.map((r) => r.barangayId))].sort((a, b) => a - b) : [],
      importId: null,
    },
    valid: success ? valid : [],
    weekStart,
  };
}

/**
 * Validates and, only if every row is valid, saves the week in one transaction
 * (replacing that week's rows for the barangays in the file) and logs it.
 * A rejected file writes nothing at all.
 */
export function importCases(db: Db, text: string, officerId: number, now: Date = new Date()): CaseImportResult {
  const { result, valid, weekStart } = validateCaseText(db, text);
  if (!result.success || !result.isoWeek || !weekStart) return result;

  const at = now.toISOString();
  const isoWeek = result.isoWeek;
  const importId = db.transaction(() => {
    replaceWeekCases(db, isoWeek, weekStart, valid, at);
    const id = insertCaseImport(db, { importedAt: at, officerId, isoWeek, rowCount: valid.length });
    addEvent(
      db,
      "import",
      `Case file for ${isoWeek} imported: ${valid.length} rows, ${result.affectedBarangayIds.length} barangays`,
      at,
    );
    return id;
  })();
  return { ...result, importId };
}
