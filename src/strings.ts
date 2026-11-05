// Text shown to people, kept in one place so Filipino can be added later (NFR-8).

import type { RiskLevel } from "./algorithms/risk";

const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "LOW",
  moderate: "MODERATE",
  elevated: "ELEVATED",
  high: "HIGH",
};

export interface AlertWhy {
  meanTempC: number | null;
  rainDays: number;
  rainDaysWindow: number;
}

/**
 * The resident alert: risk level, a short weather reason and what to do.
 * It never contains case counts or locations (RA 10173, REQ-1.2).
 */
export function alertMessage(level: RiskLevel, why: AlertWhy): string {
  const parts = [`Dengue risk in your barangay is now ${LEVEL_LABEL[level]}.`];
  if (why.meanTempC !== null) {
    const rain = why.rainDays > 0 ? `, rain on ${why.rainDays} of the last ${why.rainDaysWindow} days` : "";
    parts.push(`Recent weather (about ${Math.round(why.meanTempC)} °C on average${rain}) favors mosquito breeding.`);
  }
  parts.push("Check your home today: empty or cover containers with standing water and clear clogged gutters.");
  return parts.join(" ");
}
