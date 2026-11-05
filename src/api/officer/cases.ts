// Weekly case file: check it, import it, and the sample files for the demo.
// The CSV travels as text in the JSON body, so no upload package is needed.

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { listCaseImports } from "../../db/repositories/caseRepo";
import { AppError } from "../../errors";
import { validateCaseText } from "../../services/ingestion/caseImport";
import * as v from "../../validate";
import type { AppDeps } from "../deps";

const SAMPLES: Record<string, string> = {
  valid: "cases_valid.csv",
  errors: "cases_with_errors.csv",
  template: "cases_template.csv",
};

function caseText(body: unknown): string {
  const text = v.bodyObject(body).text;
  if (typeof text !== "string") throw new AppError(400, "Send the case file as text in the field `text`.");
  return text;
}

export function caseRoutes({ db, changes }: AppDeps): Router {
  const router = Router();

  // Checks every row and saves nothing.
  router.post("/cases/validate", (req, res) => {
    res.json(validateCaseText(db, caseText(req.body)).result);
  });

  // Saves only if every row is valid; otherwise 422 with the row errors and nothing saved.
  router.post("/cases/import", (req, res) => {
    const result = changes.importCases(caseText(req.body), req.officer!.id);
    res.status(result.success ? 201 : 422).json(result);
  });

  router.get("/cases/samples/:name", (req, res) => {
    const file = SAMPLES[String(req.params.name)];
    if (!file) throw new AppError(404, `Unknown sample. Use one of: ${Object.keys(SAMPLES).join(", ")}.`);
    res.json({ name: file, text: fs.readFileSync(path.resolve(process.cwd(), "data", file), "utf8") });
  });

  router.get("/cases/imports", (_req, res) => {
    res.json(listCaseImports(db, 10).map((r) => ({ ...r, errors: JSON.parse(r.errors) as string[] })));
  });

  return router;
}
