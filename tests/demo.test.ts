import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { latestScores } from "../src/db/repositories/scoreRepo";
import { SAMPLE_BARANGAYS } from "../src/db/sampleData";
import { sampleBarangayToken } from "../src/db/seedDatabase";
import { DemoTools, lanAddress, readWeights } from "../src/services/demoTools";
import { Api, startApi } from "./apiHelpers";
import { count } from "./helpers";

// The Demo tools page (team only): addresses for the QR codes, the weather simulator, and the weights.

const scoresOf = (api: Api) => Object.fromEntries(latestScores(api.db).map((r) => [r.barangayId, r.score]));

describe("who may use it", () => {
  it("needs an officer sign-in for every route", async () => {
    const api = await startApi();
    try {
      const guest = api.client();
      for (const [method, path] of [["get", "/api/officer/demo/links"], ["get", "/api/officer/demo/weather"], ["post", "/api/officer/demo/weather"], ["post", "/api/officer/demo/weather/reset"], ["get", "/api/officer/demo/parameters"], ["post", "/api/officer/demo/parameters/preview"], ["post", "/api/officer/demo/parameters"], ["post", "/api/officer/demo/parameters/1/activate"]] as const) {
        expect((await guest[method](path)).status, `${method} ${path}`).toBe(401);
      }
    } finally {
      await api.close();
    }
  });
});

describe("the phone links", () => {
  const sampleInterfaces = (...addresses: string[]) => ({ Wi: addresses.map((address) => ({ address, family: "IPv4" as const, internal: false, netmask: "", mac: "", cidr: null })) });

  it("prefers a private Wi-Fi address, skips the loopback, and gives null when there is none", () => {
    expect(lanAddress(sampleInterfaces("203.0.113.9", "192.168.1.23"))).toBe("192.168.1.23");
    expect(lanAddress(sampleInterfaces("10.0.0.5"))).toBe("10.0.0.5");
    expect(lanAddress(sampleInterfaces("172.20.1.2"))).toBe("172.20.1.2");
    expect(lanAddress({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "", mac: "", cidr: null }] })).toBeNull();
    expect(lanAddress({})).toBeNull();
  });

  it("skips virtual adapters (VirtualBox 192.168.56.x, VMware, WSL) and prefers the Wi-Fi adapter", () => {
    const nic = (address: string) => [{ address, family: "IPv4" as const, internal: false, netmask: "", mac: "", cidr: null }];
    expect(lanAddress({ "Ethernet 2": nic("192.168.56.1"), "Wi-Fi": nic("192.168.20.105") })).toBe("192.168.20.105");
    expect(lanAddress({ "VMware Network Adapter VMnet1": nic("192.168.10.1"), "vEthernet (WSL)": nic("172.24.0.1"), Ethernet: nic("192.168.1.8") })).toBe("192.168.1.8");
    expect(lanAddress({ Ethernet: nic("192.168.1.8"), "Wi-Fi": nic("10.0.0.7") })).toBe("10.0.0.7");
    expect(lanAddress({ "Ethernet 2": nic("192.168.56.1") })).toBe("192.168.56.1"); // nothing else exists: better than nothing
  });

  describe("from the server", () => {
    let api: Api;
    let tools: DemoTools;
    beforeAll(async () => {
      api = await startApi();
      tools = new DemoTools(api.db, api.ranking, api.deps.changes);
    });
    afterAll(() => api.close());

    it("uses the configured address first, without a trailing slash, and is not 'localhost'", () => {
      const links = tools.links({ PUBLIC_BASE_URL: "http://192.168.43.1:3000/", PORT: "3000" }, sampleInterfaces("10.1.1.1"));
      expect(links.baseUrl).toBe("http://192.168.43.1:3000");
      expect(links.isLocalhost).toBe(false);
      expect(links.resident).toBe("http://192.168.43.1:3000/resident/");
    });

    it("otherwise uses this computer's Wi-Fi address and the port", () => {
      const links = tools.links({ PORT: "4000" }, sampleInterfaces("192.168.1.23"));
      expect(links.baseUrl).toBe("http://192.168.1.23:4000");
      expect(links.isLocalhost).toBe(false);
    });

    it("warns when the only address is this computer itself (a phone cannot open it)", () => {
      expect(tools.links({}, {}).baseUrl).toBe("http://localhost:3000");
      expect(tools.links({}, {}).isLocalhost).toBe(true);
      expect(tools.links({ PUBLIC_BASE_URL: "http://localhost:3000" }, sampleInterfaces("192.168.1.2")).isLocalhost).toBe(true);
    });

    it("gives one working link per barangay (no names): the token in the link opens that barangay", async () => {
      const res = await (await api.officer()).get("/api/officer/demo/links");
      expect(res.status).toBe(200);
      expect(res.body.bhws).toHaveLength(SAMPLE_BARANGAYS.length);
      for (const [i, b] of SAMPLE_BARANGAYS.entries()) {
        const link = res.body.bhws.find((x: { barangay: string }) => x.barangay === b.name);
        expect(link, b.name).toBeDefined();
        expect(Object.keys(link).sort()).toEqual(["barangay", "url"]);
        expect(link.url).toMatch(/\/bhw\/\?token=[0-9a-f]{24}$/);
        const token = link.url.split("token=")[1];
        expect(token).toBe(sampleBarangayToken(i));
        const me = await api.client().withBhwToken(token).get("/api/bhw/me");
        expect(me.status, b.name).toBe(200);
        expect(me.body.barangay.name).toBe(b.name);
      }
    });

    it("does not show a link whose token no longer opens the barangay", async () => {
      const own = await startApi();
      try {
        own.db.prepare("UPDATE barangay_access SET access_token_hash = 'changed' WHERE barangay_id = (SELECT id FROM barangay WHERE name = 'Mabini')").run();
        const res = await (await own.officer()).get("/api/officer/demo/links");
        expect(res.body.bhws).toHaveLength(SAMPLE_BARANGAYS.length - 1);
        expect(res.body.bhws.some((x: { barangay: string }) => x.barangay === "Mabini")).toBe(false);
      } finally {
        await own.close();
      }
    });
  });
});

