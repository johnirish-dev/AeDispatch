// The ranking service: keeps every barangay's threat score in our Max Heap and
// the database in step. `rescore` is the only way a score changes.
//
// The heap lives in memory and is rebuilt from the latest stored scores when
// the server starts, so a restart gives the same ranking.

import { shouldIssueAlert } from "../algorithms/alerts";
import { HeapEntry, MaxHeap } from "../algorithms/maxHeap";
import { riskLevel } from "../algorithms/risk";
import { scoreBarangay, ThreatScoreResult } from "../algorithms/scoring";
import type { Db } from "../db/connection";
import { densityRatios, listBarangays } from "../db/repositories/barangayRepo";
import { getActiveParameters } from "../db/repositories/parameterRepo";
import { insertScore, latestScoreFor, latestScores } from "../db/repositories/scoreRepo";
import { alertTimesSince, insertAlert } from "../db/repositories/workflowRepo";
import { alertMessage } from "../strings";
import { addDays, formatDate } from "../util/dates";
import { CaseWeeks, caseWeeksAsOf, loadInputs } from "./scoringInputs";

const MS_DAY = 86_400_000;

export interface RankingOptions {
  /** The current time. Tests pass a fixed clock. */
  clock?: () => Date;
  /** Where the "rescore took N ms" lines go. */
  logger?: (line: string) => void;
}

export interface RescoreOptions {
  /** Why we are re-scoring; it goes into the log line. */
  reason: string;
  /** Score as of this moment. Default: the clock. */
  asOf?: Date;
  /** Timestamp stored on the new rows. Default: `asOf` as a full ISO time. */
  computedAt?: string;
  /** Issue resident alerts for upward crossings. Default true. */
  alerts?: boolean;
  /** Skip the per-rescore log line (used by the history backfill). */
  quiet?: boolean;
}

export interface RescoreSummary {
  count: number;
  ms: number;
  alertsIssued: number;
  results: { barangayId: number; score: number; score100: number }[];
}

export class RankingService {
  private readonly heap = new MaxHeap();
  private readonly clock: () => Date;
  private readonly log: (line: string) => void;

  constructor(
    private readonly db: Db,
    opts: RankingOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.log = opts.logger ?? ((line) => console.log(line));
  }

  /** The current time according to this service's clock. */
  now(): Date {
    return this.clock();
  }

  /**
   * Rebuilds the heap from the stored scores. If a barangay has no score, or any
   * stored score is from an earlier day (the data was seeded or last used days
   * ago), every barangay is re-scored once so the list is as of today. No
   * alerts are issued for that catch-up. A restart on the same day re-scores
   * nothing and gives the same ranking.
   */
  start(): void {
    const stored = latestScores(this.db);
    this.heap.build(stored.map((r) => ({ id: r.barangayId, score: r.score })));

    const today = formatDate(this.clock());
    const have = new Set(stored.map((r) => r.barangayId));
    const missing = listBarangays(this.db).some((b) => !have.has(b.id));
    // computedAt is an ISO timestamp, so its first 10 characters are its UTC date.
    const oldest = stored.map((r) => r.computedAt.slice(0, 10)).sort()[0];

    if (missing) this.rescoreAll({ reason: "startup, no stored score", alerts: false });
    else if (oldest !== undefined && oldest < today) {
      this.rescoreAll({ reason: `startup, scores from ${oldest} brought up to ${today}`, alerts: false });
    }
    this.log(`[ranking] heap ready with ${this.heap.size} barangays`);
  }

  /** Every barangay, highest score first. Does not change the heap. */
  order(): HeapEntry[] {
    return this.heap.topK(this.heap.size);
  }

  get size(): number {
    return this.heap.size;
  }

  /** True if the heap order and its position map are consistent (used by tests). */
  isHeapValid(): boolean {
    return this.heap.isValid();
  }

