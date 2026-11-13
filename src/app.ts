import express from "express";
import path from "node:path";
import { authRoutes, requireBhw, requireOfficer } from "./api/auth";
import type { AppDeps } from "./api/deps";
import { errorHandler, notFound } from "./api/http";
import { activityRoutes } from "./api/officer/activity";
import { barangayRoutes } from "./api/officer/barangays";
import { caseRoutes } from "./api/officer/cases";
import { evaluationRoutes } from "./api/officer/evaluation";
import { rankingRoutes } from "./api/officer/ranking";
import { bhwRoutes } from "./api/bhw";

// The app is built here and started in server.ts, so tests can use it without
// opening a fixed port. Without `deps` it serves only the health check.
export function createApp(deps?: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // a 1 MB case file, plus JSON escaping

  app.get("/", (_req, res) => {
    res.redirect(302, "/officer/");
  });
  app.use(express.static(path.join(__dirname, "web")));
  app.use(express.static(path.join(__dirname, "..", "src", "web")));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (deps) {
    app.use("/api/auth", authRoutes(deps.db, deps.sessions));
    // Officer routes need the signed-in session; BHW routes need a valid token.
    app.use("/api/officer", requireOfficer(deps.sessions), rankingRoutes(deps), caseRoutes(deps), barangayRoutes(deps), activityRoutes(deps), evaluationRoutes());
    app.use("/api/bhw", requireBhw(deps.db), bhwRoutes(deps));
  }

  app.use("/api", notFound);
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not Found");
  });
  app.use(errorHandler);
  return app;
}
