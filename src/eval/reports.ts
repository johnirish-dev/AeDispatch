// Saving and reading the evaluation results. Everything that is shown or exported (the console
// table, the CSV files, and later the Demo tools page) comes from ONE saved object, so the numbers
// cannot differ between them. The page never recalculates anything: it reads evaluation.json.

import fs from "node:fs";
import path from "node:path";
import { QualityReport, qualityCsv } from "./quality";
import { RobustnessReport, robustnessCsv } from "./robustness";
import { SensitivityReport, sensitivityCsv } from "./sensitivity";

export interface EvaluationFile {
  /** When the run finished (ISO time). */
  generatedAt: string;
  /** "quick" (small, for a live demonstration) or "full" (Albay-sized). */
  mode: "quick" | "full";
  /** Node version, for the record next to any timing. */
  node: string;
  quality: QualityReport;
  /** The damaged-data tests (present once step 4 has run). */
  robustness?: RobustnessReport;
  /** How the early-warning result changes when the simulator's assumptions are weakened. */
  sensitivity?: SensitivityReport;
}

export const EVALUATION_FILE = "evaluation.json";

/** Where the reports go: the REPORTS_DIR variable if set (the tests use it), else ./reports. */
export const reportsDir = (): string => process.env.REPORTS_DIR || path.join(process.cwd(), "reports");

/** Writes evaluation.json and the CSV files, all from the same object. */
export function writeReports(outDir: string, file: EvaluationFile): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, EVALUATION_FILE), JSON.stringify(file, null, 2));
  fs.writeFileSync(path.join(outDir, "quality.csv"), qualityCsv(file.quality));
  if (file.robustness) fs.writeFileSync(path.join(outDir, "robustness.csv"), robustnessCsv(file.robustness));
  if (file.sensitivity) fs.writeFileSync(path.join(outDir, "sensitivity.csv"), sensitivityCsv(file.sensitivity));
}

/** The last saved evaluation, or null when none has been run. */
export function readEvaluation(dir: string = reportsDir()): EvaluationFile | null {
  const file = path.join(dir, EVALUATION_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as EvaluationFile;
}
