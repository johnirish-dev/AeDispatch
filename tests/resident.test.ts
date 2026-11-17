import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrate";
import { MIGRATIONS } from "../src/db/migrations";
import { addAnonymousAnswer, addSymptomCheck, answerTotals } from "../src/db/repositories/signalRepo";
import { anonymousDailyCap } from "../src/services/changes";
import { PIN_MAX_TRIES, PIN_RESEND_SECONDS, PIN_TTL_SECONDS } from "../src/services/residentAuth";
import { ANCHOR, Api, startApi } from "./apiHelpers";
import { count } from "./helpers";

// The resident side: the risk level for a barangay, the daily question and the symptom check (no
// sign-in), and the household report (PIN sign-in).

const PHONE = "9123456789";
const wrongPin = (pin: string) => (pin === "000000" ? "111111" : "000000");

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((x) => keysOf(x, found));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      found.push(k);
      keysOf(v, found);
    }
  }
  return found;
}

describe("migration 002", () => {
  it("adds the anonymous answer table to a database that only has the first migration", () => {
    const db = openDatabase(":memory:");
    runMigrations(db, [MIGRATIONS[0]]);
    expect(() => count(db, "anonymous_answer_count")).toThrow();
    expect(runMigrations(db)).toEqual(["002_anonymous_answers", "003_barangay_access"]);
    expect(count(db, "anonymous_answer_count")).toBe(0);
  });
});

