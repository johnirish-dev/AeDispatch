// Activity & dispatches: field assignments, submitted findings and the event timeline.
// Survey household details are visible to officers and BHWs only, so the
// list leaves them out and only the single-finding route returns them.

import { Router } from "express";
import { getFinding, listEvents, listFindings, listTasks } from "../../db/repositories/workflowRepo";
import { AppError } from "../../errors";
import * as v from "../../validate";
import type { AppDeps } from "../deps";
import { idParam } from "../http";

function optionalQueryInt(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : v.int(Number(value), name, 1, Number.MAX_SAFE_INTEGER);
}

function optionalQueryDate(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : v.dateText(value, name);
}

export function activityRoutes({ db }: AppDeps): Router {
  const router = Router();

  router.get("/assignments", (_req, res) => {
    res.json(listTasks(db));
  });

  // GET /api/officer/findings?barangayId=&bhwId=&from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get("/findings", (req, res) => {
    const from = optionalQueryDate(req.query.from, "from");
    const to = optionalQueryDate(req.query.to, "to");
    if (from && to && from > to) throw new AppError(400, "from must not be after to.");
    res.json(
      listFindings(db, {
        barangayId: optionalQueryInt(req.query.barangayId, "barangayId"),
        bhwId: optionalQueryInt(req.query.bhwId, "bhwId"),
        from,
        to,
      }),
    );
  });

  router.get("/findings/:id", (req, res) => {
    const finding = getFinding(db, idParam(req.params.id));
    if (!finding) throw new AppError(404, "Finding not found.");
    res.json(finding);
  });

  router.get("/events", (req, res) => {
    const limit = req.query.limit === undefined ? 50 : v.int(Number(req.query.limit), "limit", 1, 200);
    res.json(listEvents(db, limit));
  });

  return router;
}
