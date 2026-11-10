// The last saved evaluation, for the Demo tools page. Read-only: it never starts a run (the full
// experiment takes a while and is started from the command line with `npm run evaluate`).

import { Router } from "express";
import { readEvaluation } from "../../eval/reports";
import { AppError } from "../../errors";

export function evaluationRoutes(): Router {
  const router = Router();

  router.get("/evaluation", (_req, res) => {
    const saved = readEvaluation();
    if (!saved) throw new AppError(404, "No evaluation has been run yet. Run npm run evaluate.");
    res.json(saved);
  });

  return router;
}
