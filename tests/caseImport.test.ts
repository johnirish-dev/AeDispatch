import { describe, it, expect } from "vitest";
import { CASE_FILE_MAX_BYTES, importCases, normalizeName, validateCaseText } from "../src/services/ingestion/caseImport";
import { listBarangays } from "../src/db/repositories/barangayRepo";
import { barangayCases, listCaseImports, purokCases } from "../src/db/repositories/caseRepo";
import { listEvents } from "../src/db/repositories/workflowRepo";
import { count, dataFile, officerId, seededDb } from "./helpers";

const HEADER = "week,barangay,purok,cases";

function setup() {
  const db = seededDb();
  return { db, officer: officerId(db) };
}

function snapshot(db: ReturnType<typeof seededDb>) {
  return [count(db, "case_record"), count(db, "case_import"), count(db, "event_log")];
}

describe("importing the valid sample file", () => {
  it("saves every row, logs the import and reports the affected barangays", () => {
    const { db, officer } = setup();
    const before = count(db, "case_record");
    const result = importCases(db, dataFile("cases_valid.csv"), officer, new Date("2026-11-05T10:00:00Z"));

    expect(result.success).toBe(true);
    expect(result.isoWeek).toBe("2026-W46");
    expect(result.rowCount).toBe(41);
    expect(result.fileErrors).toEqual([]);
    expect(result.rows.every((r) => r.ok)).toBe(true);
    expect(result.affectedBarangayIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.importId).not.toBeNull();

    expect(count(db, "case_record")).toBe(before + 41);
    expect(listCaseImports(db, 1)[0]).toMatchObject({ isoWeek: "2026-W46", rowCount: 41, status: "imported" });
    expect(listEvents(db, 1)[0].text).toContain("2026-W46");
    const bascaran = listBarangays(db).find((b) => b.name === "Bascaran")!;
    expect(barangayCases(db, bascaran.id, "2026-W46")).toBe(5);
  });

  it("replaces the week when the corrected file is imported again", () => {
    const { db, officer } = setup();
    importCases(db, dataFile("cases_valid.csv"), officer);
    const afterFirst = count(db, "case_record");
    const fixed = dataFile("cases_valid.csv").replace("2026-W46,Bascaran,Purok 4,4", "2026-W46,Bascaran,Purok 4,0");
    expect(importCases(db, fixed, officer).success).toBe(true);
    expect(count(db, "case_record")).toBe(afterFirst); // replaced, not duplicated
    const bascaran = listBarangays(db).find((b) => b.name === "Bascaran")!;
    expect(purokCases(db, bascaran.id, ["2026-W46"]).find((p) => p.purokName === "Purok 4")!.cases).toBe(0);
    expect(count(db, "case_import")).toBe(8 + 2);
  });
});

describe("rejecting the sample file with errors", () => {
  it("lists a clear message for every bad row", () => {
    const { db } = setup();
    const { result } = validateCaseText(db, dataFile("cases_with_errors.csv"));
    expect(result.success).toBe(false);
    const errors = result.rows.filter((r) => !r.ok).map((r) => r.error!);
    const forRow = (n: number) => errors.find((e) => e.startsWith(`Row ${n}:`)) ?? "";

    expect(forRow(3)).toContain("purok is missing");
    expect(forRow(5)).toContain('"Atlantis" is not in the system');
    expect(forRow(8)).toContain('"abc" must be a whole number');
    expect(forRow(12)).toContain('"-2" must be a whole number');
    expect(forRow(15)).toContain('"Purok 9" does not exist in Bascaran');
    expect(forRow(20)).toContain("duplicate of row 19");
    expect(forRow(25)).toContain("differs from 2026-W46");
    expect(forRow(30)).toContain("expected 4 values but found 3");
    expect(errors).toHaveLength(8);
    expect(result.affectedBarangayIds).toEqual([]);
  });

  it("writes nothing when any row is bad", () => {
    const { db, officer } = setup();
    const before = snapshot(db);
    const result = importCases(db, dataFile("cases_with_errors.csv"), officer);
    expect(result.success).toBe(false);
    expect(result.importId).toBeNull();
    expect(snapshot(db)).toEqual(before);
  });
});

