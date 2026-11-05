// Weather input (SF2): a file import, a freshness check, and the simulator the
// officer uses in the demo. Weather is municipal. Real and simulated values for
// the same date are both kept; reads prefer the simulated one.

import type { Db } from "../../db/connection";
import {
  WeatherSource,
  deleteSimulatedWeather,
  latestWeatherDate,
  upsertWeather,
} from "../../db/repositories/signalRepo";
import { addEvent } from "../../db/repositories/workflowRepo";
import { addDays, daysBetween, isValidDate } from "../../util/dates";
import { parseDelimited } from "./csv";
import { normalizeName } from "./caseImport";

export const WEATHER_FILE_MAX_BYTES = 1024 * 1024;
export const STALE_AFTER_DAYS = 2;
export const DEFAULT_MUNICIPALITY = "Daraga";

export interface WeatherRow {
  date: string;
  municipality: string;
  meanTempC: number;
  rainfallMm: number;
}

export interface WeatherImportResult {
  success: boolean;
  imported: number;
  errors: string[];
}

const COLUMNS = ["date", "municipality", "mean_temp_c", "rainfall_mm"] as const;

/** Expected header: date,municipality,mean_temp_c,rainfall_mm (YYYY-MM-DD dates). */
export function parseWeatherText(text: string): { rows: WeatherRow[]; errors: string[] } {
  if (Buffer.byteLength(text, "utf8") > WEATHER_FILE_MAX_BYTES) return { rows: [], errors: ["The file is larger than 1 MB."] };
  const records = parseDelimited(text);
  const headerIndex = records.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIndex === -1) return { rows: [], errors: ["The file is empty."] };

  const header = records[headerIndex].map((c) => normalizeName(c));
  const col: Record<string, number> = {};
  for (const name of COLUMNS) col[name] = header.indexOf(name);
  const missing = COLUMNS.filter((name) => col[name] === -1);
  if (missing.length > 0) return { rows: [], errors: [`Header must have the columns ${COLUMNS.join(", ")}. Missing: ${missing.join(", ")}.`] };

  const rows: WeatherRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let dataRows = 0;

  for (let i = headerIndex + 1; i < records.length; i++) {
    const cells = records[i];
    if (cells.every((c) => c.trim() === "")) continue;
    dataRows++;
    const row = i + 1;
    if (cells.length !== header.length) {
      errors.push(`Row ${row}: expected ${header.length} values but found ${cells.length}.`);
      continue;
    }
    const date = cells[col.date].trim();
    const municipality = cells[col.municipality].trim();
    const tempText = cells[col.mean_temp_c].trim();
    const rainText = cells[col.rainfall_mm].trim();
    const problems: string[] = [];

    if (!isValidDate(date)) problems.push(`date "${date}" must be a real date like 2026-11-05.`);
    if (municipality === "") problems.push("municipality is missing.");
    const temp = tempText === "" ? NaN : Number(tempText);
    if (!Number.isFinite(temp) || temp < 10 || temp > 45) problems.push(`mean_temp_c "${tempText}" must be a number from 10 to 45.`);
    const rain = rainText === "" ? NaN : Number(rainText);
    if (!Number.isFinite(rain) || rain < 0 || rain > 1500) problems.push(`rainfall_mm "${rainText}" must be a number from 0 to 1500.`);

    const key = `${date}|${normalizeName(municipality)}`;
    if (problems.length === 0 && seen.has(key)) problems.push(`duplicate date ${date} for ${municipality}.`);
    seen.add(key);

    if (problems.length > 0) errors.push(`Row ${row}: ${problems.join(" ")}`);
    else rows.push({ date, municipality, meanTempC: temp, rainfallMm: rain });
  }
  if (dataRows === 0) errors.push("The file has a header but no data rows.");
  return { rows, errors };
}

/** All-or-nothing import of a weather file (source = "file"). */
export function importWeatherText(db: Db, text: string, now: Date = new Date()): WeatherImportResult {
  const { rows, errors } = parseWeatherText(text);
  if (errors.length > 0) return { success: false, imported: 0, errors };

  const at = now.toISOString();
  db.transaction(() => {
    for (const r of rows) upsertWeather(db, { ...r, source: "file" }, at);
    const dates = rows.map((r) => r.date).sort();
    addEvent(db, "weather", `Weather file loaded: ${rows.length} days (${dates[0]} to ${dates[dates.length - 1]})`, at);
  })();
  return { success: true, imported: rows.length, errors: [] };
}

