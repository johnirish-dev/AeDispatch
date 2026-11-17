import { randomBytes } from "node:crypto";
import type { Db } from "../connection";
import { hashToken } from "../security";

export interface StaffUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  passwordHash: string;
}

export interface Bhw {
  id: number;
  displayName: string;
  barangayId: number;
  teamLabel: string | null;
}

const now = () => new Date().toISOString();

export function createStaff(
  db: Db,
  u: { username: string; displayName: string; passwordHash: string },
  at: string = now(),
): number {
  const info = db
    .prepare(
      `INSERT INTO staff_user (username, display_name, role, password_hash, created_at, updated_at)
       VALUES (?, ?, 'officer', ?, ?, ?)`,
    )
    .run(u.username, u.displayName, u.passwordHash, at, at);
  return Number(info.lastInsertRowid);
}

export function findStaffByUsername(db: Db, username: string): StaffUser | undefined {
  const r = db.prepare("SELECT * FROM staff_user WHERE username = ?").get(username) as
    | { id: number; username: string; display_name: string; role: string; password_hash: string }
    | undefined;
  return r
    ? { id: r.id, username: r.username, displayName: r.display_name, role: r.role, passwordHash: r.password_hash }
    : undefined;
}

export function createBhw(
  db: Db,
  b: { displayName: string; barangayId: number; teamLabel?: string; tokenHash?: string },
  at: string = now(),
): number {
  const info = db
    .prepare(
      `INSERT INTO bhw (display_name, barangay_id, team_label, access_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    // The per-person token is not used any more (the barangay has the token); the column still needs a unique value.
    .run(b.displayName, b.barangayId, b.teamLabel ?? null, b.tokenHash ?? hashToken(randomBytes(16).toString("hex")), at, at);
  return Number(info.lastInsertRowid);
}

function toBhw(r: { id: number; display_name: string; barangay_id: number; team_label: string | null }): Bhw {
  return { id: r.id, displayName: r.display_name, barangayId: r.barangay_id, teamLabel: r.team_label };
}

/** Gives the barangay its access token (stored as a hash). Replaces an earlier one. */
export function setBarangayToken(db: Db, barangayId: number, tokenHash: string, at: string = now()): void {
  db.prepare(
    `INSERT INTO barangay_access (barangay_id, access_token_hash, created_at) VALUES (?, ?, ?)
     ON CONFLICT(barangay_id) DO UPDATE SET access_token_hash = excluded.access_token_hash, created_at = excluded.created_at`,
  ).run(barangayId, tokenHash, at);
}

/** The barangay a token opens, if any. */
export function findBarangayIdByTokenHash(db: Db, tokenHash: string): number | undefined {
  const r = db.prepare("SELECT barangay_id FROM barangay_access WHERE access_token_hash = ?").get(tokenHash) as { barangay_id: number } | undefined;
  return r?.barangay_id;
}

/** Whether this barangay's token is exactly this hash (the Demo tools page uses it to show only working links). */
export function barangayTokenMatches(db: Db, barangayId: number, tokenHash: string): boolean {
  return db.prepare("SELECT 1 AS ok FROM barangay_access WHERE barangay_id = ? AND access_token_hash = ?").get(barangayId, tokenHash) !== undefined;
}

export function getBhw(db: Db, id: number): Bhw | undefined {
  const r = db.prepare("SELECT * FROM bhw WHERE id = ?").get(id) as { id: number; display_name: string; barangay_id: number; team_label: string | null } | undefined;
  return r ? toBhw(r) : undefined;
}

export function listBhwsOfBarangay(db: Db, barangayId: number): Bhw[] {
  const rows = db.prepare("SELECT * FROM bhw WHERE barangay_id = ? ORDER BY display_name").all(barangayId) as {
    id: number;
    display_name: string;
    barangay_id: number;
    team_label: string | null;
  }[];
  return rows.map(toBhw);
}

export function listBhws(db: Db): Bhw[] {
  const rows = db.prepare("SELECT * FROM bhw ORDER BY id").all() as {
    id: number;
    display_name: string;
    barangay_id: number;
    team_label: string | null;
  }[];
  return rows.map(toBhw);
}

/** A resident is anonymous: only the barangay they chose is known. */
export function getResident(db: Db, id: number): { id: number; barangayId: number } | undefined {
  const r = db.prepare("SELECT id, barangay_id FROM resident WHERE id = ?").get(id) as
    | { id: number; barangay_id: number }
    | undefined;
  return r ? { id: r.id, barangayId: r.barangay_id } : undefined;
}
