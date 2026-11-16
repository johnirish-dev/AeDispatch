// Residents sign in with a mobile number and a one-time PIN, only to send a household report.
// The SMS is simulated: the PIN is handed back to the page, which shows it as a "demo SMS".
//
//   - only a salted hash of the number is stored (never the number itself);
//   - only a salted hash of the PIN is stored;
//   - a PIN is valid for 5 minutes and allows 3 tries;
//   - a new PIN can be asked for after a short wait.
//
// Time comes from the ranking clock, so tests can move it.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/connection";
import { getBarangay } from "../db/repositories/barangayRepo";
import { hashPhone } from "../db/security";
import { AppError } from "../errors";
import type { RankingService } from "./ranking";

export const PIN_TTL_SECONDS = 300;
export const PIN_MAX_TRIES = 3;
export const PIN_RESEND_SECONDS = 30;

export type VerifyResult =
  | { ok: true; residentId: number }
  | { ok: false; reason: "wrong" | "expired" | "tooMany"; triesLeft: number };

interface Challenge {
  id: number;
  code_hash: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

/** The 10 digits of a Philippine mobile number without the +63 (it starts with 9). */
export function mobileDigits(input: unknown): string {
  const digits = typeof input === "string" ? input.replace(/\D/g, "") : "";
  if (!/^9\d{9}$/.test(digits)) throw new AppError(400, "Enter a 10-digit mobile number that starts with 9.");
  return digits;
}

export class ResidentAuth {
  constructor(
    private readonly db: Db,
    private readonly ranking: RankingService,
    private readonly salt: string,
  ) {}

  private codeHash(phoneHash: string, pin: string): string {
    return createHmac("sha256", this.salt).update(`pin:${phoneHash}:${pin}`).digest("hex");
  }

  private latestChallenge(phoneHash: string): Challenge | undefined {
    return this.db
      .prepare(
        "SELECT id, code_hash, expires_at, attempts, created_at FROM otp_challenge WHERE phone_hash = ? ORDER BY id DESC LIMIT 1",
      )
      .get(phoneHash) as Challenge | undefined;
  }

  /** Makes a PIN for this number. It is returned only because the SMS is simulated. */
  sendPin(phone: unknown): { pin: string; expiresInSeconds: number } {
    const phoneHash = hashPhone(mobileDigits(phone), this.salt);
    const now = this.ranking.now();

    const last = this.latestChallenge(phoneHash);
    if (last && now.getTime() - Date.parse(last.created_at) < PIN_RESEND_SECONDS * 1000) {
      throw new AppError(429, "Please wait a moment before asking for a new PIN.");
    }

    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM otp_challenge WHERE phone_hash = ?").run(phoneHash);
      this.db
        .prepare("INSERT INTO otp_challenge (phone_hash, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(
          phoneHash,
          this.codeHash(phoneHash, pin),
          new Date(now.getTime() + PIN_TTL_SECONDS * 1000).toISOString(),
          now.toISOString(),
        );
    })();
    return { pin, expiresInSeconds: PIN_TTL_SECONDS };
  }

  /**
   * Checks the PIN. A wrong, expired or used-up PIN is an expected answer, not an error, so the
   * page can explain it. On success the resident is created (or moved to this barangay) and returned.
   */
  verifyPin(phone: unknown, pin: unknown, barangayId: number): VerifyResult {
    const phoneHash = hashPhone(mobileDigits(phone), this.salt);
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) throw new AppError(400, "The PIN has 6 digits.");
    if (!getBarangay(this.db, barangayId)) throw new AppError(404, "Barangay not found.");

    const now = this.ranking.now();
    const challenge = this.latestChallenge(phoneHash);
    if (!challenge) return { ok: false, reason: "expired", triesLeft: 0 };
    if (Date.parse(challenge.expires_at) <= now.getTime()) {
      this.db.prepare("DELETE FROM otp_challenge WHERE id = ?").run(challenge.id);
      return { ok: false, reason: "expired", triesLeft: 0 };
    }
    if (challenge.attempts >= PIN_MAX_TRIES) return { ok: false, reason: "tooMany", triesLeft: 0 };

    const expected = Buffer.from(challenge.code_hash, "hex");
    const given = Buffer.from(this.codeHash(phoneHash, pin), "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const attempts = challenge.attempts + 1;
      this.db.prepare("UPDATE otp_challenge SET attempts = ? WHERE id = ?").run(attempts, challenge.id);
      const triesLeft = PIN_MAX_TRIES - attempts;
      return { ok: false, reason: triesLeft > 0 ? "wrong" : "tooMany", triesLeft: Math.max(0, triesLeft) };
    }

    const residentId = this.db.transaction(() => {
      this.db.prepare("DELETE FROM otp_challenge WHERE phone_hash = ?").run(phoneHash);
      const existing = this.db.prepare("SELECT id FROM resident WHERE phone_hash = ?").get(phoneHash) as { id: number } | undefined;
      if (existing) {
        this.db.prepare("UPDATE resident SET barangay_id = ? WHERE id = ?").run(barangayId, existing.id);
        return existing.id;
      }
      const stamp = now.toISOString();
      const info = this.db
        .prepare("INSERT INTO resident (phone_hash, barangay_id, consent_at, created_at) VALUES (?, ?, ?, ?)")
        .run(phoneHash, barangayId, stamp, stamp);
      return Number(info.lastInsertRowid);
    })();
    return { ok: true, residentId };
  }
}
