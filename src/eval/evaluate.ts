// npm run evaluate [-- --quick]
// Runs the evaluation experiments, prints readable tables and writes the results to reports/
// (git-ignored): evaluation.json (what the Demo tools page reads) and CSV files, all from the
// same saved object. Same seeds give the same numbers; only timings differ between runs.

import { QualityOptions, formatQuality, runQuality } from "./quality";
import { EvaluationFile, reportsDir, writeReports } from "./reports";
import { RobustnessOptions, formatRobustness, runRobustness } from "./robustness";
import { SensitivityOptions, formatSensitivity, runSensitivity } from "./sensitivity";

const quick = process.argv.includes("--quick");

// Full: Albay-sized (720 barangays), 30 seeds. Quick: small, for a demonstration in a minute.
const quality: QualityOptions = quick
  ? { barangays: 100, weeks: 16, seeds: [1, 2, 3, 4, 5], ks: [3, 5, 10], randomShuffles: 100 }
  : { barangays: 720, weeks: 30, seeds: Array.from({ length: 30 }, (_, i) => i + 1), ks: [5, 10, 20], randomShuffles: 200 };

// The stress tests use a smaller municipality so the many repeats stay quick.
const stress: RobustnessOptions & SensitivityOptions = quick
  ? { barangays: 100, weeks: 14, seeds: [1, 2, 3], k: 5, randomShuffles: 30 }
  : { barangays: 360, weeks: 24, seeds: Array.from({ length: 10 }, (_, i) => i + 1), k: 10, randomShuffles: 100 };

function main(): void {
  const started = Date.now();
  console.log(`Evaluation (${quick ? "quick" : "full"} mode)\n`);

  const report = runQuality(quality);
  console.log(formatQuality(report));

  console.log("\n" + "-".repeat(100));
  const robustness = runRobustness(stress);
  console.log(formatRobustness(robustness));

  console.log("\n" + "-".repeat(100));
  const sensitivity = runSensitivity(stress);
  console.log(formatSensitivity(sensitivity));

  const file: EvaluationFile = { generatedAt: new Date().toISOString(), mode: quick ? "quick" : "full", node: process.version, quality: report, robustness, sensitivity };
  const dir = reportsDir();
  writeReports(dir, file);

  console.log(`\nWrote ${dir}\\evaluation.json and the CSV files in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main();
