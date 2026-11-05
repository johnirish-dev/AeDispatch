// Every change to the data that can move a score goes through this file, so the
// rule "write, then re-score" lives in one place:
//
//   case import / weather change / answer / report / symptom check /
//   survey / barangay profile change  ->  rescore the barangays it affects.
//
// Routes and (later) the resident and demo screens call these methods.

import type { Db } from "../db/connection";
import {
  createBarangay,
  deleteBarangay,
  getBarangay,
  getPurok,
  setPuroks,
  updateBarangay,
} from "../db/repositories/barangayRepo";
import { getResident } from "../db/repositories/userRepo";
import {
  addSymptomCheck,
  insertDailyAnswer,
  insertHouseholdReport,
} from "../db/repositories/signalRepo";
import {
  NewContainer,
  TaskStatus,
  addEvent,
  getTask,
  insertSurvey,
  updateTaskStatus,
} from "../db/repositories/workflowRepo";
import type { Bhw } from "../db/repositories/userRepo";
import { AppError, isUniqueViolation } from "../errors";
import * as v from "../validate";
import { formatDate } from "../util/dates";
import {
  CaseImportResult,
  importCases,
} from "./ingestion/caseImport";
import {
  DEFAULT_MUNICIPALITY,
  SimulateWeatherOptions,
  WeatherImportResult,
  clearSimulatedWeather,
  importWeatherText,
  simulateWeather,
} from "./ingestion/weather";
import type { RankingService } from "./ranking";

export const CONTAINER_LOCATIONS = ["indoor", "outdoor", "natural"] as const;

export interface SurveySubmission {
  taskId?: number | null;
  purokId: unknown;
  houseNo: unknown;
  headOfFamily?: unknown;
  age?: unknown;
  sex?: unknown;
  civilStatus?: unknown;
  occupation?: unknown;
  personsSlept?: unknown;
  buildingStructure?: unknown;
  storeys?: unknown;
  rooms?: unknown;
  screened?: unknown;
  surveyedBy: unknown;
  surveyDate: unknown;
  noContainersFound?: unknown;
  containers?: unknown;
  /** The BHW says the task is finished. */
  completeTask?: unknown;
}

export interface BarangayInput {
  name?: unknown;
  municipality?: unknown;
  population?: unknown;
  areaKm2?: unknown;
  puroks?: unknown;
}

export class DataChanges {
  constructor(
    private readonly db: Db,
    private readonly ranking: RankingService,
  ) {}

  private today(): string {
    return formatDate(this.ranking.now());
  }

  // ---- case import -----------------------------------------------------------

  /** Imports the weekly case file (all rows valid or nothing) and re-scores who it touched. */
  importCases(text: string, officerId: number): CaseImportResult {
    const result = importCases(this.db, text, officerId, this.ranking.now());
    if (result.success) this.ranking.rescore(result.affectedBarangayIds, { reason: "case import" });
    return result;
  }

  // ---- weather (municipal, so every barangay is re-scored) ------------------

  importWeatherFile(text: string): WeatherImportResult {
    const result = importWeatherText(this.db, text, this.ranking.now());
    if (result.success) this.ranking.rescoreAll({ reason: "weather file" });
    return result;
  }

  simulateWeather(opts: Omit<SimulateWeatherOptions, "endDate"> & { endDate?: string }): void {
    simulateWeather(this.db, { ...opts, endDate: opts.endDate ?? this.today(), now: this.ranking.now() });
    this.ranking.rescoreAll({ reason: "weather simulator" });
  }

  clearSimulatedWeather(municipality: string = DEFAULT_MUNICIPALITY): number {
    const removed = clearSimulatedWeather(this.db, municipality, this.ranking.now());
    this.ranking.rescoreAll({ reason: "weather reset" });
    return removed;
  }

  // ---- resident contributions (sign-in is Phase 8; these are what it calls) ---

  /** One answer per resident per day. Returns false if they already answered today. */
  recordDailyAnswer(residentId: number, answer: unknown): { saved: boolean } {
    const a = v.oneOf(answer, "answer", ["yes", "no"] as const);
    const resident = this.residentOrFail(residentId);
    const saved = insertDailyAnswer(this.db, {
      residentId,
      barangayId: resident.barangayId,
      date: this.today(),
      answer: a,
      at: this.ranking.now().toISOString(),
    });
    if (saved) this.ranking.rescore([resident.barangayId], { reason: "daily answer" });
    return { saved };
  }

