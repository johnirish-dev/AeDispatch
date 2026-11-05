import type { Db } from "../connection";

export interface NewScore {
  barangayId: number;
  computedAt: string;
  /** Threat score in [0, 1]. */
  score: number;
  w: number;
  c: number;
  s: number;
  f: number;
  h: number;
  weightsUsed: unknown;
  densityFactor: number;
  rawSummary: unknown;
  paramsVersion: number;
}

export interface ScoreRow extends Omit<NewScore, "weightsUsed" | "rawSummary"> {
  id: number;
  weightsUsed: unknown;
  rawSummary: unknown;
}

interface RawScore {
  id: number;
  barangay_id: number;
  computed_at: string;
  score: number;
  w: number;
  c: number;
  s: number;
  f: number;
  h: number;
  weights_used: string;
  density_factor: number;
  raw_summary: string;
  params_version: number;
}

function toRow(r: RawScore): ScoreRow {
  return {
    id: r.id,
    barangayId: r.barangay_id,
    computedAt: r.computed_at,
    score: r.score,
    w: r.w,
    c: r.c,
    s: r.s,
    f: r.f,
    h: r.h,
    weightsUsed: JSON.parse(r.weights_used),
    densityFactor: r.density_factor,
    rawSummary: JSON.parse(r.raw_summary),
    paramsVersion: r.params_version,
  };
}

export function insertScore(db: Db, r: NewScore): number {
  const info = db
    .prepare(
      `INSERT INTO threat_score
        (barangay_id, computed_at, score, w, c, s, f, h, weights_used, density_factor, raw_summary, params_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.barangayId,
      r.computedAt,
      r.score,
      r.w,
      r.c,
      r.s,
      r.f,
      r.h,
      JSON.stringify(r.weightsUsed),
      r.densityFactor,
      JSON.stringify(r.rawSummary),
      r.paramsVersion,
      r.computedAt,
    );
  return Number(info.lastInsertRowid);
}

export function latestScoreFor(db: Db, barangayId: number): ScoreRow | undefined {
  const r = db
    .prepare("SELECT * FROM threat_score WHERE barangay_id = ? ORDER BY computed_at DESC, id DESC LIMIT 1")
    .get(barangayId) as RawScore | undefined;
  return r ? toRow(r) : undefined;
}

/** The newest score of every barangay. Used to rebuild the heap on server start. */
export function latestScores(db: Db): ScoreRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM threat_score t WHERE t.id = (
         SELECT id FROM threat_score WHERE barangay_id = t.barangay_id
         ORDER BY computed_at DESC, id DESC LIMIT 1
       ) ORDER BY t.barangay_id`,
    )
    .all() as RawScore[];
  return rows.map(toRow);
}

export function scoreHistory(db: Db, barangayId: number, limit = 30): ScoreRow[] {
  const rows = db
    .prepare("SELECT * FROM threat_score WHERE barangay_id = ? ORDER BY computed_at DESC, id DESC LIMIT ?")
    .all(barangayId, limit) as RawScore[];
  return rows.map(toRow);
}
