import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Api, ANCHOR, startApi } from "./apiHelpers";

// What the officer pages need from the server: the files themselves, the
// trends for the two overview charts, and the rejection reason in the timeline.

describe("pages are served", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  it("sends / to the officer pages", async () => {
    const res = await fetch(`${api.baseUrl}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/officer/");
  });

  it.each(["/officer/", "/officer/login.html", "/officer/trends.html", "/officer/queue.html", "/officer/decision.html", "/officer/import.html", "/officer/profiles.html", "/officer/activity.html"])("serves %s as HTML", async (path) => {
    const res = await fetch(`${api.baseUrl}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("serves the shared stylesheet and scripts", async () => {
    const css = await fetch(`${api.baseUrl}/shared/tokens.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/text\/css/);
    const js = await fetch(`${api.baseUrl}/shared/api.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
  });

  it.each(["manrope-latin-var"])("serves the stored font %s", async (name) => {
    const res = await fetch(`${api.baseUrl}/shared/fonts/${name}.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/font\/woff2/);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(5000);
  });

  it("keeps the API as JSON: 401 without a session, 404 for an unknown route", async () => {
    const locked = await fetch(`${api.baseUrl}/api/officer/ranking`);
    expect(locked.status).toBe(401);
    expect((await locked.json()).error).toMatch(/Sign in/);
    const unknown = await fetch(`${api.baseUrl}/api/nothing-here`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toMatch(/json/);
  });

  it("gives a plain 404 page for an unknown page", async () => {
    const res = await fetch(`${api.baseUrl}/no-such-page.html`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });
});

describe("GET /api/officer/trends", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
    api.ranking.backfillHistory("2026-09-22", ANCHOR);
  });
  afterAll(() => api.close());

  it("needs an officer session", async () => {
    expect((await api.client().get("/api/officer/trends")).status).toBe(401);
  });

  it("returns eight consecutive weeks that end at the newest case week", async () => {
    const officer = await api.officer();
    const trends = (await officer.get("/api/officer/trends")).body as { weeks: string[]; casesPerWeek: number[]; riskPerWeek: Record<string, number>[] };
    const summary = (await officer.get("/api/officer/ranking")).body.summary as { caseWeek: string; weeklyConfirmedCases: number; barangaysMonitored: number };

    expect(trends.weeks).toHaveLength(8);
    expect(trends.casesPerWeek).toHaveLength(8);
    expect(trends.riskPerWeek).toHaveLength(8);
    expect(trends.weeks[7]).toBe(summary.caseWeek);
    expect(new Set(trends.weeks).size).toBe(8);
    expect(trends.weeks).toEqual([...trends.weeks].sort());
    // the newest week is the same number the overview shows as "weekly confirmed cases"
    expect(trends.casesPerWeek[7]).toBe(summary.weeklyConfirmedCases);
  });

  it("counts every barangay once in the newest week and never more than that before", async () => {
    const officer = await api.officer();
    const trends = (await officer.get("/api/officer/trends")).body as { riskPerWeek: Record<string, number>[] };
    const monitored = ((await officer.get("/api/officer/ranking")).body.summary as { barangaysMonitored: number }).barangaysMonitored;
    const sum = (w: Record<string, number>) => w.low + w.moderate + w.elevated + w.high;
    for (const week of trends.riskPerWeek) {
      expect(Object.keys(week).sort()).toEqual(["elevated", "high", "low", "moderate"]);
      expect(sum(week)).toBeLessThanOrEqual(monitored);
    }
    expect(sum(trends.riskPerWeek[7])).toBe(monitored);
  });

  it("uses the whole-point score, so a barangay shown as 40 counts as Elevated", async () => {
    const officer = await api.officer();
    const view = (await officer.get("/api/officer/ranking")).body.barangays as { riskLevel: string }[];
    const trends = (await officer.get("/api/officer/trends")).body as { riskPerWeek: Record<string, number>[] };
    const now = trends.riskPerWeek[7];
    for (const level of ["low", "moderate", "elevated", "high"]) {
      expect(now[level], level).toBe(view.filter((b) => b.riskLevel === level).length);
    }
  });
});

describe("rejection reason in the timeline", () => {
  it("writes the reason into the event text", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const view = (await officer.get("/api/officer/ranking")).body.barangays as { barangayId: number; name: string; action: string }[];
      const row = view.find((b) => b.action === "tier1")!;
      const reason = "Already inspected this week";
      const res = await officer.post(`/api/officer/barangays/${row.barangayId}/reject`, { tier: 1, reason });
      expect(res.status).toBe(201);
      const events = (await officer.get("/api/officer/events")).body as { text: string }[];
      expect(events[0].text).toBe(`Rejected Tier 1 for ${row.name}: "${reason}"`);
    } finally {
      await api.close();
    }
  });
});

// The page scripts are plain browser modules, so neither the TypeScript build nor the other tests
// read them. A typing slip in one would only show up in a browser. This parses every one of them.
describe("page scripts", () => {
  const root = path.join(process.cwd(), "src", "web");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(root);

  it.each(files.map((f) => path.relative(root, f).replaceAll("\\", "/")))("%s is valid JavaScript", (name) => {
    const copy = path.join(os.tmpdir(), `check-${name.replaceAll("/", "-")}.mjs`);
    fs.copyFileSync(path.join(root, name), copy);
    try {
      execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" });
    } finally {
      fs.rmSync(copy, { force: true });
    }
  });
});

// A page asks for its words by name (strings.officer.queue.columns). If a name is missing the page
// stops while it builds and shows an empty screen, so every name a page uses must exist.
describe("page texts", () => {
  it("has every text the pages ask for", async () => {
    const root = path.join(process.cwd(), "src", "web");
    const copy = path.join(os.tmpdir(), "strings-check.mjs");
    fs.copyFileSync(path.join(root, "shared", "strings.js"), copy);
    const { strings } = (await import(/* @vite-ignore */ `file://${copy.replaceAll("\\", "/")}`)) as { strings: Record<string, unknown> };
    fs.rmSync(copy, { force: true });

    const get = (dotted: string): unknown => dotted.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), strings);
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".js") || entry.name === "strings.js") continue;
        const src = fs.readFileSync(full, "utf8");
        const rel = path.relative(root, full).replaceAll("\\", "/");
        for (const m of src.matchAll(/const\s+(\w+)\s*=\s*strings\.([\w.]+)\s*;/g)) {
          const [, alias, base] = m;
          if (get(base) === undefined) missing.push(`${rel}: strings.${base}`);
          for (const use of src.matchAll(new RegExp(String.raw`\b${alias}\.(\w+)`, "g"))) {
            if (get(base) !== undefined && !(use[1] in (get(base) as object))) missing.push(`${rel}: ${alias}.${use[1]} (strings.${base})`);
          }
        }
        for (const m of src.matchAll(/(?<![/\w])strings\.([A-Za-z][\w.]*[A-Za-z0-9_])/g)) {
          if (get(m[1]) === undefined) missing.push(`${rel}: strings.${m[1]}`);
        }
      }
    };
    walk(root);
    expect([...new Set(missing)]).toEqual([]);
  });
});
