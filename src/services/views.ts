// Builds what the officer dashboard shows: the ranked list and the decision
// view of one barangay. Nothing here changes data.
//
// The dashboard shows the WHOLE-POINT score (score100), and the risk level, the
// action, the trend and the Tier 1 cut are all worked out from it, so the label
// always matches the number on screen. The raw score is included too (the Demo
// tools page shows it).

import { PurokCases, RiskLevel, Trend, recommendedAction, riskLevel, trend } from "../algorithms/risk";
import { toPoints } from "../algorithms/parameters";
import type { Db } from "../db/connection";
import { getBarangay, listBarangays } from "../db/repositories/barangayRepo";
import { latestCaseWeek, purokCases, weekCaseTotal } from "../db/repositories/caseRepo";
import { getActiveParameters } from "../db/repositories/parameterRepo";
import { ScoreRow, latestScores, scoreAtOrBefore } from "../db/repositories/scoreRepo";
import { Bhw, listBhws } from "../db/repositories/userRepo";
import { countActiveTasks, listRecommendations, listTasks } from "../db/repositories/workflowRepo";
import { AppError } from "../errors";
import { addDays, formatDate, isoWeekLabelOf, isoWeekStart, parseIsoWeek, shiftIsoWeek } from "../util/dates";
import { DEFAULT_MUNICIPALITY, weatherFreshness } from "./ingestion/weather";
import type { RankingService } from "./ranking";
import { CaseWeeks, caseWeeksAsOf } from "./scoringInputs";

const MS_DAY = 86_400_000;

export interface FactorView {
  key: "weather" | "household" | "symptom" | "field" | "cases";
  index: number;
  weight: number;
  points: number;
}

const FACTOR_KEYS = ["weather", "household", "symptom", "field", "cases"] as const;

interface StoredRaw {
  subtotal: number;
  densityRatio: number;
  details: Record<string, unknown>;
}

function factorsOf(row: ScoreRow): FactorView[] {
  const stored = row.weightsUsed as Record<string, { index: number; weight: number; points: number }>;
  return FACTOR_KEYS.map((key) => ({ key, index: stored[key].index, weight: stored[key].weight, points: stored[key].points }));
}

export interface TeamView {
  bhwName: string;
  teamLabel: string | null;
}

const teamOf = (bhws: Bhw[]): TeamView | null => (bhws[0] ? { bhwName: bhws[0].displayName, teamLabel: bhws[0].teamLabel } : null);

function groupBhws(db: Db): Map<number, Bhw[]> {
  const map = new Map<number, Bhw[]>();
  for (const b of listBhws(db)) map.set(b.barangayId, [...(map.get(b.barangayId) ?? []), b]);
  return map;
}

/** Confirmed cases per purok over the last two case weeks (the Tier 2 evidence). */
function purokEvidence(db: Db, barangayId: number, weeks: CaseWeeks) {
  const labels = [weeks.thisWeek, weeks.lastWeek].filter((w): w is string => w !== null);
  return purokCases(db, barangayId, labels);
}

export interface RankedBarangay {
  rank: number;
  barangayId: number;
  name: string;
  municipality: string;
  population: number;
  /** Raw score in [0, 1]. The heap ranks by this. */
  score: number;
  /** Whole-point score the officer sees. */
  score100: number;
  riskLevel: RiskLevel;
  action: "tier1" | "monitor";
  tier2: { unlocked: boolean; puroks: PurokCases[] };
  trend: Trend;
  previousScore100: number | null;
  team: TeamView | null;
  /** One of the top k: a barangay the available teams can reach today. */
  isDispatchCandidate: boolean;
  factors: FactorView[];
  computedAt: string;
}

export interface RankingView {
  asOf: string;
  k: number;
  paramsVersion: number;
  summary: {
    barangaysMonitored: number;
    aboveActionThreshold: number;
    activeAssignments: number;
    weeklyConfirmedCases: number;
    caseWeek: string | null;
    weather: { meanTempC: number | null; rainDays: number | null; rainDaysWindow: number | null; stale: boolean; message: string | null };
  };
  barangays: RankedBarangay[];
}

