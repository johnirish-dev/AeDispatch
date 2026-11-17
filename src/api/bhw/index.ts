// What the BHW screens can do with a barangay's access token: see the barangay's tasks and submit a survey.
// The token opens a barangay, not a person. Whoever did the interview is chosen on the form from the
// barangay's registered BHWs (GET /me lists them) and sent as `interviewerId`.

import { Router } from "express";
import { getBarangay } from "../../db/repositories/barangayRepo";
import { listBhwsOfBarangay } from "../../db/repositories/userRepo";
import { listTasksForBarangay } from "../../db/repositories/workflowRepo";
import * as v from "../../validate";
import type { AppDeps } from "../deps";

export function bhwRoutes({ db, changes }: AppDeps): Router {
  const router = Router();

  router.get("/me", (req, res) => {
    const barangay = getBarangay(db, req.bhwBarangayId!)!;
    res.json({
      barangay: { id: barangay.id, name: barangay.name },
      puroks: barangay.puroks.map((p) => ({ id: p.id, name: p.name })),
      // For the "Interviewed by" dropdown.
      bhws: listBhwsOfBarangay(db, barangay.id).map((b) => ({ id: b.id, name: b.displayName, team: b.teamLabel })),
    });
  });

  router.get("/tasks", (req, res) => {
    res.json(listTasksForBarangay(db, req.bhwBarangayId!));
  });

  router.post("/surveys", (req, res) => {
    const body = v.bodyObject(req.body);
    const { surveyId } = changes.submitSurvey(req.bhwBarangayId!, body as never);
    res.status(201).json({ surveyId });
  });

  return router;
}
