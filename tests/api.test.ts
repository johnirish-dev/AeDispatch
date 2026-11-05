import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESIDENT_COOKIE, SessionManager, requireResident } from "../src/api/auth";
import { createApp } from "../src/app";
import { listBarangays } from "../src/db/repositories/barangayRepo";
import { latestScoreFor } from "../src/db/repositories/scoreRepo";
import { DataChanges } from "../src/services/changes";
import { Decisions } from "../src/services/decisions";
import { RankingService } from "../src/services/ranking";
import { Api, ANCHOR, Client, startApi } from "./apiHelpers";
import { count, dataFile } from "./helpers";

// ---- helpers --------------------------------------------------------------------

type Row = { barangayId: number; name: string; score: number; score100: number; action: string; riskLevel: string; team: unknown; rank: number; isDispatchCandidate: boolean; trend: string; tier2: { unlocked: boolean; puroks: { purok: string; cases: number }[] }; factors: { key: string; index: number; weight: number; points: number }[] };

async function ranking(c: Client, k?: number) {
  const res = await c.get(`/api/officer/ranking${k === undefined ? "" : `?k=${k}`}`);
  expect(res.status).toBe(200);
  return res.body as { k: number; barangays: Row[]; summary: Record<string, unknown> };
}

const tokenFor = (api: Api, name: string) => api.bhwTokens.find((t) => t.name === name)!.token;

// ---- sign-in and access ---------------------------------------------------------

describe("officer sign-in", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  it("officer routes answer 401 without a session", async () => {
    for (const path of ["/api/officer/ranking", "/api/officer/barangays", "/api/officer/assignments", "/api/officer/events"]) {
      const res = await api.client().get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error).toMatch(/Sign in/);
    }
  });

  it("rejects a wrong password and an unknown user with the same answer", async () => {
    const wrong = await api.client().post("/api/auth/login", { username: "officer", password: "nope" });
    const unknown = await api.client().post("/api/auth/login", { username: "nobody", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.setCookie).toHaveLength(0);
  });

  it("asks for both fields", async () => {
    const res = await api.client().post("/api/auth/login", { username: "officer" });
    expect(res.status).toBe(400);
  });

  it("signs in with the seeded password and sets a safe cookie", async () => {
    const c = api.client();
    const res = await c.loginAsOfficer();
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: "officer", role: "officer" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.setCookie[0]).toMatch(/HttpOnly/);
    expect(res.setCookie[0]).toMatch(/SameSite=Lax/);
    expect((await c.get("/api/auth/me")).status).toBe(200);
    expect((await c.get("/api/officer/ranking")).status).toBe(200);
  });

  it("signs out", async () => {
    const c = await api.officer();
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    expect((await c.get("/api/officer/ranking")).status).toBe(401);
  });

  it("refuses a tampered cookie and one signed with another secret", async () => {
    const c = await api.officer();
    const tampered = api.client();
    tampered.cookie = c.cookie.slice(0, -1) + (c.cookie.endsWith("0") ? "1" : "0");
    expect((await tampered.get("/api/officer/ranking")).status).toBe(401);

    // a perfectly formed cookie, but signed by a server with a different secret
    const other = new SessionManager("another-secret", api.clock);
    let forged = "";
    other.start({ append: (_name: string, value: string) => (forged = value.split(";")[0]) } as never, "aed_officer", {
      kind: "officer",
      userId: 1,
      user: { id: 1, username: "officer", displayName: "x", role: "officer" },
    });
    expect(forged).toMatch(/^aed_officer=/);
    const stranger = api.client();
    stranger.cookie = forged;
    expect((await stranger.get("/api/officer/ranking")).status).toBe(401);
  });

  it("signs people out after 8 hours", async () => {
    const c = await api.officer();
    expect((await c.get("/api/officer/ranking")).status).toBe(200);
    api.advance(8 * 3_600_000 + 1000);
    expect((await c.get("/api/officer/ranking")).status).toBe(401);
  });
});

