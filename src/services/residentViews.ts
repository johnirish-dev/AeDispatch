// What the resident screens may see: the barangays, and for one barangay its risk LEVEL and its
// alerts. Never a score, a case count or a purok: residents learn only how worried to be.

import { riskLevel, type RiskLevel } from "../algorithms/risk";
import type { Db } from "../db/connection";
import { getBarangay, listBarangays } from "../db/repositories/barangayRepo";
import { getWeatherSeries } from "../db/repositories/signalRepo";
import { addDays } from "../util/dates";
import { getActiveParameters } from "../db/repositories/parameterRepo";
import { latestScoreFor } from "../db/repositories/scoreRepo";
import { listAlerts } from "../db/repositories/workflowRepo";
import { AppError } from "../errors";

export interface ResidentBarangay {
  id: number;
  name: string;
  municipality: string;
}

/**
 * The weather the level was calculated from (the same numbers as the score: weather is municipal, so this is
 * not a secret and says nothing about any person). The two flags say whether each part was in the range that
 * favors mosquito breeding; the cut-offs are below.
 */
export interface ResidentWeather {
  /** The day the score was calculated for, YYYY-MM-DD. */
  asOf: string;
  /** Mean temperature of the last 7 days, or null if no day had a record. */
  meanTempC: number | null;
  rainDays: number;
  rainDaysWindow: number;
  rainTotalMm: number;
  tempFavorable: boolean;
  rainFavorable: boolean;
  /** The 7 days up to `asOf`, oldest first: the rain of each day in mm, or null for a day with no record. */
  days: { date: string; rainMm: number | null }[];
}

/** Temperature counts as favorable when the temperature part of the index is at least half of its maximum. */
export const TEMP_FAVORABLE_FROM = 0.5;
/** Rain counts as favorable when the rain part of the index is at least a third (50 mm in 14 days with the default constants). */
export const RAIN_FAVORABLE_FROM = 1 / 3;

export interface ResidentBarangayView extends ResidentBarangay {
  /** null only if the barangay has not been scored yet. */
  level: RiskLevel | null;
  alerts: { level: RiskLevel; issuedAt: string; message: string }[];
  /** null if the barangay has not been scored yet. */
  weather: ResidentWeather | null;
}

/** Reads the weather part of a stored score; null if the stored summary does not have it. */
export function weatherOf(rawSummary: unknown): Omit<ResidentWeather, "days"> | null {
  const raw = rawSummary as { asOf?: unknown; details?: { weather?: Record<string, unknown> } } | null;
  const w = raw?.details?.weather;
  if (!w || typeof raw?.asOf !== "string") return null;
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const tempIndex = num(w.tempIndex);
  const rainIndex = num(w.rainIndex);
  const rainDays = num(w.rainDays);
  const rainDaysWindow = num(w.rainDaysWindow);
  const rainTotalMm = num(w.rainTotalMm);
  if (tempIndex === null || rainIndex === null || rainDays === null || rainDaysWindow === null || rainTotalMm === null) return null;
  const mean = num(w.meanTempC);
  return {
    asOf: raw.asOf,
    meanTempC: mean === null ? null : Math.round(mean * 10) / 10,
    rainDays,
    rainDaysWindow,
    rainTotalMm: Math.round(rainTotalMm),
    tempFavorable: mean !== null && tempIndex >= TEMP_FAVORABLE_FROM,
    rainFavorable: rainIndex >= RAIN_FAVORABLE_FROM,
  };
}

export class ResidentViews {
  constructor(private readonly db: Db) {}

  barangays(): ResidentBarangay[] {
    return listBarangays(this.db).map((b) => ({ id: b.id, name: b.name, municipality: b.municipality }));
  }

  /** The weather behind the level, with the rain of each of the last 7 days (municipal weather, the same record the score used). */
  private weatherFor(municipality: string, rawSummary: unknown): ResidentWeather | null {
    const summary = weatherOf(rawSummary);
    if (!summary) return null;
    const recorded = new Map(getWeatherSeries(this.db, municipality, addDays(summary.asOf, -6), summary.asOf).map((d) => [d.date, d.rainfallMm]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(summary.asOf, i - 6);
      const mm = recorded.get(date);
      return { date, rainMm: mm === undefined ? null : Math.round(mm * 10) / 10 };
    });
    return { ...summary, days };
  }

  barangay(id: number): ResidentBarangayView {
    const b = getBarangay(this.db, id);
    if (!b) throw new AppError(404, "Barangay not found.");
    const score = latestScoreFor(this.db, id);
    const level = score ? riskLevel(Math.round(score.score * 100), getActiveParameters(this.db)) : null;
    return {
      id: b.id,
      name: b.name,
      municipality: b.municipality,
      level,
      alerts: listAlerts(this.db, id, 5).map((a) => ({ level: a.level, issuedAt: a.issuedAt, message: a.message })),
      weather: this.weatherFor(b.municipality, score?.rawSummary),
    };
  }
}
