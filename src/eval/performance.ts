// Objective 4: how fast is the Max Heap compared with sorting the whole list again, and how does
// that change as the number of barangays grows?
//
// Everything here is MEASURED when the script runs (nothing is typed in). Only the settings are
// fixed: the sizes, the number of repetitions and the seed of the made-up scores. The timings differ
// a little between runs and machines, so the report records the machine next to them.
//
// The two methods answer the same question after scores change: "what are the k highest-ranked
// barangays now?"
//   - heap:    update the changed scores in the real MaxHeap (updateKey), then read the top k.
//   - re-sort: change the scores in a list kept in barangay order, copy it, sort the copy, take k.
// The re-sort starts from an UNSORTED copy on purpose: sorting a list that is already almost in
// order is much faster than sorting a fresh one, which would flatter the baseline.
//
// Timer note: each call is timed with the high-resolution clock (about 0.1 microsecond of overhead),
// so the smallest values (a few tenths of a microsecond) are only approximate.

import os from "node:os";
import { HeapEntry, MaxHeap } from "../algorithms/maxHeap";
import { DEFAULT_PARAMETERS } from "../algorithms/parameters";
import { scoreBarangay } from "../algorithms/scoring";
import { generate } from "../sim/generator";
import { mulberry32 } from "../sim/random";
import { densityRatios, inputsAt, scoreAll, weatherAt } from "./rank";

export interface PerformanceOptions {
  /** Numbers of barangays to test (8 = the demo, 720 = Albay, 42,010 = the Philippines). */
  sizes: number[];
  /** Timed repetitions of the cheap measurements, after `warmup` untimed ones. */
  reps: number;
  warmup: number;
  /** Timed repetitions of the scoring measurements (they are much slower): up to 720 barangays, and above. */
  scoreReps: number;
  scoreRepsLarge: number;
  /** The ranking is judged on its top k. */
  k: number;
  /** Seed of the made-up scores and of the simulated data used for scoring. */
  seed: number;
}

/** Microseconds. `reps` is the number of timed repetitions behind the two figures. */
export interface Timing {
  median: number;
  p95: number;
  reps: number;
}

export interface PerformanceRow {
  n: number;
  /** How many scores change in the batch measurement: 1 percent of n, at least 1. */
  batchSize: number;
  /** One updateKey. */
  heapUpdate: Timing;
  /** One changed score, then the top k: with the heap, and by sorting everything again. */
  heapRefresh: Timing;
  resortRefresh: Timing;
  /** `batchSize` changed scores, then the top k: with the heap, and by sorting everything again. */
  heapBatchRefresh: Timing;
  resortBatchRefresh: Timing;
  /** Making the ranking from scratch for n entries: heap build, and sorting. */
  heapBuild: Timing;
  resortBuild: Timing;
  /** One barangay scored with the real scoring code, then updateKey (the "50 ms" requirement). */
  scoreAndUpdate: Timing;
  /** Scoring all n barangays and building the heap (the "2 s" requirement). */
  rescoreAll: Timing;
  /** The heap and the re-sort gave the same top k after the same changes (checked before timing). */
  rankingsAgree: boolean;
}

export interface Machine {
  cpu: string;
  cores: number;
  memoryGb: number;
  node: string;
  platform: string;
}

export interface Requirement {
  name: string;
  n: number;
  /** The limit and the measured figure, in milliseconds. */
  limitMs: number;
  measuredMs: number;
  passed: boolean;
}

export interface PerformanceReport {
  options: PerformanceOptions;
  machine: Machine;
  rows: PerformanceRow[];
  /** Slope of log(time) against log(n), from the sizes of 100 or more. Near 0: barely grows. Near 1: grows with n. */
  slopes: { heapRefresh: number | null; resortRefresh: number | null; heapUpdate: number | null };
  requirements: Requirement[];
}

// ---- the comparison ------------------------------------------------------------------------

/** Higher score first; equal scores go to the smaller id (the same rule as the heap). */
const byRank = (a: HeapEntry, b: HeapEntry): number => (a.score !== b.score ? b.score - a.score : (a.id as number) - (b.id as number));

let sink = 0; // used so the engine cannot throw away work whose result is never read
const consume = (x: number): void => {
  sink = (sink + x) % 1_000_003;
};
export const timingSink = (): number => sink;