describe("BHW token and resident session", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  it("BHW routes need a valid token", async () => {
    expect((await api.client().get("/api/bhw/me")).status).toBe(401);
    expect((await api.client().withBhwToken("not-a-token").get("/api/bhw/me")).status).toBe(401);
    const res = await api.client().withBhwToken(tokenFor(api, "Jun M. Santos")).get("/api/bhw/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Jun M. Santos", team: "Team B", barangay: { name: "Peñafrancia" } });
    expect(res.body.puroks.length).toBeGreaterThan(0);
  });

  it("an officer session does not open BHW routes, and a BHW token does not open officer routes", async () => {
    const officer = await api.officer();
    expect((await officer.get("/api/bhw/me")).status).toBe(401);
    const bhw = api.client().withBhwToken(tokenFor(api, "Jun M. Santos"));
    expect((await bhw.get("/api/officer/ranking")).status).toBe(401);
  });

  it("a BHW sees only their own tasks", async () => {
    const jun = api.client().withBhwToken(tokenFor(api, "Jun M. Santos"));
    const tasks = (await jun.get("/api/bhw/tasks")).body as { barangayId: number }[];
    expect(tasks.length).toBeGreaterThan(0);
    const rico = api.client().withBhwToken(tokenFor(api, "Rico T. Mendoza"));
    expect(((await rico.get("/api/bhw/tasks")).body as unknown[]).length).toBe(0);
  });

  it("resident contribution routes need a resident session, and an officer cookie is not one", async () => {
    // The resident sign-in is built in Phase 8; the access check is tested here on a probe route.
    const sessions = new SessionManager("probe-secret");
    const probe = express();
    probe.get("/who", requireResident(sessions), (req, res) => res.json({ residentId: req.residentId }));
    probe.get("/sign-in/:id", (req, res) => {
      sessions.startResident(res, Number(req.params.id));
      res.json({ ok: true });
    });
    probe.use((err: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status ?? 500).json({ error: err.message });
    });
    const server = probe.listen(0);
    await new Promise((r) => server.once("listening", r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(`${base}/who`)).status).toBe(401);
      const signIn = await fetch(`${base}/sign-in/42`);
      const cookie = signIn.headers.getSetCookie()[0].split(";")[0];
      expect(cookie.startsWith(`${RESIDENT_COOKIE}=`)).toBe(true);
      const ok = await fetch(`${base}/who`, { headers: { cookie } });
      expect(await ok.json()).toEqual({ residentId: 42 });
      // an officer-kind cookie name does not count
      expect((await fetch(`${base}/who`, { headers: { cookie: cookie.replace(RESIDENT_COOKIE, "aed_officer") } })).status).toBe(401);
    } finally {
      server.close();
    }
  });
});

// ---- ranked list and decision view (read only) -----------------------------------

