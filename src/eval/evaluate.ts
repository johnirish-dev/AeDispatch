// npm run evaluate [-- --quick]
// Runs the evaluation experiments, prints readable tables and writes the results to reports/
// (git-ignored): evaluation.json (what the Demo tools page reads) and CSV files, all from the
// same saved object. Same seeds give the same numbers; only timings differ between runs.

import { AblationOptions, SmoothingOptions, formatAblation, formatSmoothing, runAblation, runSmoothing } from "./ablation";
import { PerformanceOptions, formatPerformance, runPerformance } from "./performance";
import { QualityOptions, formatQuality, runQuality } from "./quality";
import { EvaluationFile, reportsDir, writeReports } from "./reports";
import { RobustnessOptions, formatRobustness, runRobustness } from "./robustness";
import { SensitivityOptions, formatSensitivity, runSensitivity } from "./sensitivity";
import { TierOptions, formatTiers, runTiers } from "./tiers";

const quick = process.argv.includes("--quick");

// Full: Albay-sized (720 barangays), 30 seeds. Quick: small, for a demonstration in a minute.
const quality: QualityOptions = quick
  ? { barangays: 100, weeks: 16, seeds: [1, 2, 3, 4, 5], ks: [3, 5, 10], randomShuffles: 100 }
  : { barangays: 720, weeks: 30, seeds: Array.from({ length: 30 }, (_, i) => i + 1), ks: [5, 10, 20], randomShuffles: 200 };

// The stress tests use a smaller municipality so the many repeats stay quick.
const stress: RobustnessOptions & SensitivityOptions = quick
  ? { barangays: 100, weeks: 14, seeds: [1, 2, 3], k: 5, randomShuffles: 30 }
  : { barangays: 360, weeks: 24, seeds: Array.from({ length: 10 }, (_, i) => i + 1), k: 10, randomShuffles: 100 };

// Leave-one-source-out (the same size as the quality run) and the smoothing check (the smaller size of the stress tests).
const ablationOptions: AblationOptions = quick
  ? { barangays: 100, weeks: 16, seeds: [1, 2, 3, 4, 5], k: 10 }
  : { barangays: 720, weeks: 30, seeds: Array.from({ length: 30 }, (_, i) => i + 1), k: 10 };
const smoothingOptions: SmoothingOptions = quick
  ? { barangays: 100, weeks: 14, seeds: [1, 2, 3], k: 10, smallShare: 0.2, smallPopulation: 120 }
  : { barangays: 360, weeks: 24, seeds: Array.from({ length: 10 }, (_, i) => i + 1), k: 10, smallShare: 0.2, smallPopulation: 120 };

// Tier 1, the capacity curve and Tier 2: the same municipality size as the quality run.
const tierOptions: TierOptions = quick
  ? { barangays: 100, weeks: 16, seeds: [1, 2, 3, 4, 5], maxK: 20, overCapacityKs: [3, 5, 10, 20], randomShuffles: 30 }
  : { barangays: 720, weeks: 30, seeds: Array.from({ length: 30 }, (_, i) => i + 1), maxK: 20, overCapacityKs: [3, 5, 10, 20], randomShuffles: 100 };

// Heap against re-sort. Full: the sizes of the brief (8 = the demo, 720 = Albay, 42,010 = the Philippines).
// Quick: stops at 5,000 so it stays within a few seconds. The timings are measured, never typed in.
const timingOptions: PerformanceOptions = quick
  ? { sizes: [8, 100, 720, 5000], reps: 100, warmup: 20, scoreReps: 30, scoreRepsLarge: 10, k: 10, seed: 1 }
  : { sizes: [8, 100, 720, 5000, 42010], reps: 200, warmup: 50, scoreReps: 200, scoreRepsLarge: 20, k: 10, seed: 1 };

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

  console.log("\n" + "-".repeat(100));
  const ablation = runAblation(ablationOptions);
  console.log(formatAblation(ablation));

  console.log("\n" + "-".repeat(100));
  const smoothing = runSmoothing(smoothingOptions);
  console.log(formatSmoothing(smoothing));

  console.log("\n" + "-".repeat(100));
  const tiers = runTiers(tierOptions);
  console.log(formatTiers(tiers));

  console.log("\n" + "-".repeat(100));
  const timing = runPerformance(timingOptions, (line) => console.log(line));
  console.log(formatPerformance(timing));

  const file: EvaluationFile = { generatedAt: new Date().toISOString(), mode: quick ? "quick" : "full", node: process.version, quality: report, robustness, sensitivity, ablation, smoothing, tiers, performance: timing };
  const dir = reportsDir();
  writeReports(dir, file);

  console.log(`\nWrote ${dir}\\evaluation.json and the CSV files in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main();