describe("reading the file", () => {
  it("ignores case, accents, spacing and a bare purok number", () => {
    const { db, officer } = setup();
    const r = importCases(db, `${HEADER}\n2026-w46,  PENAFRANCIA ,4,3\n2026-W46,bañag,Purok  2,1`, officer);
    expect(r.success).toBe(true);
    const penafrancia = listBarangays(db).find((b) => b.name === "Peñafrancia")!;
    expect(purokCases(db, penafrancia.id, ["2026-W46"]).find((p) => p.purokName === "Purok 4")!.cases).toBe(3);
  });

  it("accepts tab-separated text with a BOM and Windows line ends, in any column order", () => {
    const { db, officer } = setup();
    const text = "\uFEFFcases\tpurok\tbarangay\tweek\r\n5\tPurok 2\tTagas\t2026-W46\r\n";
    const r = importCases(db, text, officer);
    expect(r.success).toBe(true);
    const tagas = listBarangays(db).find((b) => b.name === "Tagas")!;
    expect(barangayCases(db, tagas.id, "2026-W46")).toBe(5);
  });

  it("numbers rows like a spreadsheet, even with blank lines", () => {
    const { db } = setup();
    const { result } = validateCaseText(db, `${HEADER}\n\n2026-W46,Tagas,Purok 1,x\n`);
    expect(result.rows[0].row).toBe(3);
  });

  it("allows zero cases and quoted names", () => {
    const { db, officer } = setup();
    expect(importCases(db, `${HEADER}\n2026-W46,"Tagas","Purok 1",0`, officer).success).toBe(true);
  });
});

describe("file-level problems", () => {
  it("rejects an empty file, a header-only file and missing columns", () => {
    const { db } = setup();
    expect(validateCaseText(db, "").result.fileErrors[0]).toContain("empty");
    expect(validateCaseText(db, "  \n \n").result.fileErrors[0]).toContain("empty");
    expect(validateCaseText(db, `${HEADER}\n`).result.fileErrors[0]).toContain("no data rows");
    const missing = validateCaseText(db, "week,barangay,cases\n2026-W46,Tagas,1").result;
    expect(missing.success).toBe(false);
    expect(missing.fileErrors[0]).toContain("Missing: purok");
  });

  it("rejects files over 1 MB", () => {
    const { db } = setup();
    const big = `${HEADER}\n` + "2026-W46,Tagas,Purok 1,0\n".repeat(Math.ceil(CASE_FILE_MAX_BYTES / 20));
    const r = validateCaseText(db, big).result;
    expect(r.success).toBe(false);
    expect(r.fileErrors[0]).toContain("1 MB");
  });

  it("rejects weeks that do not exist", () => {
    const { db } = setup();
    const { result } = validateCaseText(db, `${HEADER}\n2026-W60,Tagas,Purok 1,1\n2025-W53,Tagas,Purok 2,1\n2026-46,Tagas,Purok 3,1\n,Tagas,Purok 4,1`);
    const errors = result.rows.map((r) => r.error ?? "");
    expect(errors[0]).toContain("not a valid ISO week");
    expect(errors[1]).toContain("not a valid ISO week");
    expect(errors[2]).toContain("not a valid ISO week");
    expect(errors[3]).toContain("week is missing");
  });

  it("reports every problem in a row at once", () => {
    const { db } = setup();
    const { result } = validateCaseText(db, `${HEADER}\n2026-W46,,,\n`);
    const msg = result.rows[0].error!;
    expect(msg).toContain("barangay is missing");
    expect(msg).toContain("purok is missing");
    expect(msg).toContain("cases is missing");
  });

  it("a rejected file leaves earlier data alone", () => {
    const { db, officer } = setup();
    importCases(db, dataFile("cases_valid.csv"), officer);
    const before = snapshot(db);
    expect(importCases(db, dataFile("cases_with_errors.csv"), officer).success).toBe(false);
    expect(snapshot(db)).toEqual(before);
  });
});

describe("normalizeName", () => {
  it("folds case, accents and spaces", () => {
    expect(normalizeName("  PEÑAFRANCIA ")).toBe("penafrancia");
    expect(normalizeName("Purok   4")).toBe("purok 4");
  });
});