describe("ranked list and decision view", () => {
  let api: Api;
  let officer: Client;
  beforeAll(async () => {
    api = await startApi();
    officer = await api.officer();
  });
  afterAll(() => api.close());

  it("lists every barangay from highest to lowest score with its breakdown", async () => {
    const view = await ranking(officer);
    expect(view.barangays).toHaveLength(listBarangays(api.db).length);
    view.barangays.forEach((b, i) => {
      expect(b.rank).toBe(i + 1);
      if (i > 0) expect(view.barangays[i - 1].score).toBeGreaterThanOrEqual(b.score);
      expect(b.factors.map((f) => f.key)).toEqual(["weather", "household", "symptom", "field", "cases"]);
      expect(b.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
    });
  });

  it("the risk level, action and Tier 1 cut follow the whole-point score shown", async () => {
    const view = await ranking(officer);
    for (const b of view.barangays) {
      expect(b.score100).toBe(Math.round(b.score * 100));
      expect(b.action).toBe(b.score100 >= 40 ? "tier1" : "monitor");
      const level = b.score100 >= 70 ? "high" : b.score100 >= 40 ? "elevated" : b.score100 >= 25 ? "moderate" : "low";
      expect(b.riskLevel).toBe(level);
    }
  });

  it("marks the top k as dispatch candidates (k from the query, default 3)", async () => {
    const dflt = await ranking(officer);
    expect(dflt.k).toBe(3);
    expect(dflt.barangays.filter((b) => b.isDispatchCandidate)).toHaveLength(3);
    const five = await ranking(officer, 5);
    expect(five.barangays.filter((b) => b.isDispatchCandidate).map((b) => b.rank)).toEqual([1, 2, 3, 4, 5]);
    expect((await ranking(officer, 0)).barangays.some((b) => b.isDispatchCandidate)).toBe(false);
  });

  it.each(["-1", "abc", "2.5", "5000"])("rejects k=%s", async (k) => {
    const res = await officer.get(`/api/officer/ranking?k=${k}`);
    expect(res.status).toBe(400);
  });

  it("shows the team for each barangay and the numbers for the overview cards", async () => {
    const view = await ranking(officer);
    expect(view.barangays.every((b) => b.team !== null)).toBe(true);
    expect(view.summary.barangaysMonitored).toBe(view.barangays.length);
    expect(view.summary.aboveActionThreshold).toBe(view.barangays.filter((b) => b.action === "tier1").length);
    expect(view.summary.activeAssignments).toBe(2); // one new and one in-progress task in the seed
    expect(view.summary.caseWeek).toMatch(/^2026-W\d\d$/);
  });

  it("the decision view matches the database row and the list", async () => {
    const view = await ranking(officer);
    const top = view.barangays[0];
    const res = await officer.get(`/api/officer/barangays/${top.barangayId}/decision`);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.score.score100).toBe(top.score100);
    const row = latestScoreFor(api.db, top.barangayId)!;
    expect(d.score.score).toBe(row.score);
    expect(d.score.paramsVersion).toBe(row.paramsVersion);
    const stored = row.weightsUsed as Record<string, { points: number }>;
    for (const f of d.factors as { key: string; points: number }[]) expect(f.points).toBeCloseTo(stored[f.key].points, 12);
    // points add up to the subtotal, and the subtotal times the density factor is the score
    const total = (d.factors as { points: number }[]).reduce((s, f) => s + f.points, 0);
    expect(total).toBeCloseTo(d.score.subtotal, 9);
    expect((d.score.subtotal / 100) * d.score.densityFactor).toBeCloseTo(d.score.score, 9);
    expect(d.details.cases).toBeDefined();
    expect(d.details.field).toHaveProperty("surveyed");
  });

  it("Tier 2 is unlocked only where one purok has more than 2 cases (Bascaran Purok 4)", async () => {
    const view = await ranking(officer);
    const bascaran = view.barangays.find((b) => b.name === "Bascaran")!;
    expect(bascaran.tier2.unlocked).toBe(true);
    expect(bascaran.tier2.puroks.map((p) => p.purok)).toContain("Purok 4");
    const d = (await officer.get(`/api/officer/barangays/${bascaran.barangayId}/decision`)).body;
    expect(d.tier2.minCases).toBe(3);
    expect(d.purokCases.find((p: { purok: string }) => p.purok === "Purok 4").cases).toBeGreaterThanOrEqual(3);
    // a high score alone never unlocks it: some barangay is Tier 1 with Tier 2 locked
    expect(view.barangays.some((b) => b.action === "tier1" && !b.tier2.unlocked)).toBe(true);
  });

  it("answers 404 for an unknown barangay and 400 for a bad id", async () => {
    expect((await officer.get("/api/officer/barangays/9999/decision")).status).toBe(404);
    expect((await officer.get("/api/officer/barangays/abc/decision")).status).toBe(400);
  });

  it("returns JSON errors for unknown paths and broken bodies", async () => {
    const missing = await officer.get("/api/officer/nothing-here");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBeDefined();
    const broken = await officer.request("POST", "/api/officer/cases/validate", "{not json");
    expect(broken.status).toBe(400);
    expect(broken.body.error).toMatch(/JSON/);
  });
});

describe("trend arrows", () => {
  it("compare today's score with the one from 7 days earlier", async () => {
    const api = await startApi();
    try {
      api.ranking.backfillHistory("2026-11-01", ANCHOR);
      const officer = await api.officer();
      const view = await ranking(officer);
      for (const b of view.barangays) {
        const prev = (b as unknown as { previousScore100: number | null }).previousScore100;
        expect(prev).not.toBeNull();
        const change = b.score100 - prev!;
        expect(b.trend).toBe(change > 2 ? "rising" : change < -2 ? "falling" : "flat");
      }
      expect(view.barangays.some((b) => b.trend !== "flat")).toBe(true);
    } finally {
      await api.close();
    }
  });
});