export interface WeatherFreshness {
  stale: boolean;
  latestDate: string | null;
  daysOld: number | null;
  message: string | null;
}

/** Weather is stale when the newest record (real or simulated) is more than 2 days old. */
export function weatherFreshness(db: Db, municipality: string, today: string): WeatherFreshness {
  const latestDate = latestWeatherDate(db, municipality);
  if (latestDate === null) {
    return { stale: true, latestDate, daysOld: null, message: `No weather data for ${municipality}.` };
  }
  const daysOld = daysBetween(latestDate, today);
  const stale = daysOld > STALE_AFTER_DAYS;
  return {
    stale,
    latestDate,
    daysOld,
    message: stale ? `Latest weather record is ${daysOld} days old (${latestDate}).` : null,
  };
}

// ---- simulator -------------------------------------------------------------

export type WeatherPreset = "dry" | "normal" | "heavy_rain";

// Seven values per preset, repeated for longer periods.
export const WEATHER_PRESETS: Record<WeatherPreset, { tempC: number[]; rainMm: number[] }> = {
  dry: { tempC: [33, 34, 33.5, 34, 33, 34.5, 33.5], rainMm: [0, 0, 0, 0, 2, 0, 0] },
  normal: { tempC: [29, 29.5, 28.5, 29, 30, 29, 28.5], rainMm: [0, 6, 0, 12, 0, 3, 8] },
  heavy_rain: { tempC: [28, 27.5, 28.5, 27, 28, 27.5, 28], rainMm: [35, 50, 20, 60, 40, 30, 45] },
};

export interface SimulateWeatherOptions {
  municipality?: string;
  /** Last day to write, YYYY-MM-DD (usually today). */
  endDate: string;
  /** How many days back to overwrite. Default 14. */
  days?: number;
  preset?: WeatherPreset;
  /** Used when no preset is given: constant values for every day. */
  tempC?: number;
  rainMm?: number;
  now?: Date;
}

/**
 * Writes simulated weather for the last `days` days. Real records stay in the
 * database untouched; reads prefer the simulated ones until they are cleared.
 * The caller re-scores afterwards (Phase 5).
 */
export function simulateWeather(db: Db, opts: SimulateWeatherOptions): { from: string; to: string; days: number } {
  const municipality = opts.municipality ?? DEFAULT_MUNICIPALITY;
  const days = opts.days ?? 14;
  if (!isValidDate(opts.endDate)) throw new Error(`Invalid end date: ${opts.endDate}`);
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new Error("days must be a whole number from 1 to 60");

  let temps: number[];
  let rains: number[];
  if (opts.preset) {
    ({ tempC: temps, rainMm: rains } = WEATHER_PRESETS[opts.preset]);
  } else {
    if (opts.tempC === undefined || opts.rainMm === undefined) throw new Error("Give a preset, or both tempC and rainMm");
    if (!(opts.tempC >= 10 && opts.tempC <= 45)) throw new Error("tempC must be from 10 to 45");
    if (!(opts.rainMm >= 0 && opts.rainMm <= 1500)) throw new Error("rainMm must be from 0 to 1500");
    temps = [opts.tempC];
    rains = [opts.rainMm];
  }

  const from = addDays(opts.endDate, -(days - 1));
  const at = (opts.now ?? new Date()).toISOString();
  db.transaction(() => {
    for (let i = 0; i < days; i++) {
      upsertWeather(db, { date: addDays(from, i), municipality, meanTempC: temps[i % temps.length], rainfallMm: rains[i % rains.length], source: "simulated" as WeatherSource }, at);
    }
    addEvent(db, "weather", `Weather simulator applied for ${municipality}: ${opts.preset ?? "custom values"}, ${from} to ${opts.endDate}`, at);
  })();
  return { from, to: opts.endDate, days };
}

/** Removes simulated values so the real weather is used again. */
export function clearSimulatedWeather(db: Db, municipality: string = DEFAULT_MUNICIPALITY, now: Date = new Date()): number {
  const removed = deleteSimulatedWeather(db, municipality);
  addEvent(db, "weather", `Simulated weather cleared for ${municipality}`, now.toISOString());
  return removed;
}
