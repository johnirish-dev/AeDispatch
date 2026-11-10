// Objective 3: how well does the ranking hold up when the reports are sparse, missing or noisy?
// The quality experiment is repeated with each kind of damage at a few levels (see degrade.ts).
// The rankings only see the damaged data; they are judged by what really happened.
// A method that "holds up" loses little between level 0 (clean) and the higher levels.

import { Interval } from "../algorithms/metrics";
import { DEGRADATIONS } from "./degrade";
import { METHODS, Method, Metric, QualityOptions, runQuality } from "./quality";

export interface RobustnessOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  /** The k the numbers are read at. */
  k: number;
  randomShuffles: number;
}

const KEPT: Metric[] = ["ndcg", "emergingNdcg", "rateNdcg", "coverage"];

export interface RobustnessRow {
  scenario: string;
  label: string;
  level: number;
  method: Method;
  metric: Metric;
  value: Interval;
}

export interface RobustnessReport {
  settings: { barangays: number; weeks: number; seeds: number; k: number; randomShuffles: number };
  /** What a level means for each scenario. */
  meaning: Record<string, string>;
  rows: RobustnessRow[];
}

export function runRobustness(o: RobustnessOptions): RobustnessReport {
  const base: QualityOptions = { barangays: o.barangays, weeks: o.weeks, seeds: o.seeds, ks: [o.k], randomShuffles: o.randomShuffles };
  const rows: RobustnessRow[] = [];
  const collect = (scenario: string, label: string, level: number, opts: QualityOptions) => {
    const report = runQuality(opts);
    for (const r of report.rows) if (KEPT.includes(r.metric)) rows.push({ scenario, label, level, method: r.method, metric: r.metric, value: r.value });
  };

  collect("clean", "No damage", 0, base);
  const meaning: Record<string, string> = { clean: "no damage" };
  for (const deg of DEGRADATIONS) {
    meaning[deg.name] = deg.levelMeaning;
    for (const level of deg.levels) collect(deg.name, deg.label, level, { ...base, degrade: (truth, rng) => deg.apply(truth, level, rng) });
  }
  return { settings: { barangays: o.barangays, weeks: o.weeks, seeds: o.seeds.length, k: o.k, randomShuffles: o.randomShuffles }, meaning, rows };
}

const f = (x: number | null | undefined, digits = 3): string => (x !== null && x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "n/a");

/** One small table per kind of damage. */
export function formatRobustness(r: RobustnessReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Robustness: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, k = ${s.k}. The rankings see damaged data; they are judged by what really happened.`);
  lines.push("New-outbreak NDCG (early warning) | all-cases NDCG, mean over seeds. 'clean' is the undamaged reference.");
  const get = (scenario: string, level: number, method: Method, metric: Metric) => r.rows.find((x) => x.scenario === scenario && x.level === level && x.method === method && x.metric === metric)?.value.mean;
  const clean = (method: Method, metric: Metric) => get("clean", 0, method, metric);

  const scenarios = [...new Set(r.rows.map((x) => x.scenario))].filter((x) => x !== "clean");
  lines.push("");
  lines.push(`clean            new: AeDispatch ${f(clean("AeDispatch", "emergingNdcg"))}  case-count ${f(clean("case-count-only", "emergingNdcg"))}  weather ${f(clean("weather-only", "emergingNdcg"))}  random ${f(clean("random", "emergingNdcg"))}   |  all: AeDispatch ${f(clean("AeDispatch", "ndcg"))}  case-count ${f(clean("case-count-only", "ndcg"))}`);
  for (const sc of scenarios) {
    const label = r.rows.find((x) => x.scenario === sc)!.label;
    lines.push("");
    lines.push(`${label}  (level = ${r.meaning[sc]})`);
    const levels = [...new Set(r.rows.filter((x) => x.scenario === sc).map((x) => x.level))];
    for (const level of levels) {
      lines.push(
        `  level ${String(level).padEnd(5)} new: AeDispatch ${f(get(sc, level, "AeDispatch", "emergingNdcg"))}  case-count ${f(get(sc, level, "case-count-only", "emergingNdcg"))}  weather ${f(get(sc, level, "weather-only", "emergingNdcg"))}  random ${f(get(sc, level, "random", "emergingNdcg"))}   |  all: AeDispatch ${f(get(sc, level, "AeDispatch", "ndcg"))}  case-count ${f(get(sc, level, "case-count-only", "ndcg"))}`,
      );
    }
  }
  lines.push("");
  lines.push(`Coverage (share of outbreaks recommended in the 4 weeks before their jump), AeDispatch: clean ${f(clean("AeDispatch", "coverage"), 2)}; case-count-only: clean ${f(clean("case-count-only", "coverage"), 2)}.`);
  return lines.join("\n");
}

export function robustnessCsv(r: RobustnessReport): string {
  const out = ["scenario,level,method,k,metric,mean,low,high"];
  for (const x of r.rows) out.push([x.scenario, x.level, x.method, r.settings.k, x.metric, x.value.mean, x.value.low, x.value.high].join(","));
  return out.join("\n") + "\n";
}

export { METHODS };