// ---- confirm and reject ---------------------------------------------------------

describe("confirm and reject", () => {
  async function candidate(api: Api, officer: Client) {
    const view = await ranking(officer);
    const tasks = (await officer.get("/api/officer/assignments")).body as { barangayId: number; type: string; status: string }[];
    const open = new Set(tasks.filter((t) => t.status !== "completed" && t.type === "search_and_destroy").map((t) => t.barangayId));
    const row = view.barangays.find((b) => b.action === "tier1" && b.team && !open.has(b.barangayId))!;
    expect(row, "the seed should have a Tier 1 barangay without an open task").toBeDefined();
    return row;
  }

  it("confirm creates a field task for the barangay's BHW and records the decision", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await candidate(api, officer);
      const res = await officer.post(`/api/officer/barangays/${row.barangayId}/confirm`, { tier: 1, reviewed: true });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("search_and_destroy");
      expect(res.body.puroks.length).toBeGreaterThan(0);

      const tasks = (await officer.get("/api/officer/assignments")).body as { id: number; barangayId: number; status: string; bhwName: string }[];
      const task = tasks.find((t) => t.id === res.body.taskId)!;
      expect(task).toMatchObject({ barangayId: row.barangayId, status: "new" });
      expect(task.bhwName).toBeTruthy();
      const rec = api.db.prepare("SELECT status, officer_id AS officerId, tier FROM recommendation WHERE id = ?").get(res.body.recommendationId) as { status: string; officerId: number; tier: number };
      expect(rec).toMatchObject({ status: "confirmed", tier: 1 });
      expect(rec.officerId).toBeGreaterThan(0);
      const events = (await officer.get("/api/officer/events")).body as { type: string; text: string }[];
      expect(events[0]).toMatchObject({ type: "decision" });
      expect(events[0].text).toContain(row.name);
      // and the BHW sees it
      const bhwToken = api.bhwTokens.find((t) => t.barangay === row.name)!.token;
      const mine = (await api.client().withBhwToken(bhwToken).get("/api/bhw/tasks")).body as { id: number }[];
      expect(mine.map((t) => t.id)).toContain(res.body.taskId);
    } finally {
      await api.close();
    }
  });

  it("confirm without the review tick is refused and creates nothing", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await candidate(api, officer);
      const tasks = count(api.db, "field_task");
      const recs = count(api.db, "recommendation");
      for (const body of [{ tier: 1 }, { tier: 1, reviewed: false }, { tier: 1, reviewed: "true" }]) {
        const res = await officer.post(`/api/officer/barangays/${row.barangayId}/confirm`, body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/reviewed/);
      }
      expect(count(api.db, "field_task")).toBe(tasks);
      expect(count(api.db, "recommendation")).toBe(recs);
    } finally {
      await api.close();
    }
  });

  it("a second confirmation for the same open task type is refused", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await candidate(api, officer);
      expect((await officer.post(`/api/officer/barangays/${row.barangayId}/confirm`, { tier: 1, reviewed: true })).status).toBe(201);
      const again = await officer.post(`/api/officer/barangays/${row.barangayId}/confirm`, { tier: 1, reviewed: true });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/already has an open/);
    } finally {
      await api.close();
    }
  });

  it("Tier 1 is refused below the action threshold, Tier 2 while locked, and Tier 2 works where unlocked", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const view = await ranking(officer);
      const monitor = view.barangays.find((b) => b.action === "monitor")!;
      const t1 = await officer.post(`/api/officer/barangays/${monitor.barangayId}/confirm`, { tier: 1, reviewed: true });
      expect(t1.status).toBe(409);
      expect(t1.body.error).toMatch(/Tier 1 is recommended from a score of 40/);

      const locked = view.barangays.find((b) => !b.tier2.unlocked)!;
      const t2locked = await officer.post(`/api/officer/barangays/${locked.barangayId}/confirm`, { tier: 2, reviewed: true });
      expect(t2locked.status).toBe(409);
      expect(t2locked.body.error).toMatch(/never authorizes fogging/);

      const unlocked = view.barangays.find((b) => b.name === "Bascaran")!;
      const ok = await officer.post(`/api/officer/barangays/${unlocked.barangayId}/confirm`, { tier: 2, reviewed: true });
      expect(ok.status).toBe(201);
      expect(ok.body.type).toBe("tier2_verification"); // a purok verification task, not a fogging order
      expect(ok.body.puroks).toContain("Purok 4");
    } finally {
      await api.close();
    }
  });

  it("confirm for a barangay with no BHW says so clearly", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const created = await officer.post("/api/officer/barangays", { name: "No Health Worker", population: 1000, areaKm2: 1, puroks: ["Purok 1"] });
      expect(created.status).toBe(201);
      // push it over the Tier 1 line so the decision is offered
      api.db.prepare("UPDATE threat_score SET score = 0.9 WHERE barangay_id = ?").run(created.body.id);
      const res = await officer.post(`/api/officer/barangays/${created.body.id}/confirm`, { tier: 1, reviewed: true });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("No BHW is assigned to No Health Worker. Assign one before confirming.");
    } finally {
      await api.close();
    }
  });

  it("reject with a reason shorter than 10 characters fails and saves nothing", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await candidate(api, officer);
      const recs = count(api.db, "recommendation");
      for (const reason of ["", "short", "123456789", "   too short   "]) {
        const res = await officer.post(`/api/officer/barangays/${row.barangayId}/reject`, { tier: 1, reason });
        expect(res.status, JSON.stringify(reason)).toBe(400);
        expect(res.body.error).toMatch(/at least 10 characters/);
      }
      expect(count(api.db, "recommendation")).toBe(recs);
    } finally {
      await api.close();
    }
  });

  it("reject with 10 or more characters is recorded, creates no task, and keeps the barangay ranked", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await candidate(api, officer);
      const tasks = count(api.db, "field_task");
      const res = await officer.post(`/api/officer/barangays/${row.barangayId}/reject`, { tier: 1, reason: "Cases still low; recheck next week." });
      expect(res.status).toBe(201);
      const rec = api.db.prepare("SELECT status, reason FROM recommendation WHERE id = ?").get(res.body.recommendationId) as { status: string; reason: string };
      expect(rec).toEqual({ status: "rejected", reason: "Cases still low; recheck next week." });
      expect(count(api.db, "field_task")).toBe(tasks);
      const after = await ranking(officer);
      expect(after.barangays.some((b) => b.barangayId === row.barangayId)).toBe(true);
      expect(after.barangays.find((b) => b.barangayId === row.barangayId)!.score).toBe(row.score); // unchanged
    } finally {
      await api.close();
    }
  });

  it("answers 404 for an unknown barangay", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      expect((await officer.post("/api/officer/barangays/9999/confirm", { tier: 1, reviewed: true })).status).toBe(404);
    } finally {
      await api.close();
    }
  });
});

