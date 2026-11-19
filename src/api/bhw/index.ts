// What the BHW screens can do with a barangay's access token: see the barangay's tasks and submit a survey.
// The token opens a barangay, not a person. Whoever did the interview is chosen on the form from the
// barangay's registered BHWs (GET /me lists them) and sent as `interviewerId`.

import { Router } from "express";
import { getBarangay } from "../../db/repositories/barangayRepo";
import { listBhwsOfBarangay } from "../../db/repositories/userRepo";
import { listRecentSurveysOfBarangay, listTasksForBarangay } from "../../db/repositories/workflowRepo";
import { addDays, formatDate } from "../../util/dates";
import * as v from "../../validate";
import type { AppDeps } from "../deps";

/** The list a BHW sees covers this many days back and at most this many surveys. */
export const BHW_LIST_DAYS = 30;
export const BHW_LIST_MAX = 200;

export function bhwRoutes({ db, changes, ranking }: AppDeps): Router {
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

  // The barangay's recent surveys, so every phone that holds the barangay link sees the same list. Container counts and
  // who did the interview, but never a household's details (see listRecentSurveysOfBarangay).
  router.get("/surveys", (req, res) => {
    const since = addDays(formatDate(ranking.now()), -BHW_LIST_DAYS);
    res.json(listRecentSurveysOfBarangay(db, req.bhwBarangayId!, since, BHW_LIST_MAX));
  });

  router.post("/surveys", (req, res) => {
    const body = v.bodyObject(req.body);
    const result = changes.submitSurvey(req.bhwBarangayId!, body as never);
    // 201 for a new survey; 200 when this clientSubmissionId was already saved (a repeated send changes nothing).
    if (result.duplicate) res.status(200).json({ surveyId: result.surveyId, duplicate: true });
    else res.status(201).json({ surveyId: result.surveyId });
  });

  return router;
}
