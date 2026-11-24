// Sign-in and the three access checks.
//
//   officer   -> a session cookie (login with the seeded password)
//   BHW       -> a token in the Authorization header (the QR link carries it)
//   resident  -> a session cookie from the PIN sign-in (built in Phase 8)
//
// Sessions are kept in memory, so a server restart signs people out. The cookie
// holds a random session id plus an HMAC of it, so it cannot be forged.
// SameSite=Lax keeps the cookie off cross-site POSTs.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import type { Db } from "../db/connection";
import { findBarangayIdByTokenHash, findStaffByUsername } from "../db/repositories/userRepo";
import { hashPassword, hashToken, verifyPassword } from "../db/security";
import { AppError } from "../errors";
import * as v from "../validate";

export const OFFICER_COOKIE = "aed_officer";
export const RESIDENT_COOKIE = "aed_resident";
const SESSION_HOURS = 8;
/** After the officer types the password again, editing or deleting a barangay is allowed for this long. */
export const CONFIRM_MINUTES = 5;
const MS_HOUR = 3_600_000;

export interface OfficerUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

interface Session {
  kind: "officer" | "resident";
  userId: number;
  user?: OfficerUser;
  expiresAt: number;
  /** Until when the officer's password was last confirmed (see `confirm`). */
  confirmedUntil?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      officer?: OfficerUser;
      /** The barangay the BHW access token opens. */
      bhwBarangayId?: number;
      residentId?: number;
    }
  }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly secret: string = randomBytes(32).toString("hex"),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private sign(id: string): string {
    return createHmac("sha256", this.secret).update(id).digest("hex");
  }

  /** Starts a session and sets its cookie on the response. */
  start(res: Response, cookieName: string, session: Omit<Session, "expiresAt">): void {
    const id = randomBytes(24).toString("hex");
    const maxAgeMs = SESSION_HOURS * MS_HOUR;
    this.sessions.set(id, { ...session, expiresAt: this.clock().getTime() + maxAgeMs });
    res.append(
      "Set-Cookie",
      `${cookieName}=${id}.${this.sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeMs / 1000}`,
    );
  }

  /** The live session for this request's cookie, or undefined. */
  find(req: Request, cookieName: string, kind: Session["kind"]): Session | undefined {
    const raw = parseCookies(req.headers.cookie).get(cookieName);
    if (!raw) return undefined;
    const [id, mac] = raw.split(".");
    if (!id || !mac) return undefined;
    const expected = Buffer.from(this.sign(id), "hex");
    const given = Buffer.from(mac, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;

    const session = this.sessions.get(id);
    if (!session || session.kind !== kind) return undefined;
    if (session.expiresAt <= this.clock().getTime()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  /** Marks the officer's session as having just proved the password again; it counts for CONFIRM_MINUTES. */
  confirm(req: Request): number | undefined {
    const session = this.find(req, OFFICER_COOKIE, "officer");
    if (!session) return undefined;
    session.confirmedUntil = this.clock().getTime() + CONFIRM_MINUTES * 60_000;
    return CONFIRM_MINUTES;
  }

  isConfirmed(req: Request): boolean {
    const until = this.find(req, OFFICER_COOKIE, "officer")?.confirmedUntil;
    return until !== undefined && until > this.clock().getTime();
  }

  /** Ends the session of this request's cookie and clears the cookie. */
  end(req: Request, res: Response, cookieName: string): void {
    const raw = parseCookies(req.headers.cookie).get(cookieName);
    if (raw) this.sessions.delete(raw.split(".")[0]);
    res.append("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  /** For Phase 8: signs a resident in after the PIN check. */
  startResident(res: Response, residentId: number): void {
    this.start(res, RESIDENT_COOKIE, { kind: "resident", userId: residentId });
  }
}

// ---- access checks (middleware) ----------------------------------------------

export function requireOfficer(sessions: SessionManager): RequestHandler {
  return (req, _res, next) => {
    const session = sessions.find(req, OFFICER_COOKIE, "officer");
    if (!session?.user) return next(new AppError(401, "Sign in as a health officer."));
    req.officer = session.user;
    next();
  };
}

/** For changes that need the password typed again (editing or deleting a barangay): 403 until the officer has confirmed it. */
export function requireRecentPassword(sessions: SessionManager): RequestHandler {
  return (req, _res, next) => {
    if (!sessions.isConfirmed(req)) return next(new AppError(403, "Enter your password to manage a barangay.", { needsPassword: true }));
    next();
  };
}

/** The BHW token comes in the header `Authorization: Bearer <token>`. */
export function requireBhw(db: Db): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const barangayId = token === "" ? undefined : findBarangayIdByTokenHash(db, hashToken(token));
    if (barangayId === undefined) return next(new AppError(401, "This link is not valid. Ask the health office for a new one."));
    req.bhwBarangayId = barangayId;
    next();
  };
}

export function requireResident(sessions: SessionManager): RequestHandler {
  return (req, _res, next) => {
    const session = sessions.find(req, RESIDENT_COOKIE, "resident");
    if (!session) return next(new AppError(401, "Sign in with your phone number first."));
    req.residentId = session.userId;
    next();
  };
}

// ---- /api/auth ---------------------------------------------------------------

// Checked against when the username does not exist, so a wrong user and a wrong
// password take the same time and give the same answer.
const DUMMY_HASH = hashPassword("not-a-real-password");

export function authRoutes(db: Db, sessions: SessionManager): Router {
  const router = Router();

  router.post("/login", (req, res) => {
    const body = v.bodyObject(req.body);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username === "" || password === "") throw new AppError(400, "Enter a username and a password.");

    const staff = findStaffByUsername(db, username);
    const ok = verifyPassword(password, staff ? staff.passwordHash : DUMMY_HASH);
    if (!staff || !ok) throw new AppError(401, "Wrong username or password.");

    const user: OfficerUser = { id: staff.id, username: staff.username, displayName: staff.displayName, role: staff.role };
    sessions.start(res, OFFICER_COOKIE, { kind: "officer", userId: staff.id, user });
    res.json({ user });
  });

  // The signed-in officer types the password again. A wrong one is a 403 (not a 401, which would send the page to the sign-in).
  router.post("/confirm", requireOfficer(sessions), (req, res) => {
    const body = v.bodyObject(req.body);
    const password = typeof body.password === "string" ? body.password : "";
    if (password === "") throw new AppError(400, "Enter your password.");
    const staff = findStaffByUsername(db, req.officer!.username);
    if (!staff || !verifyPassword(password, staff.passwordHash)) throw new AppError(403, "Wrong password.");
    res.json({ ok: true, minutes: sessions.confirm(req) });
  });

  router.post("/logout", (req, res) => {
    sessions.end(req, res, OFFICER_COOKIE);
    res.json({ ok: true });
  });

  router.get("/me", requireOfficer(sessions), (req, res) => {
    res.json({ user: req.officer });
  });

  return router;
}