function resortTop(store: HeapEntry[], k: number): HeapEntry[] {
  return store.slice().sort(byRank).slice(0, k);
}

// ---- timing ---------------------------------------------------------------------------------

function percentile(sorted: Float64Array, p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

// The engine optimises code only after it has run for a while. Warming up for a fixed handful of
// repetitions would leave the first (smallest) size measuring unoptimised code and make it look
// slower than the larger ones. So the warm-up runs at least `warmup` repetitions AND for at least
// this long (in milliseconds), up to a limit on repetitions.
const WARMUP_MIN_MS = 60;
const WARMUP_MAX_REPS = 20_000;

/**
 * Runs `run(i)` untimed to warm up, then `reps` timed repetitions (i = 0 .. reps - 1); times are in
 * microseconds. `pool` is how many different pre-chosen changes `run` can be given (warm-up repeats them).
 */
function measure(reps: number, warmup: number, run: (i: number) => void, pool: number): Timing {
  const warmStart = process.hrtime.bigint();
  for (let i = 0; i < WARMUP_MAX_REPS; i++) {
    if (i >= warmup && Number(process.hrtime.bigint() - warmStart) / 1e6 >= WARMUP_MIN_MS) break;
    run(i % pool);
  }
  const samples = new Float64Array(reps);
  for (let i = 0; i < reps; i++) {
    const start = process.hrtime.bigint();
    run(i);
    samples[i] = Number(process.hrtime.bigint() - start) / 1000;
  }
  samples.sort();
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95), reps };
}

