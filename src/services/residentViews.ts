// What the resident screens may see: the barangays, and for one barangay its risk LEVEL and its
// alerts. Never a score, a case count or a purok: residents learn only how worried to be.

import { riskLevel, type RiskLevel } from "../algorithms/risk";
import type { Db } from "../db/connection";
import { getBarangay, listBarangays } from "../db/repositories/barangayRepo";
import { getActiveParameters } from "../db/repositories/parameterRepo";
import { latestScoreFor } from "../db/repositories/scoreRepo";
import { listAlerts } from "../db/repositories/workflowRepo";
import { AppError } from "../errors";

export interface ResidentBarangay {
  id: number;
  name: string;
  municipality: string;
}

export interface ResidentBarangayView extends ResidentBarangay {
  /** null only if the barangay has not been scored yet. */
  level: RiskLevel | null;
  alerts: { level: RiskLevel; issuedAt: string; message: string }[];
}

export class ResidentViews {
  constructor(private readonly db: Db) {}

  barangays(): ResidentBarangay[] {
    return listBarangays(this.db).map((b) => ({ id: b.id, name: b.name, municipality: b.municipality }));
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
    };
  }
}
