import { describe, expect, it } from "vitest";
import { Api, Client, startApi } from "./apiHelpers";
import { count } from "./helpers";

// A spot check is the officer's own request for an inspection where Tier 1 is not recommended.

type Row = { barangayId: number; name: string; action: string; team: unknown };

async function rows(officer: Client): Promise<Row[]> {
  const res = await officer.get("/api/officer/ranking");
  expect(res.status).toBe(200);
  return res.body.barangays as Row[];
}

async function monitored(officer: Client): Promise<Row> {
  const row = (await rows(officer)).find((b) => b.action === "monitor" && b.team);
  expect(row, "the seed should have a barangay that is only monitored").toBeDefined();
  return row!;
}

describe("spot check", () => {
  it("creates a task for the BHW, without a recommendation, and says so in the timeline", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await monitored(officer);
      const recs = count(api.db, "recommendation");

      const res = await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, { reviewed: true, note: "Rising symptom checks near the school" });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("spot_check");

      const task = api.db.prepare("SELECT type, status, puroks, recommendation_id AS rec FROM field_task WHERE id = ?").get(res.body.taskId) as { type: string; status: string; puroks: string; rec: number | null };
      expect(task).toMatchObject({ type: "spot_check", status: "new", puroks: "[]", rec: null }); // the BHW chooses the puroks
      expect(count(api.db, "recommendation")).toBe(recs); // the officer's own call, no recommendation record

      const events = (await officer.get("/api/officer/events")).body as { type: string; text: string }[];
      expect(events[0].text).toContain(row.name);
      expect(events[0].text).toContain("spot check");
      expect(events[0].text).toContain("Rising symptom checks near the school");

      // the BHW of that barangay sees the task
      const bhw = api.bhwTokens.find((t) => t.barangay === row.name)!;
      const mine = (await api.client().withBhwToken(bhw.token).get("/api/bhw/tasks")).body as { id: number; type: string }[];
      expect(mine.find((t) => t.id === res.body.taskId)?.type).toBe("spot_check");
    } finally {
      await api.close();
    }
  });

  it("the decision view says when a spot check is available, and not any more once one is open", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await monitored(officer);
      const before = (await officer.get(`/api/officer/barangays/${row.barangayId}/decision`)).body;
      expect(before.tier1.available).toBe(false);
      expect(before.spotCheck.available).toBe(true);

      await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, { reviewed: true });
      const after = (await officer.get(`/api/officer/barangays/${row.barangayId}/decision`)).body;
      expect(after.spotCheck.available).toBe(false);
      expect(after.openTasks.some((t: { type: string }) => t.type === "spot_check")).toBe(true);
    } finally {
      await api.close();
    }
  });

  it("is refused where Tier 1 is recommended (use Tier 1 instead)", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const tier1 = (await rows(officer)).find((b) => b.action === "tier1")!;
      const view = (await officer.get(`/api/officer/barangays/${tier1.barangayId}/decision`)).body;
      expect(view.spotCheck.available).toBe(false);
      const tasks = count(api.db, "field_task");
      const res = await officer.post(`/api/officer/barangays/${tier1.barangayId}/spot-check`, { reviewed: true });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Tier 1 is already recommended/);
      expect(count(api.db, "field_task")).toBe(tasks);
    } finally {
      await api.close();
    }
  });

  it("needs the review tick and creates nothing without it", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await monitored(officer);
      const tasks = count(api.db, "field_task");
      for (const body of [{}, { reviewed: false }, { reviewed: "true" }]) {
        const res = await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, body);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/reviewed/);
      }
      expect(count(api.db, "field_task")).toBe(tasks);
    } finally {
      await api.close();
    }
  });

  it("only one inspection can be open for a barangay", async () => {
    const api: Api = await startApi();
    try {
      const officer = await api.officer();
      const row = await monitored(officer);
      expect((await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, { reviewed: true })).status).toBe(201);
      const again = await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, { reviewed: true });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/already has an open inspection/);
    } finally {
      await api.close();
    }
  });

  it("an overlong note is refused and an unknown barangay is a 404", async () => {
    const api = await startApi();
    try {
      const officer = await api.officer();
      const row = await monitored(officer);
      const long = await officer.post(`/api/officer/barangays/${row.barangayId}/spot-check`, { reviewed: true, note: "x".repeat(301) });
      expect(long.status).toBe(400);
      expect((await officer.post(`/api/officer/barangays/9999/spot-check`, { reviewed: true })).status).toBe(404);
    } finally {
      await api.close();
    }
  });

  it("needs an officer session", async () => {
    const api = await startApi();
    try {
      const res = await api.client().post(`/api/officer/barangays/1/spot-check`, { reviewed: true });
      expect(res.status).toBe(401);
    } finally {
      await api.close();
    }
  });
});
