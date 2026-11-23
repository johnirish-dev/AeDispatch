import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Api, ANCHOR, startApi } from "./apiHelpers";

// What the officer overview needs from the server beyond the ranking: the weekly
// trends for its two charts, and the rejection reason in the event timeline.

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

describe("GET /api/officer/trends: the signals besides cases", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  type Signals = { rainMm: (number | null)[]; meanTempC: (number | null)[]; householdReports: number[]; symptomWarnings: number[]; containersPositivePct: (number | null)[] };
  const read = async () => {
    const officer = await api.officer();
    return (await officer.get("/api/officer/trends")).body as { weeks: string[]; signals: Signals };
  };

  it("has one value per week for every signal", async () => {
    const { weeks, signals } = await read();
    for (const [name, values] of Object.entries(signals)) expect(values, name).toHaveLength(weeks.length);
  });

  it("adds up the household reports and warning checks of all barangays for each week", async () => {
    const { weeks, signals } = await read();
    const total = (sql: string, from: string, to: string) => (api.db.prepare(sql).get(from, to) as { n: number }).n;
    expect(weeks).toHaveLength(8);
    const allReports = total("SELECT COUNT(*) AS n FROM household_report WHERE date BETWEEN ? AND ?", "0000-01-01", "9999-12-31");
    const allWarnings = total("SELECT COALESCE(SUM(checks_with_warning_signs), 0) AS n FROM symptom_count WHERE date BETWEEN ? AND ?", "0000-01-01", "9999-12-31");
    // eight weeks cannot hold more than everything that was stored, and the seed has data in them
    expect(signals.householdReports.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(signals.householdReports.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(allReports);
    expect(signals.symptomWarnings.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(allWarnings);
  });

  it("gives rain as a total, temperature as an average and the positive share as a percentage", async () => {
    const { signals } = await read();
    for (const v of signals.rainMm) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of signals.meanTempC) if (v !== null) expect(v).toBeGreaterThan(10);
    for (const v of signals.containersPositivePct) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("reports null, not zero, for a week with no weather or no inspected containers", async () => {
    const fresh = await startApi();
    try {
      fresh.db.prepare("DELETE FROM weather_record").run();
      fresh.db.prepare("DELETE FROM survey_container").run();
      const body = (await (await fresh.officer()).get("/api/officer/trends")).body as { signals: Signals };
      expect(body.signals.rainMm.every((v) => v === null)).toBe(true);
      expect(body.signals.meanTempC.every((v) => v === null)).toBe(true);
      expect(body.signals.containersPositivePct.every((v) => v === null)).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it("says the newest week is still partial until its Sunday has passed", async () => {
    const fresh = await startApi();
    try {
      const officer = await fresh.officer();
      const before = (await officer.get("/api/officer/trends")).body as { weeks: string[]; latestWeekPartial: boolean };
      expect(before.latestWeekPartial).toBe(true); // the seeded "today" is a Thursday inside the newest week
      fresh.advance(5 * 24 * 60 * 60 * 1000); // into the next week: the newest case week has ended
      // a sign-in lasts 8 hours of the test clock, so sign in again after moving it
      const after = (await (await fresh.officer()).get("/api/officer/trends")).body as { weeks: string[]; latestWeekPartial: boolean };
      expect(after.weeks[7]).toBe(before.weeks[7]);
      expect(after.latestWeekPartial).toBe(false);
    } finally {
      await fresh.close();
    }
  });

  it("matches the stored data for each Monday to Sunday week", async () => {
    const { weeks, signals } = await read();
    weeks.forEach((label, i) => {
      const [year, week] = label.split("-W").map(Number);
      // Monday of ISO week `week`: January 4th is always in week 1
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const monday = new Date(jan4.getTime() + ((week - 1) * 7 - ((jan4.getUTCDay() + 6) % 7)) * 86_400_000);
      const from = monday.toISOString().slice(0, 10);
      const to = new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const reports = (api.db.prepare("SELECT COUNT(*) AS n FROM household_report WHERE date BETWEEN ? AND ?").get(from, to) as { n: number }).n;
      const rain = (api.db.prepare("SELECT SUM(rainfall_mm) AS n FROM weather_record WHERE date BETWEEN ? AND ?").get(from, to) as { n: number | null }).n;
      expect(signals.householdReports[i], `${label} reports`).toBe(reports);
      expect(signals.rainMm[i], `${label} rain`).toBe(rain === null ? null : Math.round(rain * 10) / 10);
    });
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
