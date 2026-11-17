// The Demo tools page: addresses for the QR codes, the weather simulator, and the weights.
// Team-only, but behind the same officer sign-in as the rest of /api/officer.

import { Router } from "express";
import { DemoTools, readWeights } from "../../services/demoTools";
import * as v from "../../validate";
import type { AppDeps } from "../deps";
import { idParam } from "../http";

export function demoRoutes({ db, ranking, changes }: AppDeps): Router {
  const router = Router();
  const tools = new DemoTools(db, ranking, changes);

  router.get("/demo/links", (_req, res) => {
    res.json(tools.links());
  });

  router.get("/demo/weather", (_req, res) => {
    res.json(tools.weatherState());
  });

  // { preset: "dry" | "normal" | "heavy_rain" }  or  { tempC, rainMm }, optionally { days }
  router.post("/demo/weather", (req, res) => {
    res.json(tools.simulateWeather(v.bodyObject(req.body)));
  });

  router.post("/demo/weather/reset", (_req, res) => {
    res.json(tools.resetWeather());
  });

  router.get("/demo/parameters", (_req, res) => {
    res.json(tools.versions());
  });

  // What the ranking would be with these weights. Saves nothing.
  router.post("/demo/parameters/preview", (req, res) => {
    const body = v.bodyObject(req.body);
    res.json({ rows: tools.preview(readWeights(body.weights)) });
  });

  // Saves a new version (not in use until it is activated).
  router.post("/demo/parameters", (req, res) => {
    const body = v.bodyObject(req.body);
    res.status(201).json(tools.saveVersion(readWeights(body.weights), body.note));
  });

  router.post("/demo/parameters/:version/activate", (req, res) => {
    res.json(tools.activate(idParam(req.params.version, "version")));
  });

  return router;
}
