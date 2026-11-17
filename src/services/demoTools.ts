// What the Demo tools page needs from the server (a team-only page of the dashboard):
//   - the addresses for the QR codes that open the phone screens;
//   - the weather simulator's state;
//   - the weights: a PREVIEW of the ranking with other weights (nothing is saved), saving a new
//     version, and activating one.
// Changing the weather or activating a version re-scores every barangay, through the same paths the
// rest of the system uses.

import os from "node:os";
import { DEFAULT_PARAMETERS, ModelParameters, Weights, validateParameters } from "../algorithms/parameters";
import { scoreBarangay } from "../algorithms/scoring";
import type { Db } from "../db/connection";
import { densityRatios, listBarangays } from "../db/repositories/barangayRepo";
import { getActiveParameters, getParameters, insertParameters, listParameterVersions, nextParameterVersion } from "../db/repositories/parameterRepo";
import { getWeatherSeries, latestWeatherDate } from "../db/repositories/signalRepo";
import { barangayTokenMatches } from "../db/repositories/userRepo";
import { addEvent } from "../db/repositories/workflowRepo";
import { SAMPLE_BARANGAYS } from "../db/sampleData";
import { sampleBarangayToken } from "../db/seedDatabase";
import { hashToken } from "../db/security";
import { AppError } from "../errors";
import { addDays, formatDate } from "../util/dates";
import { WEATHER_PRESETS, WeatherPreset } from "./ingestion/weather";
import type { DataChanges } from "./changes";
import type { RankingService } from "./ranking";
import { caseWeeksAsOf, loadInputs } from "./scoringInputs";

const MUNICIPALITY = "Daraga";
const WEIGHT_NAMES = ["weather", "household", "symptom", "field", "cases"] as const;

export interface DemoLinks {
  baseUrl: string;
  /** True when the address is the laptop itself: a phone cannot open it. */
  isLocalhost: boolean;
  resident: string;
  /** One link per barangay (the token opens the barangay, not a person). */
  bhws: { barangay: string; url: string }[];
}

export interface WeatherState {
  /** Simulated values are in use for any of the last days shown. */
  simulated: boolean;
  presets: { key: WeatherPreset; label: string }[];
  days: { date: string; tempC: number; rainMm: number; source: string }[];
}

export interface WeightPreviewRow {
  barangayId: number;
  name: string;
  /** Raw score (0 to 1) and place (1 = highest) with the active weights, and with the weights tried. */
  scoreNow: number;
  scoreNew: number;
  rankNow: number;
  rankNew: number;
}

export interface WeightVersion {
  version: number;
  note: string | null;
  isActive: boolean;
  createdAt: string;
  weights: Weights;
}

const PRESET_LABELS: Record<WeatherPreset, string> = { dry: "Dry week", normal: "Normal week", heavy_rain: "Heavy-rain week" };

/** Adapters a phone can never reach: virtual machines, containers, VPNs, Bluetooth. */
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|host-only|vpn/i;
const WIFI_ADAPTER = /wi-?fi|wlan|wireless/i;

/**
 * The IPv4 address of this computer that a phone on the same Wi-Fi can reach, or null. Virtual adapters
 * (VirtualBox's 192.168.56.x, VMware, WSL, Docker...) are skipped; a Wi-Fi adapter wins over the others.
 */
export function lanAddress(interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string | null {
  const isPrivate = (a: string) => a.startsWith("192.168.") || a.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  const found: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) found.push({ name, address: item.address });
    }
  }
  const real = found.filter((c) => !VIRTUAL_ADAPTER.test(c.name) && !c.address.startsWith("192.168.56."));
  const pool = real.length > 0 ? real : found;
  const pick = (list: typeof found) => list.find((c) => WIFI_ADAPTER.test(c.name) && isPrivate(c.address)) ?? list.find((c) => isPrivate(c.address)) ?? list[0];
  return pick(pool)?.address ?? null;
}

/** The weights as sent by the page: five non-negative numbers that add up to 1 (a small rounding error is allowed and removed). */
export function readWeights(input: unknown): Weights {
  if (typeof input !== "object" || input === null) throw new AppError(400, "Send the five weights.");
  const raw = input as Record<string, unknown>;
  const values = {} as Record<string, number>;
  for (const name of WEIGHT_NAMES) {
    const x = raw[name];
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) throw new AppError(400, `The weight for ${name} must be a number from 0 up.`);
    values[name] = x;
  }
  const sum = WEIGHT_NAMES.reduce((a, name) => a + values[name], 0);
  if (Math.abs(sum - 1) > 0.002) throw new AppError(400, `The weights must add up to 100% (they add up to ${(sum * 100).toFixed(1)}%).`);
  const out = {} as Record<string, number>;
  for (const name of WEIGHT_NAMES) out[name] = values[name] / sum; // spread the rounding error, so they add up to exactly 1
  return out as unknown as Weights;
}

export class DemoTools {
  constructor(
    private readonly db: Db,
    private readonly ranking: RankingService,
    private readonly changes: DataChanges,
  ) {}

  // ---- the phone screens -------------------------------------------------------------------

  links(env: NodeJS.ProcessEnv = process.env, interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): DemoLinks {
    const configured = (env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
    const port = Number(env.PORT) || 3000;
    const lan = lanAddress(interfaces);
    const baseUrl = configured !== "" ? configured : lan !== null ? `http://${lan}:${port}` : `http://localhost:${port}`;
    const isLocalhost = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl);

    const bhws: DemoLinks["bhws"] = [];
    for (const barangay of listBarangays(this.db)) {
      const index = SAMPLE_BARANGAYS.findIndex((s) => s.name === barangay.name);
      if (index < 0) continue; // only the sample barangays have a token this page can rebuild
      const token = sampleBarangayToken(index);
      if (!barangayTokenMatches(this.db, barangay.id, hashToken(token))) continue; // a link that would not open anything is not shown
      bhws.push({ barangay: barangay.name, url: `${baseUrl}/bhw/?token=${token}` });
    }
    return { baseUrl, isLocalhost, resident: `${baseUrl}/resident/`, bhws };
  }