export function buildRankingView(db: Db, ranking: RankingService, kRequested?: number): RankingView {
  const params = getActiveParameters(db);
  const now = ranking.now();
  const today = formatDate(now);
  const weeks = caseWeeksAsOf(db, today);
  const rows = new Map(latestScores(db).map((r) => [r.barangayId, r]));
  const infos = new Map(listBarangays(db).map((b) => [b.id, b]));
  const bhws = groupBhws(db);
  const weekAgo = new Date(now.getTime() - 7 * MS_DAY).toISOString();

  const ordered = ranking.order();
  const k = kRequested ?? params.constants.defaultTeams;

  const barangays: RankedBarangay[] = ordered.map((entry, i) => {
    const id = entry.id as number;
    const row = rows.get(id)!;
    const info = infos.get(id)!;
    const score100 = Math.round(row.score * 100);
    const earlier = scoreAtOrBefore(db, id, weekAgo);
    const previousScore100 = earlier ? Math.round(earlier.score * 100) : null;
    const rec = recommendedAction(
      score100,
      purokEvidence(db, id, weeks).map((p) => ({ purok: p.purokName, cases: p.cases })),
      params,
    );
    return {
      rank: i + 1,
      barangayId: id,
      name: info.name,
      municipality: info.municipality,
      population: info.population,
      score: row.score,
      score100,
      riskLevel: riskLevel(score100, params),
      action: rec.action,
      tier2: rec.tier2,
      trend: trend(score100, previousScore100, params),
      previousScore100,
      team: teamOf(bhws.get(id) ?? []),
      isDispatchCandidate: i < k,
      factors: factorsOf(row),
      computedAt: row.computedAt,
    };
  });

  const weather = firstWeather(rows);
  const freshness = weatherFreshness(db, DEFAULT_MUNICIPALITY, today);
  return {
    asOf: now.toISOString(),
    k,
    paramsVersion: params.version,
    summary: {
      barangaysMonitored: barangays.length,
      aboveActionThreshold: barangays.filter((b) => b.action === "tier1").length,
      activeAssignments: countActiveTasks(db),
      weeklyConfirmedCases: weeks.thisWeek ? weekCaseTotal(db, weeks.thisWeek) : 0,
      caseWeek: weeks.thisWeek,
      weather: { ...weather, stale: freshness.stale, message: freshness.message },
    },
    barangays,
  };
}

/** Weather is municipal, so any barangay's stored summary describes it. */
function firstWeather(rows: Map<number, ScoreRow>) {
  const first = [...rows.values()][0];
  const w = (first?.rawSummary as StoredRaw | undefined)?.details?.weather as
    | { meanTempC: number | null; rainDays: number; rainDaysWindow: number }
    | undefined;
  return { meanTempC: w?.meanTempC ?? null, rainDays: w?.rainDays ?? null, rainDaysWindow: w?.rainDaysWindow ?? null };
}

// ---- decision view -------------------------------------------------------------

export interface DecisionView {
  barangay: { id: number; name: string; municipality: string; population: number; areaKm2: number };
  asOf: string;
  caseWeek: string | null;
  previousCaseWeek: string | null;
  score: {
    score: number;
    score100: number;
    riskLevel: RiskLevel;
    subtotal: number;
    densityRatio: number;
    densityFactor: number;
    paramsVersion: number;
    computedAt: string;
  };
  /** Index, weight and points of each factor, in the order of the "Why this barangay?" table. */
  factors: FactorView[];
  /** The raw data behind each index (temperatures, counts, containers, ...). */
  details: Record<string, unknown>;
  action: "tier1" | "monitor";
  tier1: { available: boolean; threshold: number };
  tier2: { unlocked: boolean; puroks: PurokCases[]; minCases: number; windowDays: number };
  /** Cases per purok over the last two case weeks, all puroks. */
  purokCases: { purokId: number; purok: string; cases: number }[];
  team: TeamView | null;
  openTasks: ReturnType<typeof listTasks>;
  recentDecisions: ReturnType<typeof listRecommendations>;
}

