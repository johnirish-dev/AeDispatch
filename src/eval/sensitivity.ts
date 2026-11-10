// Where does the early-warning advantage stop? The simulator makes the household, symptom and
// field signals rise a few weeks before the cases jump. That is an assumption, not a fact about
// Albay. Here it is weakened, one thing at a time:
//   - leadWeeks         : how many weeks before the jump the signals start to rise (4, 3, 2, 1, 0);
//   - caseDelayWeeks    : how late the hospital's weekly case data arrive (0, 1, 2);
//   - outbreakFraction  : how many barangays have an outbreak (5%, 15%, 30%).
// At leadWeeks = 0 there is no early warning to find, so AeDispatch should NOT clearly beat the
// case-count ranking on new outbreaks. If it does, something is leaking future data.

import { Interval, Verdict } from "../algorithms/metrics";
import { Method, Metric, QualityOptions, runQuality } from "./quality";

export type Variable = "leadWeeks" | "caseDelayWeeks" | "outbreakFraction";

export interface SensitivityOptions {
  barangays: number;
  weeks: number;
  seeds: number[];
  k: number;
  randomShuffles: number;
}

const KEPT: Metric[] = ["ndcg", "emergingNdcg", "rateNdcg", "coverage", "lead"];

/**
 * `parameter` is what is passed to the simulator; `shown` is what the tables call it. For the lead
 * the simulator's ramp is 0 in the first week it nominally starts, so a lead parameter L raises the
 * early signals from L - 1 weeks before the jump: the default (3) means about 2 visible weeks, and
 * parameters 1 and 0 both mean no early warning at all.
 */
const VALUES: Record<Variable, { parameter: number; shown: number }[]> = {
  leadWeeks: [5, 4, 3, 2, 1].map((p) => ({ parameter: p, shown: p - 1 })),
  caseDelayWeeks: [0, 1, 2].map((v) => ({ parameter: v, shown: v })),
  outbreakFraction: [0.05, 0.15, 0.3].map((v) => ({ parameter: v, shown: v })),
};

export interface SensitivityRow {
  variable: Variable;
  value: number;
  method: Method;
  metric: Metric;
  interval: Interval;
}

export interface SensitivityPaired {
  variable: Variable;
  value: number;
  baseline: Method;
  metric: "ndcg" | "emergingNdcg";
  difference: Interval;
  verdict: Verdict;
}

export interface SensitivityReport {
  settings: { barangays: number; weeks: number; seeds: number; k: number; randomShuffles: number };
  rows: SensitivityRow[];
  paired: SensitivityPaired[];
}

export function runSensitivity(o: SensitivityOptions): SensitivityReport {
  const base: QualityOptions = { barangays: o.barangays, weeks: o.weeks, seeds: o.seeds, ks: [o.k], randomShuffles: o.randomShuffles };
  const rows: SensitivityRow[] = [];
  const paired: SensitivityPaired[] = [];
  for (const variable of Object.keys(VALUES) as Variable[]) {
    for (const { parameter, shown: value } of VALUES[variable]) {
      const report = runQuality({ ...base, [variable]: parameter });
      for (const r of report.rows) if (KEPT.includes(r.metric)) rows.push({ variable, value, method: r.method, metric: r.metric, interval: r.value });
      for (const p of report.paired) {
        if (p.baseline === "case-count-only" && (p.metric === "ndcg" || p.metric === "emergingNdcg")) {
          paired.push({ variable, value, baseline: p.baseline, metric: p.metric, difference: p.difference, verdict: p.verdict });
        }
      }
    }
  }
  return { settings: { barangays: o.barangays, weeks: o.weeks, seeds: o.seeds.length, k: o.k, randomShuffles: o.randomShuffles }, rows, paired };
}

const f = (x: number | null | undefined, digits = 3): string => (x !== null && x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "n/a");

const TITLE: Record<Variable, string> = {
  leadWeeks: "Weeks before the cases jump in which the early signals are already raised (the simulator's default is 2; 0 = no early warning)",
  caseDelayWeeks: "How late the weekly case data arrive (weeks)",
  outbreakFraction: "Share of barangays that have an outbreak",
};

export function formatSensitivity(r: SensitivityReport): string {
  const s = r.settings;
  const lines: string[] = [];
  lines.push(`Sensitivity of the early-warning result: ${s.barangays} barangays, ${s.weeks} weeks, ${s.seeds} seeds, k = ${s.k}.`);
  lines.push("New-outbreak NDCG: AeDispatch vs case-count-only (difference with 95% interval and verdict), and the same for all-cases NDCG.");
  const mean = (variable: Variable, value: number, method: Method, metric: Metric) => r.rows.find((x) => x.variable === variable && x.value === value && x.method === method && x.metric === metric)?.interval.mean;
  for (const variable of Object.keys(VALUES) as Variable[]) {
    lines.push("");
    lines.push(TITLE[variable]);
    for (const { shown: value } of VALUES[variable]) {
      const pn = r.paired.find((p) => p.variable === variable && p.value === value && p.metric === "emergingNdcg")!;
      const pa = r.paired.find((p) => p.variable === variable && p.value === value && p.metric === "ndcg")!;
      lines.push(
        `  ${String(value).padEnd(5)} new: AeDispatch ${f(mean(variable, value, "AeDispatch", "emergingNdcg"))} vs case-count ${f(mean(variable, value, "case-count-only", "emergingNdcg"))}  diff ${f(pn.difference.mean)} [${f(pn.difference.low)}, ${f(pn.difference.high)}] ${pn.verdict.padEnd(6)} | all: ${f(mean(variable, value, "AeDispatch", "ndcg"))} vs ${f(mean(variable, value, "case-count-only", "ndcg"))}  diff ${f(pa.difference.mean)} ${pa.verdict} | coverage ${f(mean(variable, value, "AeDispatch", "coverage"), 2)} vs ${f(mean(variable, value, "case-count-only", "coverage"), 2)}`,
      );
    }
  }
  return lines.join("\n");
}

export function sensitivityCsv(r: SensitivityReport): string {
  const out = ["kind,variable,value,method,k,metric,mean,low,high,verdict"];
  for (const x of r.rows) out.push(["value", x.variable, x.value, x.method, r.settings.k, x.metric, x.interval.mean, x.interval.low, x.interval.high, ""].join(","));
  for (const x of r.paired) out.push(["paired_difference", x.variable, x.value, `AeDispatch-minus-${x.baseline}`, r.settings.k, x.metric, x.difference.mean, x.difference.low, x.difference.high, x.verdict].join(","));
  return out.join("\n") + "\n";
}