// ---- a submitted survey changes the ranking -----------------------------------------

describe("BHW survey through the API", () => {
  const survey = (purokId: number, extra: Record<string, unknown> = {}) => ({
    purokId,
    houseNo: "21",
    headOfFamily: "Private Name",
    age: 38,
    sex: "Male",
    surveyedBy: "Rico T. Mendoza",
    surveyDate: ANCHOR,
    noContainersFound: false,
    containers: [{ location: "outdoor", containerType: "Drum", total: 50, withCover: 0, withoutCover: 50, positive: 45, larvaeCount: 300, pupaeCount: 20 }],
    ...extra,
  });

  it("changes the ranking, appears in the findings, and is logged without household details", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const before = await ranking(officer);
      const mabini = before.barangays.find((b) => b.name === "Mabini")!;

      const rico = api.client().withBhwToken(tokenFor(api, "Rico T. Mendoza"));
      const me = (await rico.get("/api/bhw/me")).body as { puroks: { id: number }[] };
      api.lines.length = 0;
      const res = await rico.post("/api/bhw/surveys", survey(me.puroks[0].id));
      expect(res.status).toBe(201);
      expect(api.lines.some((l) => /^\[rescore\] 1 barangays in \d+\.\d ms \(survey submitted\)$/.test(l))).toBe(true);

      const after = await ranking(officer);
      const mabiniAfter = after.barangays.find((b) => b.name === "Mabini")!;
      expect(mabiniAfter.score).toBeGreaterThan(mabini.score);
      expect(mabiniAfter.rank).toBeLessThanOrEqual(mabini.rank);
      // every other barangay is untouched
      for (const b of after.barangays.filter((x) => x.name !== "Mabini")) {
        expect(b.score).toBe(before.barangays.find((x) => x.name === b.name)!.score);
      }

      const findings = (await officer.get(`/api/officer/findings?barangayId=${mabini.barangayId}`)).body as Record<string, unknown>[];
      const mine = findings.find((f) => f.id === res.body.surveyId)!;
      expect(mine).toMatchObject({ barangayName: "Mabini", positive: 45, containers: 50 });
      expect(mine.headOfFamily).toBeUndefined(); // the list never carries household details
      const events = (await officer.get("/api/officer/events")).body as { text: string }[];
      expect(events[0].text).toContain("Rico T. Mendoza");
      expect(JSON.stringify(events)).not.toContain("Private Name");
    } finally {
      await api.close();
    }
  });

  it("rejects an invalid survey and saves nothing; a BHW cannot use another barangay's purok", async () => {
    const api = await startApi();
    try {
      const rico = api.client().withBhwToken(tokenFor(api, "Rico T. Mendoza"));
      const me = (await rico.get("/api/bhw/me")).body as { puroks: { id: number }[] };
      const surveys = count(api.db, "entomological_survey");
      const scores = count(api.db, "threat_score");
      const bad = await rico.post("/api/bhw/surveys", survey(me.puroks[0].id, { containers: [{ location: "indoor", containerType: "Jar", total: 3, withCover: 1, withoutCover: 1, positive: 0 }] }));
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/with cover \+ without cover/);
      const tagasPurok = (api.db.prepare("SELECT p.id FROM purok p JOIN barangay b ON b.id = p.barangay_id WHERE b.name = 'Tagas' LIMIT 1").get() as { id: number }).id;
      const other = await rico.post("/api/bhw/surveys", survey(tagasPurok));
      expect(other.status).toBe(400);
      expect(count(api.db, "entomological_survey")).toBe(surveys);
      expect(count(api.db, "threat_score")).toBe(scores);
    } finally {
      await api.close();
    }
  });

  it("household details are only on the single-finding route, for officers", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const rico = api.client().withBhwToken(tokenFor(api, "Rico T. Mendoza"));
      const me = (await rico.get("/api/bhw/me")).body as { puroks: { id: number }[] };
      const { body } = await rico.post("/api/bhw/surveys", survey(me.puroks[0].id));
      const one = await officer.get(`/api/officer/findings/${body.surveyId}`);
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ headOfFamily: "Private Name", houseNo: "21", barangayName: "Mabini" });
      expect(one.body.containers[0]).toMatchObject({ location: "outdoor", positive: 45 });
      expect((await api.client().get(`/api/officer/findings/${body.surveyId}`)).status).toBe(401);
      expect((await officer.get("/api/officer/findings/99999")).status).toBe(404);
    } finally {
      await api.close();
    }
  });
});