export function buildDecisionView(db: Db, ranking: RankingService, barangayId: number): DecisionView {
  const b = getBarangay(db, barangayId);
  if (!b) throw new AppError(404, "Barangay not found.");
  const row = latestScores(db).find((r) => r.barangayId === barangayId);
  if (!row) throw new AppError(404, "This barangay has no score yet.");

  const params = getActiveParameters(db);
  const now = ranking.now();
  const weeks = caseWeeksAsOf(db, formatDate(now));
  const score100 = Math.round(row.score * 100);
  const evidence = purokEvidence(db, barangayId, weeks);
  const cases: PurokCases[] = evidence.map((p) => ({ purok: p.purokName, cases: p.cases }));
  const rec = recommendedAction(score100, cases, params);
  const raw = row.rawSummary as StoredRaw;
  const bhws = groupBhws(db).get(barangayId) ?? [];

  return {
    barangay: { id: b.id, name: b.name, municipality: b.municipality, population: b.population, areaKm2: b.areaKm2 },
    asOf: now.toISOString(),
    caseWeek: weeks.thisWeek,
    previousCaseWeek: weeks.lastWeek,
    score: {
      score: row.score,
      score100,
      riskLevel: riskLevel(score100, params),
      subtotal: raw.subtotal,
      densityRatio: raw.densityRatio,
      densityFactor: row.densityFactor,
      paramsVersion: row.paramsVersion,
      computedAt: row.computedAt,
    },
    factors: factorsOf(row),
    details: raw.details,
    action: rec.action,
    tier1: { available: rec.action === "tier1", threshold: toPoints(params.constants.tier1Threshold) },
    tier2: {
      unlocked: rec.tier2.unlocked,
      puroks: rec.tier2.puroks,
      minCases: params.constants.tier2.minCases,
      windowDays: params.constants.tier2.windowDays,
    },
    purokCases: evidence.map((p) => ({ purokId: p.purokId, purok: p.purokName, cases: p.cases })),
    team: teamOf(bhws),
    openTasks: listTasks(db).filter((t) => t.barangayId === barangayId && t.status !== "completed"),
    recentDecisions: listRecommendations(db).filter((r) => r.barangayId === barangayId).slice(0, 5),
  };
}

// ---- trends (the two charts on the overview) ----------------------------------

export const TREND_WEEKS = 8;

export interface TrendsView {
  weeks: string[];
  casesPerWeek: number[];
  riskPerWeek: Record<RiskLevel, number>[];
}

/**
 * Eight weeks ending at the newest case week that has started. For each week:
 * the confirmed cases of all barangays, and how many barangays sat at each risk
 * level, read from each barangay's newest score at the end of that week (never
 * later than now). A barangay with no score yet that week is not counted.
 */
export function buildTrendsView(db: Db, ranking: RankingService): TrendsView {
  const params = getActiveParameters(db);
  const now = ranking.now();
  const today = formatDate(now);
  const newest = latestCaseWeek(db, today) ?? isoWeekLabelOf(today);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => shiftIsoWeek(newest, i - (TREND_WEEKS - 1)));
  const ids = listBarangays(db).map((b) => b.id);

  const riskPerWeek = weeks.map((week) => {
    const sunday = addDays(isoWeekStart(parseIsoWeek(week)!), 6);
    const endOfWeek = new Date(`${sunday}T23:59:59.999Z`);
    const at = (endOfWeek < now ? endOfWeek : now).toISOString();
    const counts: Record<RiskLevel, number> = { low: 0, moderate: 0, elevated: 0, high: 0 };
    for (const id of ids) {
      const score = scoreAtOrBefore(db, id, at);
      if (score) counts[riskLevel(Math.round(score.score * 100), params)] += 1;
    }
    return counts;
  });

  return { weeks, casesPerWeek: weeks.map((w) => weekCaseTotal(db, w)), riskPerWeek };
}

