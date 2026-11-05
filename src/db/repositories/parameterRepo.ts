import type { ModelParameters } from "../../algorithms/parameters";
import type { Db } from "../connection";

interface RawParameters {
  version: number;
  weights: string;
  constants: string;
}

function toParameters(r: RawParameters): ModelParameters {
  return {
    version: r.version,
    weights: JSON.parse(r.weights),
    constants: JSON.parse(r.constants),
  } as ModelParameters;
}

export function getActiveParameters(db: Db): ModelParameters {
  const r = db
    .prepare("SELECT version, weights, constants FROM model_parameters WHERE is_active = 1")
    .get() as RawParameters | undefined;
  if (!r) throw new Error("No active model parameters. Run `npm run seed`.");
  return toParameters(r);
}

export function getParameters(db: Db, version: number): ModelParameters | undefined {
  const r = db
    .prepare("SELECT version, weights, constants FROM model_parameters WHERE version = ?")
    .get(version) as RawParameters | undefined;
  return r ? toParameters(r) : undefined;
}

/** Saves a parameter set. The version number is given by the caller; see nextParameterVersion. */
export function insertParameters(
  db: Db,
  p: ModelParameters,
  opts: { note?: string; activate?: boolean; at?: string } = {},
): void {
  db.transaction(() => {
    if (opts.activate) db.prepare("UPDATE model_parameters SET is_active = 0 WHERE is_active = 1").run();
    db.prepare(
      `INSERT INTO model_parameters (version, weights, constants, note, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      p.version,
      JSON.stringify(p.weights),
      JSON.stringify(p.constants),
      opts.note ?? null,
      opts.activate ? 1 : 0,
      opts.at ?? new Date().toISOString(),
    );
  })();
}

export function nextParameterVersion(db: Db): number {
  const r = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM model_parameters").get() as { v: number };
  return r.v;
}

export function listParameterVersions(db: Db) {
  return db
    .prepare("SELECT version, note, is_active AS isActive, created_at AS createdAt FROM model_parameters ORDER BY version")
    .all() as { version: number; note: string | null; isActive: number; createdAt: string }[];
}
