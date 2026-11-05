// Loads the numbers the scoring formula needs for one barangay. The windows
// (7 and 14 days) come from the model parameters. All dates are UTC YYYY-MM-DD.

import type { ModelParameters } from "../algorithms/parameters";
import type { BarangayInputs } from "../algorithms/scoring";
import type { Db } from "../db/connection";
import type { BarangayRow } from "../db/repositories/barangayRepo";
import { barangayCases, latestCaseWeek } from "../db/repositories/caseRepo";
import {
  answerTotals,
  getWeatherSeries,
  reportTotals,
  surveyTotals,
  symptomTotals,
} from "../db/repositories/signalRepo";
import { addDays, daysBetween, shiftIsoWeek } from "../util/dates";

/** The two case weeks used for "this week" and "last week", the same for every barangay. */
export interface CaseWeeks {
  thisWeek: string | null;
  lastWeek: string | null;
}

export function caseWeeksAsOf(db: Db, today: string): CaseWeeks {
  const thisWeek = latestCaseWeek(db, today);
  return { thisWeek, lastWeek: thisWeek === null ? null : shiftIsoWeek(thisWeek, -1) };
}

/** First day of a window of `days` days that ends today. */
const windowStart = (today: string, days: number): string => addDays(today, -(days - 1));

export function loadInputs(
  db: Db,
  b: BarangayRow,
  densityRatio: number,
  today: string,
  weeks: CaseWeeks,
  p: ModelParameters,
): BarangayInputs {
  const c = p.constants;

  // One slot per day (oldest first); a day with no record stays NaN, which the
  // scoring functions ignore. That keeps "last 7 days" exact when days are missing.
  const span = Math.max(c.tempWindowDays, c.rainWindowDays, c.rainDaysWindowDays);
  const temps = new Array<number>(span).fill(NaN);
  const rain = new Array<number>(span).fill(NaN);
  for (const day of getWeatherSeries(db, b.municipality, windowStart(today, span), today)) {
    const slot = span - 1 - daysBetween(day.date, today);
    temps[slot] = day.meanTempC;
    rain[slot] = day.rainfallMm;
  }

  const answers = answerTotals(db, b.id, windowStart(today, c.windows.householdDays), today);
  const reports = reportTotals(db, b.id, windowStart(today, c.windows.householdDays), today);
  const symptoms = symptomTotals(db, b.id, windowStart(today, c.windows.symptomDays), today);
  const field = surveyTotals(db, b.id, windowStart(today, c.windows.fieldDays), today);

  return {
    population: b.population,
    densityRatio,
    weather: { dailyMeanTempC: temps, dailyRainfallMm: rain },
    household: {
      answers: { total: answers.total, yes: answers.yes },
      reports: { total: reports.total, withBreeding: reports.withBreeding },
    },
    symptoms: { warningChecks: symptoms.warning, totalChecks: symptoms.checks, population: b.population },
    field: { surveys: field.surveys, containers: field.containers, positive: field.positive },
    cases: {
      thisWeek: weeks.thisWeek === null ? 0 : barangayCases(db, b.id, weeks.thisWeek),
      lastWeek: weeks.lastWeek === null ? 0 : barangayCases(db, b.id, weeks.lastWeek),
      population: b.population,
    },
  };
}
