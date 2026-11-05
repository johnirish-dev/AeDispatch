// The ranked list, one barangay's decision view, and confirm / reject.

import { Router } from "express";
import { AppError } from "../../errors";
import { buildDecisionView, buildRankingView } from "../../services/views";
import type { AppDeps } from "../deps";
import { idParam } from "../http";

export function rankingRoutes({ db, ranking, decisions }: AppDeps): Router {
  const router = Router();

  // GET /api/officer/ranking?k=3  (k = teams available today)
  router.get("/ranking", (req, res) => {
    let k: number | undefined;
    if (req.query.k !== undefined) {
      k = Number(req.query.k);
      if (!Number.isInteger(k) || k < 0 || k > 1000) throw new AppError(400, "k must be a whole number from 0 to 1000.");
    }
    res.json(buildRankingView(db, ranking, k));
  });

  router.get("/barangays/:id/decision", (req, res) => {
    res.json(buildDecisionView(db, ranking, idParam(req.params.id)));
  });

  router.post("/barangays/:id/confirm", (req, res) => {
    res.status(201).json(decisions.confirm(req.officer!.id, idParam(req.params.id), req.body));
  });

  router.post("/barangays/:id/reject", (req, res) => {
    res.status(201).json(decisions.reject(req.officer!.id, idParam(req.params.id), req.body));
  });

  return router;
}