  // ---- the weather simulator ---------------------------------------------------------------

  weatherState(): WeatherState {
    const last = latestWeatherDate(this.db, MUNICIPALITY);
    const days = last ? getWeatherSeries(this.db, MUNICIPALITY, addDays(last, -13), last) : [];
    return {
      simulated: days.some((d) => d.source === "simulated"),
      presets: (Object.keys(WEATHER_PRESETS) as WeatherPreset[]).map((key) => ({ key, label: PRESET_LABELS[key] })),
      days: days.map((d) => ({ date: d.date, tempC: d.meanTempC, rainMm: d.rainfallMm, source: d.source })),
    };
  }

  /** Applies a preset or constant values to the last days, then re-scores every barangay. */
  simulateWeather(body: { preset?: unknown; tempC?: unknown; rainMm?: unknown; days?: unknown }): WeatherState {
    try {
      if (body.preset !== undefined) {
        if (typeof body.preset !== "string" || !(body.preset in WEATHER_PRESETS)) throw new Error("Choose dry, normal or heavy_rain.");
        this.changes.simulateWeather({ preset: body.preset as WeatherPreset, days: this.daysOf(body.days) });
      } else {
        if (typeof body.tempC !== "number" || typeof body.rainMm !== "number") throw new Error("Give a preset, or both a temperature and the rain.");
        this.changes.simulateWeather({ tempC: body.tempC, rainMm: body.rainMm, days: this.daysOf(body.days) });
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, (error as Error).message);
    }
    return this.weatherState();
  }

  resetWeather(): WeatherState {
    this.changes.clearSimulatedWeather();
    return this.weatherState();
  }

  private daysOf(days: unknown): number | undefined {
    if (days === undefined) return undefined;
    if (typeof days !== "number" || !Number.isInteger(days)) throw new Error("days must be a whole number.");
    return days;
  }

  // ---- the weights -------------------------------------------------------------------------

  versions(): { active: WeightVersion; versions: WeightVersion[] } {
    const rows = listParameterVersions(this.db).map((r): WeightVersion => ({
      version: r.version,
      note: r.note,
      isActive: r.isActive === 1,
      createdAt: r.createdAt,
      weights: (getParameters(this.db, r.version) ?? DEFAULT_PARAMETERS).weights,
    }));
    return { active: rows.find((r) => r.isActive)!, versions: rows };
  }

  /**
   * What the ranking would be with other weights: every barangay scored with the active weights and with
   * these, from the same data. Nothing is saved and the live ranking is not touched.
   */
  preview(weights: Weights): WeightPreviewRow[] {
    const active = getActiveParameters(this.db);
    const candidate: ModelParameters = { ...active, weights };
    this.checked(candidate);

    const today = formatDate(this.ranking.now());
    const weeks = caseWeeksAsOf(this.db, today);
    const ratios = densityRatios(this.db);
    const rows = listBarangays(this.db).map((b) => {
      const inputs = loadInputs(this.db, b, ratios.get(b.id) ?? 0, today, weeks, active);
      return { id: b.id, name: b.name, now: scoreBarangay(inputs, active).score, next: scoreBarangay(inputs, candidate).score };
    });
    const place = (pick: (r: (typeof rows)[number]) => number) => {
      const order = [...rows].sort((a, b) => pick(b) - pick(a) || a.id - b.id); // the heap's rule: higher first, then the smaller id
      return new Map(order.map((r, i) => [r.id, i + 1]));
    };
    const rankNow = place((r) => r.now);
    const rankNew = place((r) => r.next);
    return rows
      .map((r): WeightPreviewRow => ({ barangayId: r.id, name: r.name, scoreNow: r.now, scoreNew: r.next, rankNow: rankNow.get(r.id)!, rankNew: rankNew.get(r.id)! }))
      .sort((a, b) => a.rankNew - b.rankNew);
  }

  /** Saves the weights as a new version. It is NOT used until it is activated. */
  saveVersion(weights: Weights, note: unknown): WeightVersion {
    const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
    const active = getActiveParameters(this.db);
    const version = nextParameterVersion(this.db);
    const params: ModelParameters = { ...active, version, weights };
    this.checked(params);
    const at = this.ranking.now().toISOString();
    insertParameters(this.db, params, { note: text === "" ? undefined : text, activate: false, at });
    addEvent(this.db, "params", `Weight version ${version} saved${text === "" ? "" : `: ${text}`}`, at);
    return { version, note: text === "" ? null : text, isActive: false, createdAt: at, weights };
  }

  /** Makes a saved version the one in use and re-scores every barangay with it. */
  activate(version: number): WeightVersion {
    const params = getParameters(this.db, version);
    if (!params) throw new AppError(404, "That weight version does not exist.");
    this.checked(params);
    const at = this.ranking.now().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE model_parameters SET is_active = 0 WHERE is_active = 1").run();
      this.db.prepare("UPDATE model_parameters SET is_active = 1 WHERE version = ?").run(version);
      addEvent(this.db, "params", `Weight version ${version} is now in use`, at);
    })();
    // Not an event in the field, so it does not send resident alerts.
    this.ranking.rescoreAll({ reason: `weight version ${version}`, alerts: false });
    return this.versions().versions.find((v) => v.version === version)!;
  }

  private checked(params: ModelParameters): void {
    try {
      validateParameters(params);
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
  }
}