// ---- case import ----------------------------------------------------------------

describe("case import through the API", () => {
  it("validate checks the file and saves nothing", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const cases = count(api.db, "case_record");
      const res = await officer.post("/api/officer/cases/validate", { text: dataFile("cases_with_errors.csv") });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.rows.filter((r: { ok: boolean }) => !r.ok).length).toBeGreaterThan(3);
      expect(count(api.db, "case_record")).toBe(cases);
      const good = await officer.post("/api/officer/cases/validate", { text: dataFile("cases_valid.csv") });
      expect(good.body.success).toBe(true);
      expect(count(api.db, "case_record")).toBe(cases);
    } finally {
      await api.close();
    }
  });

  it("a file with errors is refused with 422 and nothing changes", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const cases = count(api.db, "case_record");
      const scores = count(api.db, "threat_score");
      const res = await officer.post("/api/officer/cases/import", { text: dataFile("cases_with_errors.csv") });
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.rows.some((r: { error?: string }) => r.error?.includes("Atlantis"))).toBe(true);
      expect(count(api.db, "case_record")).toBe(cases);
      expect(count(api.db, "threat_score")).toBe(scores);
    } finally {
      await api.close();
    }
  });

  it("a valid file is imported, the ranking is re-scored, and the import is listed", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const before = await ranking(officer);
      const res = await officer.post("/api/officer/cases/import", { text: dataFile("cases_valid.csv") });
      expect(res.status).toBe(201);
      expect(res.body.affectedBarangayIds).toHaveLength(8);
      const after = await ranking(officer);
      expect(after.barangays.some((b) => b.score !== before.barangays.find((x) => x.name === b.name)!.score)).toBe(true);
      const imports = (await officer.get("/api/officer/cases/imports")).body as { isoWeek: string; status: string }[];
      expect(imports[0]).toMatchObject({ isoWeek: "2026-W46", status: "imported" });
      expect(api.lines.some((l) => l.includes("(case import)"))).toBe(true);
    } finally {
      await api.close();
    }
  });

  it("serves the sample files and asks for the text", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const sample = await officer.get("/api/officer/cases/samples/valid");
      expect(sample.status).toBe(200);
      expect(sample.body.text).toBe(dataFile("cases_valid.csv"));
      expect((await officer.get("/api/officer/cases/samples/nope")).status).toBe(404);
      expect((await officer.post("/api/officer/cases/validate", {})).status).toBe(400);
    } finally {
      await api.close();
    }
  });
});

