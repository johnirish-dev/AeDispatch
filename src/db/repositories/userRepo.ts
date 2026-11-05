import type { Db } from "../connection";

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
  b: { displayName: string; barangayId: number; teamLabel?: string; tokenHash: string },
  at: string = now(),
): number {
  const info = db
    .prepare(
      `INSERT INTO bhw (display_name, barangay_id, team_label, access_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(b.displayName, b.barangayId, b.teamLabel ?? null, b.tokenHash, at, at);
  return Number(info.lastInsertRowid);
}

function toBhw(r: { id: number; display_name: string; barangay_id: number; team_label: string | null }): Bhw {
  return { id: r.id, displayName: r.display_name, barangayId: r.barangay_id, teamLabel: r.team_label };
}

export function findBhwByTokenHash(db: Db, tokenHash: string): Bhw | undefined {
  const r = db.prepare("SELECT * FROM bhw WHERE access_token_hash = ?").get(tokenHash) as
    | { id: number; display_name: string; barangay_id: number; team_label: string | null }
    | undefined;
  return r ? toBhw(r) : undefined;
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
