// Ways to damage the data a ranking is allowed to see (Objective 3: robustness to sparse, missing
// and noisy reports). Each one returns a COPY of the simulated data in which some inputs are
// thinned, removed or spoiled. The judging always uses the untouched data (what really happened),
// so a damaged input can only make a ranking worse informed, never change the right answer.

import { SimData, weeklyCases } from "../sim/generator";
import { Rng, binomial } from "../sim/random";

/** A copy of the data with its own arrays, safe to change. */
export function cloneSim(d: SimData): SimData {
  return {
    ...d,
    population: d.population.slice(),
    areaKm2: d.areaKm2.slice(),
    purokCount: d.purokCount.slice(),
    onsetWeek: d.onsetWeek.slice(),
    hotPurok: d.hotPurok.slice(),
    meanTempC: d.meanTempC.slice(),
    rainfallMm: d.rainfallMm.slice(),
    answersTotal: d.answersTotal.slice(),
    answersYes: d.answersYes.slice(),
    reportsTotal: d.reportsTotal.slice(),
    reportsWithBreeding: d.reportsWithBreeding.slice(),
    symptomChecks: d.symptomChecks.slice(),
    symptomWarning: d.symptomWarning.slice(),
    surveys: d.surveys.slice(),
    containers: d.containers.slice(),
    positive: d.positive.slice(),
    cases: d.cases.slice(),
  };
}

export interface Degradation {
  /** Short key used in files. */
  name: string;
  /** Words for the tables. */
  label: string;
  /** The levels to try (a share between 0 and 1; meaning depends on the degradation). */
  levels: number[];
  /** What a level means, for the tables. */
  levelMeaning: string;
  apply(d: SimData, level: number, rng: Rng): SimData;
}

export const DEGRADATIONS: Degradation[] = [
  {
    name: "household",
    label: "Household answers and reports thinned",
    levels: [0.1, 0.3, 0.5, 0.8, 0.95],
    levelMeaning: "share of answers and reports lost",
    apply(d, level, rng) {
      const c = cloneSim(d);
      // The "yes" and "breeding" counts are thinned from the same draws' share, so the rate stays honest.
      for (let i = 0; i < c.answersTotal.length; i++) {
        const total = c.answersTotal[i];
        const kept = binomial(rng, total, 1 - level);
        c.answersYes[i] = total === 0 ? 0 : Math.round((c.answersYes[i] * kept) / total);
        c.answersTotal[i] = kept;
        const rt = c.reportsTotal[i];
        const rk = binomial(rng, rt, 1 - level);
        c.reportsWithBreeding[i] = rt === 0 ? 0 : Math.round((c.reportsWithBreeding[i] * rk) / rt);
        c.reportsTotal[i] = rk;
      }
      return c;
    },
  },
  {
    name: "symptoms",
    label: "Symptom checks thinned",
    levels: [0.1, 0.3, 0.5, 0.8, 0.95],
    levelMeaning: "share of checks lost",
    apply(d, level, rng) {
      const c = cloneSim(d);
      for (let i = 0; i < c.symptomChecks.length; i++) {
        const total = c.symptomChecks[i];
        const kept = binomial(rng, total, 1 - level);
        c.symptomWarning[i] = total === 0 ? 0 : Math.round((c.symptomWarning[i] * kept) / total);
        c.symptomChecks[i] = kept;
      }
      return c;
    },
  },
  {
    name: "weather",
    label: "Weather days missing",
    levels: [0.1, 0.3, 0.5],
    levelMeaning: "share of days with no weather record",
    apply(d, level, rng) {
      const c = cloneSim(d);
      for (let day = 0; day < c.days; day++) {
        if (rng() < level) {
          c.meanTempC[day] = NaN;
          c.rainfallMm[day] = NaN;
        }
      }
      return c;
    },
  },
  {
    name: "field",
    label: "Field surveys missing (at random)",
    levels: [0.1, 0.3, 0.5],
    levelMeaning: "share of barangay-weeks with no survey",
    apply(d, level, rng) {
      const c = cloneSim(d);
      for (let i = 0; i < c.surveys.length; i++) {
        if (rng() < level) {
          c.surveys[i] = 0;
          c.containers[i] = 0;
          c.positive[i] = 0;
        }
      }
      return c;
    },
  },
  {
    name: "field_biased",
    label: "Field surveys only where cases were already seen",
    levels: [1],
    levelMeaning: "surveys kept only in barangays with a case in the previous two weeks",
    apply(d, _level, _rng) {
      const c = cloneSim(d);
      for (let b = 0; b < c.barangays; b++) {
        for (let w = 0; w < c.weeks; w++) {
          const seen = (w >= 1 ? weeklyCases(d, b, w - 1) : 0) + (w >= 2 ? weeklyCases(d, b, w - 2) : 0);
          if (seen === 0) {
            const i = b * c.weeks + w;
            c.surveys[i] = 0;
            c.containers[i] = 0;
            c.positive[i] = 0;
          }
        }
      }
      return c;
    },
  },
  {
    name: "cases",
    label: "Case reports missing",
    levels: [0.1, 0.3, 0.5],
    levelMeaning: "share of barangay-weeks with no case report (counted as zero)",
    apply(d, level, rng) {
      const c = cloneSim(d);
      const maxPuroks = c.cases.length / (c.barangays * c.weeks);
      for (let b = 0; b < c.barangays; b++) {
        for (let w = 0; w < c.weeks; w++) {
          if (rng() < level) for (let p = 0; p < maxPuroks; p++) c.cases[(b * c.weeks + w) * maxPuroks + p] = 0;
        }
      }
      return c;
    },
  },
  {
    name: "spam",
    label: "Spam in household reports",
    levels: [0.05, 0.1, 0.2],
    levelMeaning: "share of barangays flooded with fake 'yes' answers and breeding reports",
    apply(d, level, rng) {
      const c = cloneSim(d);
      for (let b = 0; b < c.barangays; b++) {
        if (rng() >= level) continue;
        for (let day = 0; day < c.days; day++) {
          const i = b * c.days + day;
          c.answersTotal[i] = Math.min(65535, c.answersTotal[i] * 5);
          c.answersYes[i] = c.answersTotal[i];
          c.reportsTotal[i] = Math.min(65535, c.reportsTotal[i] * 5);
          c.reportsWithBreeding[i] = c.reportsTotal[i];
        }
      }
      return c;
    },
  },
];