  recordHouseholdReport(
    residentId: number,
    report: { standingWater: unknown; cloggedGutter: unknown; oldContainers: unknown; bitesIndoors: unknown },
  ): void {
    const resident = this.residentOrFail(residentId);
    insertHouseholdReport(this.db, {
      residentId,
      barangayId: resident.barangayId,
      date: this.today(),
      standingWater: v.bool(report.standingWater, "standingWater"),
      cloggedGutter: v.bool(report.cloggedGutter, "cloggedGutter"),
      oldContainers: v.bool(report.oldContainers, "oldContainers"),
      bitesIndoors: v.bool(report.bitesIndoors, "bitesIndoors"),
      at: this.ranking.now().toISOString(),
    });
    this.ranking.rescore([resident.barangayId], { reason: "household report" });
  }

  /** Anonymous: only the barangay's daily totals change. No resident is stored. */
  recordSymptomCheck(barangayId: number, warningSigns: unknown): void {
    if (!getBarangay(this.db, barangayId)) throw new AppError(404, "Barangay not found.");
    addSymptomCheck(this.db, {
      barangayId,
      date: this.today(),
      warningSigns: v.bool(warningSigns, "warningSigns"),
      at: this.ranking.now().toISOString(),
    });
    this.ranking.rescore([barangayId], { reason: "symptom check" });
  }

  private residentOrFail(residentId: number) {
    const resident = getResident(this.db, residentId);
    if (!resident) throw new AppError(401, "Sign in first.");
    return resident;
  }

  // ---- BHW survey ------------------------------------------------------------

  /**
   * Checks a submitted entomological survey like the paper form, saves it with
   * its containers, updates the task, logs it and re-scores the barangay.
   */
  submitSurvey(bhw: Bhw, s: SurveySubmission): { surveyId: number } {
    const surveyDate = v.dateText(s.surveyDate, "surveyDate");
    if (surveyDate > this.today()) throw new AppError(400, "The survey date cannot be in the future.");

    const purokId = v.int(s.purokId, "purokId", 1, Number.MAX_SAFE_INTEGER);
    const purok = getPurok(this.db, purokId);
    if (!purok || purok.barangayId !== bhw.barangayId) {
      throw new AppError(400, "That purok is not in your barangay.");
    }

    let taskId: number | null = null;
    let taskStatus: TaskStatus | null = null;
    if (s.taskId !== undefined && s.taskId !== null) {
      taskId = v.int(s.taskId, "taskId", 1, Number.MAX_SAFE_INTEGER);
      const task = getTask(this.db, taskId);
      if (!task || task.bhwId !== bhw.id) throw new AppError(400, "That task is not assigned to you.");
      taskStatus = task.status;
    }

    const noContainersFound = s.noContainersFound === undefined ? false : v.bool(s.noContainersFound, "noContainersFound");
    const containers = this.checkContainers(s.containers, noContainersFound);

    const surveyedBy = v.text(s.surveyedBy, "surveyedBy", 100);
    const houseNo = v.text(s.houseNo, "houseNo", 40);
    const submittedAt = this.ranking.now().toISOString();
    const markDone = s.completeTask === true;

    const surveyId = this.db.transaction(() => {
      const id = insertSurvey(
        this.db,
        {
          taskId,
          bhwId: bhw.id,
          barangayId: bhw.barangayId,
          purokId,
          houseNo,
          headOfFamily: v.optionalText(s.headOfFamily, "headOfFamily", 100),
          age: v.optionalInt(s.age, "age", 0, 120),
          sex: v.optionalText(s.sex, "sex", 20),
          civilStatus: v.optionalText(s.civilStatus, "civilStatus", 20),
          occupation: v.optionalText(s.occupation, "occupation", 60),
          personsSlept: v.optionalInt(s.personsSlept, "personsSlept", 0, 60),
          buildingStructure: v.optionalText(s.buildingStructure, "buildingStructure", 40),
          storeys: v.optionalInt(s.storeys, "storeys", 1, 20),
          rooms: v.optionalInt(s.rooms, "rooms", 0, 100),
          screened: s.screened === undefined || s.screened === null ? undefined : v.bool(s.screened, "screened"),
          surveyedBy,
          surveyDate,
          noContainersFound,
          submittedAt,
        },
        containers,
      );
      if (taskId !== null) {
        // Done when the BHW says so; otherwise at least in progress.
        if (markDone) updateTaskStatus(this.db, taskId, "completed", submittedAt);
        else if (taskStatus === "new") updateTaskStatus(this.db, taskId, "in_progress", submittedAt);
      }
      // The log never carries the household details: only who, where, when.
      addEvent(this.db, "submission", `${bhw.displayName} submitted a survey for ${this.barangayName(bhw.barangayId)} (${purok.name})`, submittedAt);
      return id;
    })();

    this.ranking.rescore([bhw.barangayId], { reason: "survey submitted" });
    return { surveyId };
  }

