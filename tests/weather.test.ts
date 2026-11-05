import { describe, it, expect } from "vitest";
import {
  STALE_AFTER_DAYS, WEATHER_PRESETS, clearSimulatedWeather, importWeatherText, parseWeatherText,
  simulateWeather, weatherFreshness,
} from "../src/services/ingestion/weather";
import { getWeatherSeries } from "../src/db/repositories/signalRepo";
import { listEvents } from "../src/db/repositories/workflowRepo";
import { count, dataFile, emptyDb, SEED_DATE, seededDb } from "./helpers";

const HEADER = "date,municipality,mean_temp_c,rainfall_mm";

describe("weather file import", () => {
  it("imports the sample file as source 'file'", () => {
    const db = emptyDb();
    const r = importWeatherText(db, dataFile("weather.csv"));
    expect(r).toEqual({ success: true, imported: 17, errors: [] });
    const series = getWeatherSeries(db, "Daraga", "2026-10-01", "2026-11-30");
    expect(series).toHaveLength(17);
    expect(series.every((d) => d.source === "file")).toBe(true);
    expect(listEvents(db, 1)[0].type).toBe("weather");
  });

  it("is all-or-nothing", () => {
    const db = emptyDb();
    const text = [HEADER, "2026-11-01,Daraga,29,1", "2026-02-31,Daraga,29,1", "2026-11-03,Daraga,99,1", "2026-11-04,Daraga,29,-5", "2026-11-05,,29,1", "2026-11-01,Daraga,30,2", "2026-11-06,Daraga,hot,1", "2026-11-07,Daraga,29"].join("\n");
    const r = importWeatherText(db, text);
    expect(r.success).toBe(false);
    expect(r.errors).toHaveLength(7);
    expect(r.errors[0]).toContain("Row 3");
    expect(r.errors.join("\n")).toContain("duplicate date 2026-11-01");
    expect(count(db, "weather_record")).toBe(0);
    expect(count(db, "event_log")).toBe(0);
  });

  it("checks the header, emptiness and size", () => {
    expect(parseWeatherText("").errors[0]).toContain("empty");
    expect(parseWeatherText(`${HEADER}\n`).errors[0]).toContain("no data rows");
    expect(parseWeatherText("date,temp\n2026-11-01,29").errors[0]).toContain("Missing");
    expect(parseWeatherText(HEADER + "\n" + "x".repeat(1024 * 1024 + 1)).errors[0]).toContain("1 MB");
  });

  it("re-importing a day updates it", () => {
    const db = emptyDb();
    importWeatherText(db, `${HEADER}\n2026-11-01,Daraga,29,1`);
    importWeatherText(db, `${HEADER}\n2026-11-01,Daraga,31,2`);
    expect(count(db, "weather_record")).toBe(1);
    expect(getWeatherSeries(db, "Daraga", "2026-11-01", "2026-11-01")[0].meanTempC).toBe(31);
  });
});

describe("freshness", () => {
  it("is fresh for up to two days and stale after that", () => {
    const db = seededDb(); // latest record is 2026-11-05
    expect(STALE_AFTER_DAYS).toBe(2);
    expect(weatherFreshness(db, "Daraga", "2026-11-05")).toMatchObject({ stale: false, daysOld: 0, message: null });
    expect(weatherFreshness(db, "Daraga", "2026-11-07").stale).toBe(false);
    const stale = weatherFreshness(db, "Daraga", "2026-11-08");
    expect(stale.stale).toBe(true);
    expect(stale.daysOld).toBe(3);
    expect(stale.message).toContain("3 days old");
  });

  it("is stale when there is no data at all", () => {
    const f = weatherFreshness(emptyDb(), "Daraga", SEED_DATE);
    expect(f.stale).toBe(true);
    expect(f.latestDate).toBeNull();
    expect(f.message).toContain("No weather data");
  });
});

describe("weather simulator", () => {
  it("overrides the last days with a preset and keeps real values", () => {
    const db = seededDb();
    const real = getWeatherSeries(db, "Daraga", "2026-10-23", SEED_DATE).map((d) => d.meanTempC);
    const r = simulateWeather(db, { endDate: SEED_DATE, preset: "heavy_rain", now: new Date("2026-11-05T12:00:00Z") });
    expect(r).toEqual({ from: "2026-10-23", to: SEED_DATE, days: 14 });

    const series = getWeatherSeries(db, "Daraga", "2026-10-22", SEED_DATE);
    expect(series[0].source).toBe("file"); // day before the window is untouched
    const simulated = series.slice(1);
    expect(simulated).toHaveLength(14);
    expect(simulated.every((d) => d.source === "simulated")).toBe(true);
    expect(simulated.every((d) => d.rainfallMm >= 20)).toBe(true);
    expect(simulated[0].rainfallMm).toBe(WEATHER_PRESETS.heavy_rain.rainMm[0]);
    expect(listEvents(db, 1)[0].text).toContain("heavy_rain");

    // Clearing brings the real values back.
    expect(clearSimulatedWeather(db)).toBe(14);
    expect(getWeatherSeries(db, "Daraga", "2026-10-23", SEED_DATE).map((d) => d.meanTempC)).toEqual(real);
  });

  it("supports custom values and a shorter period", () => {
    const db = seededDb();
    simulateWeather(db, { endDate: SEED_DATE, days: 3, tempC: 31.5, rainMm: 0 });
    const last = getWeatherSeries(db, "Daraga", "2026-11-01", SEED_DATE);
    expect(last.map((d) => d.source)).toEqual(["file", "file", "simulated", "simulated", "simulated"]);
    expect(last[4]).toMatchObject({ meanTempC: 31.5, rainfallMm: 0 });
  });

  it("keeps the data fresh when the real file has gone stale", () => {
    const db = seededDb();
    expect(weatherFreshness(db, "Daraga", "2026-11-12").stale).toBe(true);
    simulateWeather(db, { endDate: "2026-11-12", days: 3, preset: "normal" });
    expect(weatherFreshness(db, "Daraga", "2026-11-12").stale).toBe(false);
  });

  it("rejects bad input", () => {
    const db = emptyDb();
    expect(() => simulateWeather(db, { endDate: "2026-13-01", preset: "dry" })).toThrow();
    expect(() => simulateWeather(db, { endDate: SEED_DATE, preset: "dry", days: 0 })).toThrow();
    expect(() => simulateWeather(db, { endDate: SEED_DATE, preset: "dry", days: 61 })).toThrow();
    expect(() => simulateWeather(db, { endDate: SEED_DATE, tempC: 29 })).toThrow();
    expect(() => simulateWeather(db, { endDate: SEED_DATE, tempC: 99, rainMm: 1 })).toThrow();
    expect(() => simulateWeather(db, { endDate: SEED_DATE, tempC: 29, rainMm: -1 })).toThrow();
    expect(count(db, "weather_record")).toBe(0);
  });
});
