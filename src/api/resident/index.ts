// What a resident can do. Most of it needs no sign-in: reading the risk level, the daily question and
// the symptom check. Only the household report needs the PIN sign-in.

import { Router } from "express";
import { requireResident } from "../auth";
import { idParam } from "../http";
import { ResidentAuth } from "../../services/residentAuth";
import { ResidentViews } from "../../services/residentViews";
import * as v from "../../validate";
import type { AppDeps } from "../deps";

// Used only when PHONE_HASH_SALT is not set (local development). It must stay the same between
// runs, otherwise the same phone number would become a new resident after every restart.
const DEVELOPMENT_SALT = "aedispatch-development-salt";

export function residentRoutes({ db, ranking, changes, sessions }: AppDeps): Router {
  const router = Router();
  const auth = new ResidentAuth(db, ranking, process.env.PHONE_HASH_SALT || DEVELOPMENT_SALT);
  const views = new ResidentViews(db);

  router.get("/barangays", (_req, res) => {
    res.json(views.barangays());
  });

  router.get("/barangays/:id", (req, res) => {
    res.json(views.barangay(idParam(req.params.id)));
  });

  // The daily question: no sign-in, no person stored.
  router.post("/barangays/:id/daily-answer", (req, res) => {
    const body = v.bodyObject(req.body);
    res.status(201).json(changes.recordAnonymousAnswer(idParam(req.params.id), body.answer));
  });

  // The symptom check: only an anonymous count is kept, never the result.
  router.post("/barangays/:id/symptom-check", (req, res) => {
    const body = v.bodyObject(req.body);
    changes.recordSymptomCheck(idParam(req.params.id), body.warningSigns);
    res.status(201).json({ saved: true });
  });

  router.post("/auth/send-pin", (req, res) => {
    const body = v.bodyObject(req.body);
    res.json(auth.sendPin(body.phone));
  });

  router.post("/auth/verify", (req, res) => {
    const body = v.bodyObject(req.body);
    const barangayId = v.int(body.barangayId, "barangayId", 1, Number.MAX_SAFE_INTEGER);
    const result = auth.verifyPin(body.phone, body.pin, barangayId);
    if (!result.ok) {
      res.json(result);
      return;
    }
    sessions.startResident(res, result.residentId);
    res.json({ ok: true });
  });

  router.post("/auth/logout", (req, res) => {
    sessions.end(req, res, "aed_resident");
    res.json({ ok: true });
  });

  // Lets the page find out whether its sign-in is still valid (sessions last 8 hours).
  router.get("/me", requireResident(sessions), (_req, res) => {
    res.json({ signedIn: true });
  });

  // The report goes to the barangay the resident chose when signing in.
  router.post("/household-report", requireResident(sessions), (req, res) => {
    const body = v.bodyObject(req.body);
    changes.recordHouseholdReport(req.residentId!, {
      standingWater: body.standingWater,
      cloggedGutter: body.cloggedGutter,
      oldContainers: body.oldContainers,
      bitesIndoors: body.bitesIndoors,
    });
    res.status(201).json({ saved: true });
  });

  return router;
}