  private checkContainers(input: unknown, noContainersFound: boolean): NewContainer[] {
    const list = input === undefined ? [] : input;
    if (!Array.isArray(list)) throw new AppError(400, "containers must be a list.");
    if (noContainersFound && list.length > 0) {
      throw new AppError(400, "Remove the container rows or untick No containers found.");
    }
    if (!noContainersFound && list.length === 0) {
      throw new AppError(400, "Add at least one container row, or tick No containers found.");
    }
    return list.map((raw, i) => {
      const row = `container row ${i + 1}`;
      const c = v.bodyObject(raw);
      const total = v.int(c.total, `${row}: total`, 0, 100_000);
      const withCover = v.int(c.withCover, `${row}: with cover`, 0, 100_000);
      const withoutCover = v.int(c.withoutCover, `${row}: without cover`, 0, 100_000);
      const positive = v.int(c.positive, `${row}: positive`, 0, 100_000);
      if (withCover + withoutCover !== total) {
        throw new AppError(400, `${row}: with cover + without cover must equal the total.`);
      }
      if (positive > total) throw new AppError(400, `${row}: positive containers cannot be more than the total.`);
      return {
        location: v.oneOf(c.location, `${row}: location`, CONTAINER_LOCATIONS),
        containerType: v.text(c.containerType, `${row}: container type`, 40),
        total,
        withCover,
        withoutCover,
        positive,
        larvaeCount: v.optionalInt(c.larvaeCount, `${row}: larvae`, 0, 1_000_000) ?? 0,
        pupaeCount: v.optionalInt(c.pupaeCount, `${row}: pupae`, 0, 1_000_000) ?? 0,
      };
    });
  }

  private barangayName(id: number): string {
    return getBarangay(this.db, id)?.name ?? `barangay ${id}`;
  }

  // ---- barangay profiles -----------------------------------------------------

  createBarangay(input: BarangayInput): number {
    const name = v.text(input.name, "name", 80);
    const municipality = v.optionalText(input.municipality, "municipality", 80) ?? DEFAULT_MUNICIPALITY;
    const population = v.int(input.population, "population", 1, 5_000_000);
    const areaKm2 = v.numberAbove(input.areaKm2, "area (km²)", 0, 100_000);
    const puroks = this.checkPuroks(input.puroks, true);

    let id: number;
    try {
      id = createBarangay(this.db, { name, municipality, population, areaKm2, puroks }, this.ranking.now().toISOString());
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, `A barangay named "${name}" already exists.`);
      throw err;
    }
    // A new barangay can change the highest density, which every score uses.
    this.ranking.rescoreAll({ reason: "barangay added" });
    return id;
  }

  updateBarangay(id: number, input: BarangayInput): void {
    const current = getBarangay(this.db, id);
    if (!current) throw new AppError(404, "Barangay not found.");

    const changes = {
      name: input.name === undefined ? undefined : v.text(input.name, "name", 80),
      municipality: input.municipality === undefined ? undefined : v.text(input.municipality, "municipality", 80),
      population: input.population === undefined ? undefined : v.int(input.population, "population", 1, 5_000_000),
      areaKm2: input.areaKm2 === undefined ? undefined : v.numberAbove(input.areaKm2, "area (km²)", 0, 100_000),
    };
    const puroks = input.puroks === undefined ? undefined : this.checkPuroks(input.puroks, true);
    const at = this.ranking.now().toISOString();

    try {
      this.db.transaction(() => {
        updateBarangay(this.db, id, changes, at);
        if (puroks) setPuroks(this.db, id, puroks, at);
      })();
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, `A barangay named "${changes.name}" already exists.`);
      throw err;
    }

    // Population or area changes the density of every barangay's ratio.
    const densityChanged =
      (changes.population !== undefined && changes.population !== current.population) ||
      (changes.areaKm2 !== undefined && changes.areaKm2 !== current.areaKm2);
    if (densityChanged) this.ranking.rescoreAll({ reason: "barangay profile (density)" });
    else this.ranking.rescore([id], { reason: "barangay profile" });
  }

  /** Deleting a barangay also deletes its puroks, cases, surveys, scores and BHWs. */
  deleteBarangay(id: number): void {
    if (!deleteBarangay(this.db, id)) throw new AppError(404, "Barangay not found.");
    this.ranking.removeBarangay(id);
    this.ranking.rescoreAll({ reason: "barangay deleted" });
  }

  private checkPuroks(input: unknown, required: boolean): string[] {
    if (!Array.isArray(input)) {
      if (required) throw new AppError(400, "puroks must be a list of names.");
      return [];
    }
    const names = input.map((n, i) => v.text(n, `purok ${i + 1}`, 40));
    if (required && names.length === 0) throw new AppError(400, "A barangay needs at least one purok.");
    const unique = new Set(names.map((n) => n.toLowerCase()));
    if (unique.size !== names.length) throw new AppError(400, "Purok names must be different from each other.");
    return names;
  }
}
