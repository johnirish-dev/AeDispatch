// Starts the real app on a free port with a seeded in-memory database, a fixed
// clock the test can move, and a tiny HTTP client that keeps cookies.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SessionManager } from "../src/api/auth";
import { createApp } from "../src/app";
import { seedDatabase, OFFICER_PASSWORD, OFFICER_USERNAME } from "../src/db/seedDatabase";
import { DataChanges } from "../src/services/changes";
import { Decisions } from "../src/services/decisions";
import { RankingService } from "../src/services/ranking";
import { emptyDb } from "./helpers";

export const ANCHOR = "2026-11-19";

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  setCookie: string[];
}

export class Client {
  cookie = "";
  headers: Record<string, string> = {};

  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...this.headers, ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload, redirect: "manual" });
    const setCookie = res.headers.getSetCookie();
    const first = setCookie[0]?.split(";")[0];
    if (first) {
      // an empty value means "clear the cookie"
      this.cookie = first.endsWith("=") ? "" : first;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body ?? {});
  put = (path: string, body?: unknown) => this.request("PUT", path, body ?? {});
  delete = (path: string) => this.request("DELETE", path);

  async loginAsOfficer(): Promise<ApiResponse> {
    return this.post("/api/auth/login", { username: OFFICER_USERNAME, password: OFFICER_PASSWORD });
  }

  /** Sends the BHW token the way the BHW screens do. */
  withBhwToken(token: string): Client {
    this.headers = { authorization: `Bearer ${token}` };
    return this;
  }
}

export async function startApi() {
  const db = emptyDb();
  const summary = seedDatabase(db, { anchorDate: ANCHOR });

  let nowMs = new Date(`${ANCHOR}T09:00:00.000Z`).getTime();
  const clock = () => new Date(nowMs);
  const lines: string[] = [];
  const ranking = new RankingService(db, { clock, logger: (l) => lines.push(l) });
  ranking.start();
  // Replace the seed's stub scores with real ones before the test begins.
  ranking.rescoreAll({ reason: "baseline", alerts: false });
  lines.length = 0;

  const sessions = new SessionManager("test-secret", clock);
  const deps = { db, ranking, changes: new DataChanges(db, ranking), decisions: new Decisions(db, ranking), sessions };
  const server: Server = createApp(deps).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    db,
    ranking,
    sessions,
    deps,
    lines,
    baseUrl,
    bhwTokens: summary.bhwTokens,
    clock,
    advance: (ms: number) => {
      nowMs += ms;
    },
    client: () => new Client(baseUrl),
    async officer(): Promise<Client> {
      const c = new Client(baseUrl);
      const res = await c.loginAsOfficer();
      if (res.status !== 200) throw new Error("test officer could not sign in");
      return c;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type Api = Awaited<ReturnType<typeof startApi>>;