describe("the weather simulator", () => {
  let api: Api;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  it("starts with the stored weather, and lists the last days and the presets", async () => {
    const res = await (await api.officer()).get("/api/officer/demo/weather");
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(false);
    expect(res.body.days.length).toBeGreaterThan(0);
    expect(res.body.days.length).toBeLessThanOrEqual(14);
    expect(res.body.presets.map((p: { key: string }) => p.key)).toEqual(["dry", "normal", "heavy_rain"]);
  });

  it("a preset marks the weather as simulated and re-scores every barangay; a reset brings the old scores back", async () => {
    const officer = await api.officer();
    const before = scoresOf(api);

    const rain = await officer.post("/api/officer/demo/weather", { preset: "heavy_rain" });
    expect(rain.status).toBe(200);
    expect(rain.body.simulated).toBe(true);
    expect(rain.body.days.some((d: { source: string }) => d.source === "simulated")).toBe(true);
    const during = scoresOf(api);
    expect(Object.keys(during).filter((id) => during[id] !== before[id]).length).toBeGreaterThan(0);
    expect(api.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'weather'").get()).toMatchObject({ n: expect.any(Number) });

    const reset = await officer.post("/api/officer/demo/weather/reset");
    expect(reset.status).toBe(200);
    expect(reset.body.simulated).toBe(false);
    expect(scoresOf(api)).toEqual(before);
  });

  it("accepts custom values, and refuses nonsense with a plain message", async () => {
    const officer = await api.officer();
    expect((await officer.post("/api/officer/demo/weather", { tempC: 29, rainMm: 20 })).status).toBe(200);
    await officer.post("/api/officer/demo/weather/reset");

    for (const body of [{ preset: "monsoon" }, {}, { tempC: 29 }, { tempC: "hot", rainMm: 2 }, { tempC: 60, rainMm: 2 }, { tempC: 29, rainMm: -4 }, { preset: "dry", days: 0 }, { preset: "dry", days: 2.5 }]) {
      const res = await officer.post("/api/officer/demo/weather", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    expect((await officer.get("/api/officer/demo/weather")).body.simulated).toBe(false); // the refused ones changed nothing
  });
});

describe("the weights", () => {
  describe("reading them", () => {
    const ok = { weather: 0.2, household: 0.15, symptom: 0.1, field: 0.25, cases: 0.3 };

    it("accepts five weights that add up to 1, and spreads a tiny rounding error", () => {
      expect(readWeights(ok)).toEqual(ok);
      const rounded = readWeights({ weather: 0.2, household: 0.15, symptom: 0.1, field: 0.25, cases: 0.301 }); // adds up to 1.001
      expect(Object.values(rounded).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });

    it("refuses missing, negative, non-numeric weights and totals that are not 100%", () => {
      for (const bad of [null, "x", {}, { ...ok, cases: undefined }, { ...ok, cases: -0.1 }, { ...ok, cases: "0.3" }, { ...ok, cases: NaN }, { ...ok, cases: 0.2 }, { ...ok, cases: 0.5 }]) {
        expect(() => readWeights(bad), JSON.stringify(bad)).toThrow();
      }
      expect(() => readWeights({ ...ok, cases: 0.2 })).toThrow(/100%/);
    });
  });

  describe("through the routes", () => {
    let api: Api;
    beforeAll(async () => {
      api = await startApi();
    });
    afterAll(() => api.close());

    const defaults = DEFAULT_PARAMETERS.weights;
    const lessCases = { weather: 0.28, household: 0.22, symptom: 0.14, field: 0.36, cases: 0 };

    it("lists the versions, the stored one in use", async () => {
      const res = await (await api.officer()).get("/api/officer/demo/parameters");
      expect(res.status).toBe(200);
      expect(res.body.active.version).toBe(1);
      expect(res.body.active.weights).toEqual(defaults);
      expect(res.body.versions).toHaveLength(1);
    });

    it("a preview with the weights in use changes nothing about the ranking", async () => {
      const res = await (await api.officer()).post("/api/officer/demo/parameters/preview", { weights: defaults });
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(8);
      const live = scoresOf(api);
      for (const r of res.body.rows) {
        expect(r.scoreNew).toBeCloseTo(r.scoreNow, 12);
        expect(r.rankNew).toBe(r.rankNow);
        expect(r.scoreNow, `barangay ${r.barangayId}`).toBeCloseTo(live[r.barangayId], 12); // "now" is what the live ranking really holds
      }
    });

    it("a preview saves nothing and does not touch the live ranking", async () => {
      const officer = await api.officer();
      const versions = count(api.db, "model_parameters");
      const scores = count(api.db, "threat_score");
      const order = api.ranking.order().map((e) => e.id);
      const res = await officer.post("/api/officer/demo/parameters/preview", { weights: lessCases });
      expect(res.status).toBe(200);
      expect(count(api.db, "model_parameters")).toBe(versions);
      expect(count(api.db, "threat_score")).toBe(scores);
      expect(api.ranking.order().map((e) => e.id)).toEqual(order);
      expect(res.body.rows.map((r: { rankNew: number }) => r.rankNew)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // sorted by the new place
      // other weights really do give other scores (the preview is not just echoing the old ones)
      expect(res.body.rows.some((r: { scoreNew: number; scoreNow: number }) => Math.abs(r.scoreNew - r.scoreNow) > 1e-6)).toBe(true);
    });

    it("refuses weights that do not add up, and saves nothing", async () => {
      const officer = await api.officer();
      const versions = count(api.db, "model_parameters");
      for (const path of ["preview", ""]) {
        const res = await officer.post(`/api/officer/demo/parameters${path === "" ? "" : `/${path}`}`, { weights: { ...defaults, cases: 0.9 }, note: "x" });
        expect(res.status, path).toBe(400);
        expect(res.body.error).toMatch(/100%/);
      }
      expect(count(api.db, "model_parameters")).toBe(versions);
    });

    it("saving makes a new version that is NOT in use; activating it re-scores exactly as the preview said", async () => {
      const officer = await api.officer();
      const preview = (await officer.post("/api/officer/demo/parameters/preview", { weights: lessCases })).body.rows as { barangayId: number; scoreNew: number; rankNew: number }[];

      const eventsBefore = (api.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'params'").get() as { n: number }).n;
      const saved = await officer.post("/api/officer/demo/parameters", { weights: lessCases, note: "  Hospital cases left out  " });
      expect(saved.status).toBe(201);
      expect(saved.body).toMatchObject({ version: 2, note: "Hospital cases left out", isActive: false });
      expect((await officer.get("/api/officer/demo/parameters")).body.active.version).toBe(1); // not in use yet

      const alertsBefore = count(api.db, "alert");
      const activated = await officer.post("/api/officer/demo/parameters/2/activate");
      expect(activated.status).toBe(200);
      expect(activated.body).toMatchObject({ version: 2, isActive: true });
      expect(count(api.db, "alert")).toBe(alertsBefore); // a weight change is not an event in the field: no alerts

      // the live scores are exactly the preview's
      const live = scoresOf(api);
      for (const r of preview) expect(live[r.barangayId], `barangay ${r.barangayId}`).toBeCloseTo(r.scoreNew, 12);
      // and the live order is the preview's order
      expect(api.ranking.order().map((e) => e.id)).toEqual(preview.map((r) => r.barangayId));
      // two new lines in the activity log: one for saving, one for activating
      expect(api.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE type = 'params'").get()).toMatchObject({ n: eventsBefore + 2 });
    });

    it("rolling back to version 1 brings the original scores back, and only one version is ever in use", async () => {
      const officer = await api.officer();
      // the test makes its own second version, so it does not depend on the one before it
      const other = (await officer.post("/api/officer/demo/parameters", { weights: lessCases, note: "for the rollback" })).body.version as number;
      const original = Object.fromEntries(((await officer.post("/api/officer/demo/parameters/preview", { weights: defaults })).body.rows as { barangayId: number; scoreNew: number }[]).map((r) => [r.barangayId, r.scoreNew]));

      await officer.post(`/api/officer/demo/parameters/${other}/activate`);
      const onlyOther = (await officer.get("/api/officer/demo/parameters")).body.versions.filter((v: { isActive: boolean }) => v.isActive);
      expect(onlyOther.map((v: { version: number }) => v.version)).toEqual([other]);

      const back = await officer.post("/api/officer/demo/parameters/1/activate");
      expect(back.body.isActive).toBe(true);
      const live = scoresOf(api);
      for (const id of Object.keys(original)) expect(live[Number(id)]).toBeCloseTo(original[id], 12);
      const versions = (await officer.get("/api/officer/demo/parameters")).body;
      expect(versions.active.version).toBe(1);
      expect(versions.versions.filter((v: { isActive: boolean }) => v.isActive).map((v: { version: number }) => v.version)).toEqual([1]);
    });

    it("answers 404 for a version that does not exist and 400 for a bad number", async () => {
      const officer = await api.officer();
      expect((await officer.post("/api/officer/demo/parameters/999/activate")).status).toBe(404);
      expect((await officer.post("/api/officer/demo/parameters/abc/activate")).status).toBe(400);
    });
  });
});