// ---- barangay profiles ----------------------------------------------------------

describe("barangay profiles through the API", () => {
  it("adds, edits and deletes a barangay, and the ranking follows", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const created = await officer.post("/api/officer/barangays", { name: "Sample New", population: 2500, areaKm2: 1.5, puroks: ["Purok 1", "Purok 2"] });
      expect(created.status).toBe(201);
      expect(created.body.puroks).toHaveLength(2);
      expect((await ranking(officer)).barangays.some((b) => b.name === "Sample New")).toBe(true);

      const edited = await officer.put(`/api/officer/barangays/${created.body.id}`, { population: 4000, puroks: ["Purok 1", "Purok 2", "Purok 3"] });
      expect(edited.status).toBe(200);
      expect(edited.body.population).toBe(4000);
      expect(edited.body.puroks).toHaveLength(3);

      expect((await officer.delete(`/api/officer/barangays/${created.body.id}`)).status).toBe(200);
      expect((await ranking(officer)).barangays.some((b) => b.name === "Sample New")).toBe(false);
      expect((await officer.get(`/api/officer/barangays/${created.body.id}`)).status).toBe(404);
      expect((await officer.delete(`/api/officer/barangays/${created.body.id}`)).status).toBe(404);
    } finally {
      await api.close();
    }
  });

  it("explains what is wrong with a bad profile", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const bad = await officer.post("/api/officer/barangays", { name: "X", population: 0, areaKm2: 1, puroks: ["Purok 1"] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/population/);
      const dup = await officer.post("/api/officer/barangays", { name: "Mabini", population: 100, areaKm2: 1, puroks: ["Purok 1"] });
      expect(dup.status).toBe(409);
      expect((await officer.post("/api/officer/barangays")).status).toBe(400);
    } finally {
      await api.close();
    }
  });
});

// ---- activity ---------------------------------------------------------------------

