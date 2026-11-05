// Hashing helpers built on Node's own crypto, so no extra packages are needed.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** "scrypt$<salt>$<hash>". The salt is random unless one is given (the seed does that). */
export function hashPassword(password: string, saltHex: string = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32).toString("hex");
  return `scrypt$${saltHex}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** BHW access tokens are stored only as a SHA-256 hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

/** Phone numbers are stored only as a salted HMAC of their digits. */
export function hashPhone(phone: string, salt: string): string {
  return createHmac("sha256", salt).update(phone.replace(/\D/g, "")).digest("hex");
}
