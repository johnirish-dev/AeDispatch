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