describe("activity and dispatches", () => {
  let api: Api;
  let officer: Client;
  beforeAll(async () => {
    api = await startApi();
    officer = await api.officer();
  });
  afterAll(() => api.close());

  it("lists the field assignments with status, team and households", async () => {
    const tasks = (await officer.get("/api/officer/assignments")).body as { status: string; type: string; bhwName: string; puroks: string[]; households: number }[];
    expect(tasks.map((t) => t.status).sort()).toEqual(["completed", "in_progress", "new"]);
    expect(tasks[0].status).toBe("new"); // open ones first
    expect(tasks.every((t) => t.bhwName && Array.isArray(t.puroks))).toBe(true);
    expect(tasks.find((t) => t.type === "spot_check")!.households).toBe(1);
  });

  it("filters the findings by barangay, BHW and date range", async () => {
    const all = (await officer.get("/api/officer/findings")).body as { barangayId: number; bhwId: number; surveyDate: string }[];
    expect(all.length).toBeGreaterThan(5);
    const barangayId = all[0].barangayId;
    const one = (await officer.get(`/api/officer/findings?barangayId=${barangayId}`)).body as { barangayId: number }[];
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((f) => f.barangayId === barangayId)).toBe(true);
    expect(one.length).toBeLessThan(all.length);

    const bhwId = all.find((f) => f.bhwId)!.bhwId;
    const byBhw = (await officer.get(`/api/officer/findings?bhwId=${bhwId}`)).body as { bhwId: number }[];
    expect(byBhw.every((f) => f.bhwId === bhwId)).toBe(true);

    const range = (await officer.get("/api/officer/findings?from=2026-11-10&to=2026-11-15")).body as { surveyDate: string }[];
    expect(range.every((f) => f.surveyDate >= "2026-11-10" && f.surveyDate <= "2026-11-15")).toBe(true);
    // newest first
    const dates = all.map((f) => f.surveyDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("rejects bad filters", async () => {
    expect((await officer.get("/api/officer/findings?from=nope")).status).toBe(400);
    expect((await officer.get("/api/officer/findings?barangayId=abc")).status).toBe(400);
    expect((await officer.get("/api/officer/findings?from=2026-11-15&to=2026-11-10")).status).toBe(400);
  });

  it("gives the event timeline newest first", async () => {
    const events = (await officer.get("/api/officer/events?limit=5")).body as { at: string; type: string }[];
    expect(events).toHaveLength(5);
    expect([...events].map((e) => e.at).sort().reverse()).toEqual(events.map((e) => e.at));
    expect((await officer.get("/api/officer/events?limit=0")).status).toBe(400);
  });
});

// ---- a restart gives the same ranking ------------------------------------------------

describe("restart", () => {
  it("a new server on the same database shows the same ranking, also after changes", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      // change things first: a survey and a case import
      const rico = api.client().withBhwToken(tokenFor(api, "Rico T. Mendoza"));
      const me = (await rico.get("/api/bhw/me")).body as { puroks: { id: number }[] };
      await rico.post("/api/bhw/surveys", {
        purokId: me.puroks[0].id, houseNo: "1", surveyedBy: "Rico T. Mendoza", surveyDate: ANCHOR, noContainersFound: false,
        containers: [{ location: "indoor", containerType: "Jar", total: 10, withCover: 0, withoutCover: 10, positive: 9 }],
      });
      await officer.post("/api/officer/cases/import", { text: dataFile("cases_valid.csv") });
      const before = await ranking(officer);

      // "restart": a brand-new service and app over the same database
      const lines: string[] = [];
      const second = new RankingService(api.db, { clock: api.clock, logger: (l) => lines.push(l) });
      second.start();
      const sessions = new SessionManager("test-secret", api.clock);
      const server = createApp({ db: api.db, ranking: second, changes: new DataChanges(api.db, second), decisions: new Decisions(api.db, second), sessions }).listen(0);
      await new Promise((r) => server.once("listening", r));
      try {
        const c = new Client(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        await c.loginAsOfficer();
        const after = await ranking(c);
        expect(after.barangays.map((b) => [b.barangayId, b.score, b.rank])).toEqual(before.barangays.map((b) => [b.barangayId, b.score, b.rank]));
        expect(lines.some((l) => l.includes("[rescore]"))).toBe(false); // rebuilt from stored scores, nothing re-scored
        expect(second.isHeapValid()).toBe(true);
      } finally {
        server.close();
      }
    } finally {
      await api.close();
    }
  });
});