/** Least-squares slope of log10(time) against log10(n). Null when fewer than two usable points. */
export function logLogSlope(points: { n: number; time: number }[]): number | null {
  const usable = points.filter((p) => p.n > 0 && p.time > 0);
  if (usable.length < 2) return null;
  const xs = usable.map((p) => Math.log10(p.n));
  const ys = usable.map((p) => Math.log10(p.time));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

// ---- one size -------------------------------------------------------------------------------

/** The same changes applied to a heap and to a re-sorted list must give the same top k, or the comparison means nothing. */
function rankingsAgree(base: HeapEntry[], k: number, changes: { id: number; score: number }[]): boolean {
  const heap = new MaxHeap();
  heap.build(base);
  const store = base.map((e) => ({ ...e }));
  for (const c of changes) {
    heap.updateKey(c.id, c.score);
    store[c.id].score = c.score;
  }
  const fromHeap = heap.topK(k);
  const fromSort = resortTop(store, k);
  return heap.isValid() && fromHeap.length === fromSort.length && fromHeap.every((e, i) => e.id === fromSort[i].id && e.score === fromSort[i].score);
}

function measureSize(n: number, o: PerformanceOptions): PerformanceRow {
  const rng = mulberry32(o.seed + n);
  const k = Math.min(o.k, n);
  const batchSize = Math.max(1, Math.ceil(n * 0.01));
  const total = o.reps + o.warmup; // how many different changes are prepared

  const base: HeapEntry[] = Array.from({ length: n }, (_, id) => ({ id, score: rng() }));
  const pickIds = (count: number): Int32Array => Int32Array.from({ length: count }, () => Math.floor(rng() * n));
  const pickScores = (count: number): Float64Array => Float64Array.from({ length: count }, () => rng());

  // Checked once before timing: both methods must agree on the answer.
  const checkChanges = Array.from({ length: batchSize }, () => ({ id: Math.floor(rng() * n), score: rng() }));
  const agree = rankingsAgree(base, k, checkChanges);
  if (!agree) throw new Error(`The heap and the re-sort disagree at n = ${n}: the comparison would be meaningless.`);

  // Changes are chosen BEFORE the clock starts, so the random numbers are not part of the timings.
  const idsOne = pickIds(total);
  const scoresOne = pickScores(total);
  const idsBatch = pickIds(total * batchSize);
  const scoresBatch = pickScores(total * batchSize);

  // One updateKey, and one change followed by the top k.
  const heapA = new MaxHeap();
  heapA.build(base);
  const heapUpdate = measure(o.reps, o.warmup, (i) => heapA.updateKey(idsOne[i], scoresOne[i]), total);

  const heapB = new MaxHeap();
  heapB.build(base);
  const heapRefresh = measure(o.reps, o.warmup, (i) => {
    heapB.updateKey(idsOne[i], scoresOne[i]);
    consume(heapB.topK(k)[0].id as number);
  }, total);

  const storeA = base.map((e) => ({ ...e }));
  const resortRefresh = measure(o.reps, o.warmup, (i) => {
    storeA[idsOne[i]].score = scoresOne[i];
    consume(resortTop(storeA, k)[0].id as number);
  }, total);

  // A batch of changes (1 percent of n) followed by the top k.
  const heapC = new MaxHeap();
  heapC.build(base);
  const heapBatchRefresh = measure(o.reps, o.warmup, (i) => {
    for (let j = 0; j < batchSize; j++) heapC.updateKey(idsBatch[i * batchSize + j], scoresBatch[i * batchSize + j]);
    consume(heapC.topK(k)[0].id as number);
  }, total);

  const storeB = base.map((e) => ({ ...e }));
  const resortBatchRefresh = measure(o.reps, o.warmup, (i) => {
    for (let j = 0; j < batchSize; j++) storeB[idsBatch[i * batchSize + j]].score = scoresBatch[i * batchSize + j];
    consume(resortTop(storeB, k)[0].id as number);
  }, total);

  // Making the whole ranking from scratch.
  const heapBuild = measure(o.reps, o.warmup, () => {
    const h = new MaxHeap();
    h.build(base);
    consume(h.size);
  }, total);
  const resortBuild = measure(o.reps, o.warmup, () => {
    consume(base.slice().sort(byRank)[0].id as number);
  }, total);

  // Scoring with the real scoring code on simulated data of this size.
  const d = generate({ barangays: n, weeks: 12, seed: o.seed });
  const t = 8; // a week with full data windows
  const ratios = densityRatios(d);
  const weather = weatherAt(d, t);
  const first = scoreAll(d, t, ratios);
  const scoreHeap = new MaxHeap();
  scoreHeap.build(Array.from(first, (score, id) => ({ id, score })));
  const scoreIds = pickIds(total);
  const heavyReps = n <= 720 ? o.scoreReps : o.scoreRepsLarge;
  const heavyWarmup = Math.min(o.warmup, 10);

  const scoreAndUpdate = measure(heavyReps, heavyWarmup, (i) => {
    const b = scoreIds[i];
    const result = scoreBarangay(inputsAt(d, b, t, ratios[b], weather, 1), DEFAULT_PARAMETERS);
    scoreHeap.updateKey(b, result.score);
  }, total);
  const rescoreAll = measure(heavyReps, heavyWarmup, () => {
    const scores = scoreAll(d, t, ratios);
    const heap = new MaxHeap();
    heap.build(Array.from(scores, (score, id) => ({ id, score })));
    consume(heap.size);
  }, total);

  return { n, batchSize, heapUpdate, heapRefresh, resortRefresh, heapBatchRefresh, resortBatchRefresh, heapBuild, resortBuild, scoreAndUpdate, rescoreAll, rankingsAgree: agree };
}

// ---- the report -----------------------------------------------------------------------------

export function describeMachine(): Machine {
  const cpus = os.cpus();
  return {
    cpu: cpus.length > 0 ? cpus[0].model.trim() : "unknown",
    cores: cpus.length,
    memoryGb: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    node: process.version,
    platform: `${process.platform} ${os.release()}`,
  };
}

export function runPerformance(options: PerformanceOptions, progress: (line: string) => void = () => {}): PerformanceReport {
  const rows: PerformanceRow[] = [];
  for (const n of options.sizes) {
    progress(`  timing n = ${n} ...`);
    rows.push(measureSize(n, options));
  }

  const large = rows.filter((r) => r.n >= 100);
  const slopeOf = (pick: (r: PerformanceRow) => number) => logLogSlope(large.map((r) => ({ n: r.n, time: pick(r) })));

  // The requirements of the paper (NFR-3): one score update 50 ms or less, a full re-score 2 s or less.
  const requirements: Requirement[] = [];
  for (const r of rows.filter((x) => x.n >= 720)) {
    requirements.push({ name: "One score update (score and updateKey, slowest 5%)", n: r.n, limitMs: 50, measuredMs: r.scoreAndUpdate.p95 / 1000, passed: r.scoreAndUpdate.p95 / 1000 <= 50 });
    requirements.push({ name: "Re-scoring all barangays (median)", n: r.n, limitMs: 2000, measuredMs: r.rescoreAll.median / 1000, passed: r.rescoreAll.median / 1000 <= 2000 });
  }

  return {
    options,
    machine: describeMachine(),
    rows,
    slopes: {
      heapRefresh: slopeOf((r) => r.heapRefresh.median),
      resortRefresh: slopeOf((r) => r.resortRefresh.median),
      heapUpdate: slopeOf((r) => r.heapUpdate.median),
    },
    requirements,
  };
}

// ---- console table and CSV ------------------------------------------------------------------

const us = (x: number): string => (x < 10 ? x.toFixed(2) : x < 1000 ? x.toFixed(1) : x.toFixed(0));
const duration = (micro: number): string => (micro >= 1000 ? `${(micro / 1000).toFixed(micro >= 100_000 ? 0 : 1)} ms` : `${us(micro)} µs`);
const pair = (t: Timing): string => `${duration(t.median)} / ${duration(t.p95)}`;

export function formatPerformance(report: PerformanceReport): string {
  const lines: string[] = [];
  const m = report.machine;
  lines.push("Heap against re-sort (median / slowest 5% of the timed repetitions)");
  lines.push(`Machine: ${m.cpu}, ${m.cores} cores, ${m.memoryGb} GB, Node ${m.node}, ${m.platform}`);
  lines.push(`Both methods end with the top ${report.options.k}. The re-sort sorts a fresh copy of an unsorted list each time.\n`);

  const header = ["n", "heap: 1 change", "re-sort: 1 change", "faster by", "heap: batch", "re-sort: batch", "build / sort", "score+update", "re-score all"];
  const body = report.rows.map((r) => [
    String(r.n),
    pair(r.heapRefresh),
    pair(r.resortRefresh),
    `${(r.resortRefresh.median / r.heapRefresh.median).toFixed(1)}x`,
    `${pair(r.heapBatchRefresh)} (${r.batchSize})`,
    pair(r.resortBatchRefresh),
    `${duration(r.heapBuild.median)} / ${duration(r.resortBuild.median)}`,
    pair(r.scoreAndUpdate),
    pair(r.rescoreAll),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  lines.push(line(header));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of body) lines.push(line(row));

  const slope = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
  lines.push(`\nGrowth with n (slope of log time against log n, sizes from 100 up; 0 = barely grows, 1 = grows with n):`);
  lines.push(`  heap update ${slope(report.slopes.heapUpdate)}   heap change + top k ${slope(report.slopes.heapRefresh)}   re-sort ${slope(report.slopes.resortRefresh)}`);

  if (report.requirements.length > 0) {
    lines.push("\nRequirements of the paper:");
    for (const r of report.requirements) {
      lines.push(`  ${r.passed ? "met   " : "NOT MET"}  n = ${r.n}: ${r.name}: ${r.measuredMs.toFixed(2)} ms (limit ${r.limitMs} ms)`);
    }
  }
  return lines.join("\n");
}

const MEASURES: [string, (r: PerformanceRow) => Timing][] = [
  ["heap_update", (r) => r.heapUpdate],
  ["heap_change_and_top_k", (r) => r.heapRefresh],
  ["resort_change_and_top_k", (r) => r.resortRefresh],
  ["heap_batch_and_top_k", (r) => r.heapBatchRefresh],
  ["resort_batch_and_top_k", (r) => r.resortBatchRefresh],
  ["heap_build", (r) => r.heapBuild],
  ["resort_from_scratch", (r) => r.resortBuild],
  ["score_one_and_update", (r) => r.scoreAndUpdate],
  ["rescore_all", (r) => r.rescoreAll],
];

/** One row per size and measure. Times are in microseconds. */
export function performanceCsv(report: PerformanceReport): string {
  const out = ["n,measure,median_us,p95_us,reps,batch_size"];
  for (const r of report.rows) {
    for (const [name, pick] of MEASURES) {
      const t = pick(r);
      out.push([r.n, name, t.median, t.p95, t.reps, name.includes("batch") ? r.batchSize : ""].join(","));
    }
  }
  return out.join("\n") + "\n";
}