  /**
   * Writes one score per barangay for every day from `fromDate` to `toDate`
   * (YYYY-MM-DD), each calculated from the data known on that day. This gives
   * the trend arrows and the 8-week charts a history. Rows are stamped at the
   * start of their UTC day, so a live rescore later the same day always sorts
   * after them. No alerts are issued for past days.
   */
  backfillHistory(fromDate: string, toDate: string): void {
    const started = performance.now();
    let days = 0;
    for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
      const at = `${day}T00:00:00.000Z`;
      this.rescoreAll({ reason: "history", asOf: new Date(at), computedAt: at, alerts: false, quiet: true });
      days++;
    }
    this.log(`[ranking] history backfilled: ${days} days in ${(performance.now() - started).toFixed(0)} ms`);
  }

  removeBarangay(id: number): void {
    this.heap.remove(id);
  }

  rescoreAll(opts: RescoreOptions): RescoreSummary {
    return this.rescore(
      listBarangays(this.db).map((b) => b.id),
      opts,
    );
  }

  /**
   * Computes new scores for these barangays with the active parameters, stores
   * them with their full breakdown, moves them in the heap, and issues alerts.
   */
  rescore(barangayIds: number[], opts: RescoreOptions): RescoreSummary {
    const started = performance.now();
    const params = getActiveParameters(this.db);
    const now = opts.asOf ?? this.clock();
    const today = formatDate(now);
    const computedAt = opts.computedAt ?? now.toISOString();
    const wantAlerts = opts.alerts ?? true;

    const wanted = new Set(barangayIds);
    const ratios = densityRatios(this.db);
    const weeks = caseWeeksAsOf(this.db, today);
    const barangays = listBarangays(this.db).filter((b) => wanted.has(b.id));

    // Compute first, then write everything in one transaction.
    const computed = barangays.map((b) => ({
      b,
      result: scoreBarangay(loadInputs(this.db, b, ratios.get(b.id) ?? 0, today, weeks, params), params),
    }));

    let alertsIssued = 0;
    this.db.transaction(() => {
      for (const { b, result } of computed) {
        // The alert rule needs the score from BEFORE this one.
        const previous = wantAlerts ? latestScoreFor(this.db, b.id) : undefined;
        this.storeScore(b.id, result, computedAt, today, weeks, riskLevel(result.score100, params));

        if (!wantAlerts) continue;
        const windowStart = new Date(now.getTime() - params.constants.alertWindowDays * MS_DAY).toISOString();
        const decision = shouldIssueAlert(
          {
            previousScore100: previous ? Math.round(previous.score * 100) : null,
            currentScore100: result.score100,
            recentAlertTimes: alertTimesSince(this.db, b.id, windowStart),
            now,
          },
          params,
        );
        if (decision.issue && decision.level) {
          const w = result.details.weather;
          insertAlert(this.db, {
            barangayId: b.id,
            level: decision.level,
            message: alertMessage(decision.level, {
              meanTempC: w.meanTempC,
              rainDays: w.rainDays,
              rainDaysWindow: w.rainDaysWindow,
            }),
            issuedAt: now.toISOString(),
          });
          alertsIssued++;
        }
      }
    })();

    // The heap changes only after the database commit succeeded.
    for (const { b, result } of computed) this.heap.updateKey(b.id, result.score);

    const ms = performance.now() - started;
    if (!opts.quiet) this.log(`[rescore] ${computed.length} barangays in ${ms.toFixed(1)} ms (${opts.reason})`);
    return {
      count: computed.length,
      ms,
      alertsIssued,
      results: computed.map(({ b, result }) => ({
        barangayId: b.id,
        score: result.score,
        score100: result.score100,
      })),
    };
  }

  private storeScore(
    barangayId: number,
    r: ThreatScoreResult,
    computedAt: string,
    today: string,
    weeks: CaseWeeks,
    level: string,
  ): void {
    insertScore(this.db, {
      barangayId,
      computedAt,
      score: r.score,
      w: r.factors.weather.index,
      c: r.factors.household.index,
      s: r.factors.symptom.index,
      f: r.factors.field.index,
      h: r.factors.cases.index,
      // The weight, index and points of every factor, as shown on the decision screen.
      weightsUsed: r.factors,
      densityFactor: r.densityFactor,
      // The raw numbers behind each index, plus what the score was calculated for.
      rawSummary: {
        asOf: today,
        caseWeek: weeks.thisWeek,
        previousCaseWeek: weeks.lastWeek,
        subtotal: r.subtotal,
        densityRatio: r.densityRatio,
        score100: r.score100,
        riskLevel: level,
        details: r.details,
      },
      paramsVersion: r.paramsVersion,
    });
  }
}