describe("resident routes", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  const barangayId = (name: string) => (api.db.prepare("SELECT id FROM barangay WHERE name = ?").get(name) as { id: number }).id;

  describe("reading", () => {
    it("lists the barangays without any sign-in, with only id, name and municipality", async () => {
      const res = await api.client().get("/api/resident/barangays");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(8);
      expect(Object.keys(res.body[0]).sort()).toEqual(["id", "municipality", "name"]);
    });

    it("gives a barangay's risk level and alerts, and never a score, a case count or a purok", async () => {
      const res = await api.client().get(`/api/resident/barangays/${barangayId("Bascaran")}`);
      expect(res.status).toBe(200);
      expect(["low", "moderate", "elevated", "high"]).toContain(res.body.level);
      // The seeded Bascaran has a confirmed cluster: none of that may leak out.
      const keys = keysOf(res.body).map((k) => k.toLowerCase());
      for (const forbidden of ["score", "score100", "cases", "casecount", "confirmedcases", "purok", "puroks", "weights", "tier", "breakdown"]) {
        expect(keys, forbidden).not.toContain(forbidden);
      }
      for (const a of res.body.alerts) expect(a.message).not.toMatch(/\bcases?\b|purok/i);
    });

    it("answers 404 for an unknown barangay and 400 for a bad id", async () => {
      expect((await api.client().get("/api/resident/barangays/9999")).status).toBe(404);
      expect((await api.client().get("/api/resident/barangays/abc")).status).toBe(400);
    });
  });

  describe("the daily question (no sign-in)", () => {
    it("adds to the barangay's totals and re-scores it, without storing a person", async () => {
      const id = barangayId("Busay");
      const before = answerTotals(api.db, id, ANCHOR, ANCHOR);
      const residentsBefore = count(api.db, "resident");
      api.lines.length = 0;
      const res = await api.client().post(`/api/resident/barangays/${id}/daily-answer`, { answer: "yes" });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ saved: true });
      await api.client().post(`/api/resident/barangays/${id}/daily-answer`, { answer: "no" });

      const after = answerTotals(api.db, id, ANCHOR, ANCHOR);
      expect(after.total).toBe(before.total + 2);
      expect(after.yes).toBe(before.yes + 1);
      expect(api.lines.some((l) => l.includes("(daily answer)"))).toBe(true);
      expect(count(api.db, "resident")).toBe(residentsBefore); // no person is created for an answer
    });

    it("refuses an answer it does not understand, and an unknown barangay", async () => {
      const id = barangayId("Busay");
      expect((await api.client().post(`/api/resident/barangays/${id}/daily-answer`, { answer: "maybe" })).status).toBe(400);
      expect((await api.client().post("/api/resident/barangays/9999/daily-answer", { answer: "yes" })).status).toBe(404);
    });

    it("stops one barangay from adding more than the daily cap", async () => {
      const id = barangayId("Bañag");
      const population = (api.db.prepare("SELECT population FROM barangay WHERE id = ?").get(id) as { population: number }).population;
      const cap = anonymousDailyCap(population);
      for (let i = 0; i < cap - 1; i++) addAnonymousAnswer(api.db, { barangayId: id, date: ANCHOR, answer: "no" });

      const last = await api.client().post(`/api/resident/barangays/${id}/daily-answer`, { answer: "no" });
      expect(last.status).toBe(201);
      const over = await api.client().post(`/api/resident/barangays/${id}/daily-answer`, { answer: "no" });
      expect(over.status).toBe(429);
      expect(over.body.error).toMatch(/limit/i);
    });
  });

  describe("the symptom check (no sign-in)", () => {
    it("adds one anonymous count and keeps no result", async () => {
      const id = barangayId("Mabini");
      const row = () => api.db.prepare("SELECT checks, checks_with_warning_signs AS warning FROM symptom_count WHERE barangay_id = ? AND date = ?").get(id, ANCHOR) as { checks: number; warning: number } | undefined;
      const before = row() ?? { checks: 0, warning: 0 };
      const res = await api.client().post(`/api/resident/barangays/${id}/symptom-check`, { warningSigns: true });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ saved: true });
      expect(row()).toEqual({ checks: before.checks + 1, warning: before.warning + 1 });
      expect((await api.client().post(`/api/resident/barangays/${id}/symptom-check`, { warningSigns: "yes" })).status).toBe(400);
    });

    it("also has a daily cap", async () => {
      const id = barangayId("Kilicao");
      const population = (api.db.prepare("SELECT population FROM barangay WHERE id = ?").get(id) as { population: number }).population;
      const cap = anonymousDailyCap(population);
      const existing = (api.db.prepare("SELECT checks FROM symptom_count WHERE barangay_id = ? AND date = ?").get(id, ANCHOR) as { checks: number } | undefined)?.checks ?? 0;
      for (let i = existing; i < cap; i++) addSymptomCheck(api.db, { barangayId: id, date: ANCHOR, warningSigns: false });
      expect((await api.client().post(`/api/resident/barangays/${id}/symptom-check`, { warningSigns: false })).status).toBe(429);
    });
  });

  describe("signing in with a PIN", () => {
    const bascaran = () => barangayId("Bascaran");

    it("refuses a number that is not a 10-digit mobile number starting with 9", async () => {
      for (const phone of ["812345678", "91234", "", "abcdefghij", 9123456789]) {
        expect((await api.client().post("/api/resident/auth/send-pin", { phone })).status, String(phone)).toBe(400);
      }
    });

    it("sends a 6-digit PIN valid for 5 minutes, and stores only hashes", async () => {
      const phone = "9170000001";
      const res = await api.client().post("/api/resident/auth/send-pin", { phone });
      expect(res.status).toBe(200);
      expect(res.body.pin).toMatch(/^\d{6}$/);
      expect(res.body.expiresInSeconds).toBe(PIN_TTL_SECONDS);

      const rows = api.db.prepare("SELECT phone_hash, code_hash, expires_at FROM otp_challenge").all() as { phone_hash: string; code_hash: string; expires_at: string }[];
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(phone);
      expect(dump).not.toContain(res.body.pin);
      expect(Date.parse(rows[rows.length - 1].expires_at) - api.clock().getTime()).toBe(PIN_TTL_SECONDS * 1000);
    });

    it("asks a number to wait before a second PIN, then allows it and replaces the first", async () => {
      const phone = "9170000002";
      const first = await api.client().post("/api/resident/auth/send-pin", { phone });
      const tooSoon = await api.client().post("/api/resident/auth/send-pin", { phone });
      expect(tooSoon.status).toBe(429);

      api.advance((PIN_RESEND_SECONDS + 1) * 1000);
      const second = await api.client().post("/api/resident/auth/send-pin", { phone });
      expect(second.status).toBe(200);

      // only the newest PIN counts
      if (first.body.pin !== second.body.pin) {
        const old = await api.client().post("/api/resident/auth/verify", { phone, pin: first.body.pin, barangayId: bascaran() });
        expect(old.body.ok).toBe(false);
      }
      const ok = await api.client().post("/api/resident/auth/verify", { phone, pin: second.body.pin, barangayId: bascaran() });
      expect(ok.body.ok).toBe(true);
    });

    it("gives 3 tries, then locks the PIN even for the right code", async () => {
      const phone = "9170000003";
      const sent = await api.client().post("/api/resident/auth/send-pin", { phone });
      const wrong = wrongPin(sent.body.pin);
      const verify = (pin: string) => api.client().post("/api/resident/auth/verify", { phone, pin, barangayId: bascaran() });

      expect((await verify(wrong)).body).toEqual({ ok: false, reason: "wrong", triesLeft: PIN_MAX_TRIES - 1 });
      expect((await verify(wrong)).body).toEqual({ ok: false, reason: "wrong", triesLeft: PIN_MAX_TRIES - 2 });
      expect((await verify(wrong)).body).toEqual({ ok: false, reason: "tooMany", triesLeft: 0 });
      expect((await verify(sent.body.pin)).body).toEqual({ ok: false, reason: "tooMany", triesLeft: 0 });
    });

    it("lets a PIN expire after 5 minutes, and treats an unknown number as expired", async () => {
      const phone = "9170000004";
      const sent = await api.client().post("/api/resident/auth/send-pin", { phone });
      api.advance((PIN_TTL_SECONDS + 1) * 1000);
      const late = await api.client().post("/api/resident/auth/verify", { phone, pin: sent.body.pin, barangayId: bascaran() });
      expect(late.body).toEqual({ ok: false, reason: "expired", triesLeft: 0 });

      const none = await api.client().post("/api/resident/auth/verify", { phone: "9170000099", pin: "123456", barangayId: bascaran() });
      expect(none.body.reason).toBe("expired");
    });

    it("checks the shape of the request", async () => {
      const phone = "9170000005";
      await api.client().post("/api/resident/auth/send-pin", { phone });
      expect((await api.client().post("/api/resident/auth/verify", { phone, pin: "12", barangayId: bascaran() })).status).toBe(400);
      expect((await api.client().post("/api/resident/auth/verify", { phone, pin: "123456", barangayId: 9999 })).status).toBe(404);
      expect((await api.client().post("/api/resident/auth/verify", { phone, pin: "123456" })).status).toBe(400);
    });

    it("signs in with the right PIN, starts a session, and keeps no phone number", async () => {
      const phone = "9170000006";
      const client = api.client();
      const sent = await client.post("/api/resident/auth/send-pin", { phone });
      const res = await client.post("/api/resident/auth/verify", { phone, pin: sent.body.pin, barangayId: bascaran() });
      expect(res.body).toEqual({ ok: true });
      expect(res.setCookie.some((c) => c.startsWith("aed_resident="))).toBe(true);
      expect((await client.get("/api/resident/me")).status).toBe(200);

      expect(JSON.stringify(api.db.prepare("SELECT * FROM resident").all())).not.toContain(phone);
      const stored = api.db.prepare("SELECT barangay_id FROM resident ORDER BY id DESC LIMIT 1").get() as { barangay_id: number };
      expect(stored.barangay_id).toBe(bascaran());
      // the used PIN is gone
      expect(JSON.stringify(api.db.prepare("SELECT * FROM otp_challenge").all())).not.toContain("9170000006");
    });

    it("recognises the same number again and moves it to the barangay chosen now", async () => {
      const phone = "9170000007";
      const signIn = async (barangay: number) => {
        const client = api.client();
        const sent = await client.post("/api/resident/auth/send-pin", { phone });
        const res = await client.post("/api/resident/auth/verify", { phone, pin: sent.body.pin, barangayId: barangay });
        expect(res.body.ok).toBe(true);
        api.advance((PIN_RESEND_SECONDS + 1) * 1000);
      };
      await signIn(barangayId("Busay"));
      const residents = count(api.db, "resident");
      await signIn(barangayId("Tagas"));
      expect(count(api.db, "resident")).toBe(residents);
      const row = api.db.prepare("SELECT barangay_id FROM resident ORDER BY id DESC LIMIT 1").get() as { barangay_id: number };
      expect(row.barangay_id).toBe(barangayId("Tagas"));
    });
  });

  describe("the household report", () => {
    const body = { standingWater: true, cloggedGutter: false, oldContainers: true, bitesIndoors: false };

    async function signedIn(phone: string, barangay: string) {
      const client = api.client();
      const sent = await client.post("/api/resident/auth/send-pin", { phone });
      await client.post("/api/resident/auth/verify", { phone, pin: sent.body.pin, barangayId: barangayId(barangay) });
      return client;
    }

    it("needs a sign-in", async () => {
      expect((await api.client().post("/api/resident/household-report", body)).status).toBe(401);
      expect((await api.client().get("/api/resident/me")).status).toBe(401);
    });

    it("saves the report for the barangay chosen at sign-in and re-scores it", async () => {
      const client = await signedIn("9170000008", "Sagpon");
      const before = count(api.db, "household_report");
      api.lines.length = 0;
      const res = await client.post("/api/resident/household-report", body);
      expect(res.status).toBe(201);
      expect(count(api.db, "household_report")).toBe(before + 1);
      const row = api.db.prepare("SELECT barangay_id, standing_water, clogged_gutter, old_containers FROM household_report ORDER BY id DESC LIMIT 1").get() as Record<string, number>;
      expect(row).toEqual({ barangay_id: barangayId("Sagpon"), standing_water: 1, clogged_gutter: 0, old_containers: 1 });
      expect(api.lines.some((l) => l.includes("(household report)"))).toBe(true);
    });

    it("refuses a report that is not true or false", async () => {
      const client = await signedIn("9170000009", "Sagpon");
      expect((await client.post("/api/resident/household-report", { ...body, standingWater: "yes" })).status).toBe(400);
    });

    it("stops working after sign-out", async () => {
      const client = await signedIn("9170000010", "Sagpon");
      expect((await client.post("/api/resident/household-report", body)).status).toBe(201);
      await client.post("/api/resident/auth/logout");
      expect((await client.post("/api/resident/household-report", body)).status).toBe(401);
    });
  });
});
