// What a BHW can do with their token: see their tasks and submit a survey.
// Phase 7 builds the screens on top of these.

import { Router } from "express";
import { getBarangay } from "../../db/repositories/barangayRepo";
import { listTasksForBhw } from "../../db/repositories/workflowRepo";
import * as v from "../../validate";
import type { AppDeps } from "../deps";

export function bhwRoutes({ db, changes }: AppDeps): Router {
  const router = Router();

  router.get("/me", (req, res) => {
    const bhw = req.bhw!;
    const barangay = getBarangay(db, bhw.barangayId)!;
    res.json({
      id: bhw.id,
      name: bhw.displayName,
      team: bhw.teamLabel,
      barangay: { id: barangay.id, name: barangay.name },
      puroks: barangay.puroks.map((p) => ({ id: p.id, name: p.name })),
    });
  });

  router.get("/tasks", (req, res) => {
    res.json(listTasksForBhw(db, req.bhw!.id));
  });

  router.post("/surveys", (req, res) => {
    const body = v.bodyObject(req.body);
    const { surveyId } = changes.submitSurvey(req.bhw!, body as never);
    res.status(201).json({ surveyId });
  });

  return router;
}
