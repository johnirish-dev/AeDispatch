import type { Db } from "../connection";

export interface PurokRow {
  id: number;
  barangayId: number;
  name: string;
}

export interface BarangayRow {
  id: number;
  name: string;
  municipality: string;
  population: number;
  areaKm2: number;
  densityPerKm2: number;
  puroks: PurokRow[];
}

interface RawBarangay {
  id: number;
  name: string;
  municipality: string;
  population: number;
  area_km2: number;
}

const now = () => new Date().toISOString();

function puroksOf(db: Db, barangayId: number): PurokRow[] {
  const rows = db
    .prepare("SELECT id, barangay_id, name FROM purok WHERE barangay_id = ? ORDER BY id")
    .all(barangayId) as { id: number; barangay_id: number; name: string }[];
  return rows.map((r) => ({ id: r.id, barangayId: r.barangay_id, name: r.name }));
}

function toRow(db: Db, r: RawBarangay): BarangayRow {
  return {
    id: r.id,
    name: r.name,
    municipality: r.municipality,
    population: r.population,
    areaKm2: r.area_km2,
    densityPerKm2: r.population / r.area_km2,
    puroks: puroksOf(db, r.id),
  };
}

export function listBarangays(db: Db): BarangayRow[] {
  const rows = db.prepare("SELECT * FROM barangay ORDER BY id").all() as RawBarangay[];
  return rows.map((r) => toRow(db, r));
}

export function getBarangay(db: Db, id: number): BarangayRow | undefined {
  const r = db.prepare("SELECT * FROM barangay WHERE id = ?").get(id) as RawBarangay | undefined;
  return r ? toRow(db, r) : undefined;
}

export interface NewBarangay {
  name: string;
  municipality: string;
  population: number;
  areaKm2: number;
  puroks: string[];
}

export function createBarangay(db: Db, input: NewBarangay, at: string = now()): number {
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO barangay (name, municipality, population, area_km2, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.name, input.municipality, input.population, input.areaKm2, at, at);
    const id = Number(info.lastInsertRowid);
    const addPurok = db.prepare("INSERT INTO purok (barangay_id, name, created_at) VALUES (?, ?, ?)");
    for (const name of input.puroks) addPurok.run(id, name, at);
    return id;
  })();
}

export function updateBarangay(
  db: Db,
  id: number,
  changes: Partial<Pick<NewBarangay, "name" | "municipality" | "population" | "areaKm2">>,
  at: string = now(),
): boolean {
  const current = db.prepare("SELECT * FROM barangay WHERE id = ?").get(id) as RawBarangay | undefined;
  if (!current) return false;
  db.prepare(
    `UPDATE barangay SET name = ?, municipality = ?, population = ?, area_km2 = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    changes.name ?? current.name,
    changes.municipality ?? current.municipality,
    changes.population ?? current.population,
    changes.areaKm2 ?? current.area_km2,
    at,
    id,
  );
  return true;
}

export function addPurok(db: Db, barangayId: number, name: string, at: string = now()): number {
  const info = db
    .prepare("INSERT INTO purok (barangay_id, name, created_at) VALUES (?, ?, ?)")
    .run(barangayId, name, at);
  return Number(info.lastInsertRowid);
}

/** Deleting a barangay also deletes everything that belongs to it. */
export function deleteBarangay(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM barangay WHERE id = ?").run(id).changes > 0;
}

/** density / highest density, in (0, 1]. The scoring formula needs this. */
export function densityRatios(db: Db): Map<number, number> {
  const all = listBarangays(db);
  const max = Math.max(0, ...all.map((b) => b.densityPerKm2));
  return new Map(all.map((b) => [b.id, max > 0 ? b.densityPerKm2 / max : 0]));
}

export function getPurok(db: Db, id: number): PurokRow | undefined {
  const r = db.prepare("SELECT id, barangay_id, name FROM purok WHERE id = ?").get(id) as
    | { id: number; barangay_id: number; name: string }
    | undefined;
  return r ? { id: r.id, barangayId: r.barangay_id, name: r.name } : undefined;
}

/**
 * Makes the barangay's purok list equal `names`: missing names are added and
 * names that are no longer listed are deleted, together with that purok's case
 * records (cascade). Matching ignores case and extra spaces.
 */
export function setPuroks(
  db: Db,
  barangayId: number,
  names: string[],
  at: string = now(),
): { added: string[]; removed: string[] } {
  const key = (s: string) => s.trim().replace(/s+/g, " ").toLowerCase();
  const wanted = new Map(names.map((n) => [key(n), n.trim().replace(/s+/g, " ")]));
  const current = puroksOf(db, barangayId);
  const have = new Set(current.map((p) => key(p.name)));

  const added: string[] = [];
  const removed: string[] = [];
  db.transaction(() => {
    for (const p of current) {
      if (!wanted.has(key(p.name))) {
        db.prepare("DELETE FROM purok WHERE id = ?").run(p.id);
        removed.push(p.name);
      }
    }
    for (const [k, name] of wanted) {
      if (!have.has(k)) {
        db.prepare("INSERT INTO purok (barangay_id, name, created_at) VALUES (?, ?, ?)").run(barangayId, name, at);
        added.push(name);
      }
    }
  })();
  return { added, removed };
}
