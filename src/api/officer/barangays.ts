// Barangay profiles: list, add, edit and delete. Every change that can move a
// score goes through DataChanges, which re-scores afterwards.

import { Router } from "express";
import { getBarangay, listBarangays } from "../../db/repositories/barangayRepo";
import { AppError } from "../../errors";
import { requireRecentPassword } from "../auth";
import type { AppDeps } from "../deps";
import { idParam } from "../http";

export function barangayRoutes({ db, changes, sessions }: AppDeps): Router {
  const router = Router();

  router.get("/barangays", (_req, res) => {
    res.json(listBarangays(db));
  });

  router.get("/barangays/:id", (req, res) => {
    const b = getBarangay(db, idParam(req.params.id));
    if (!b) throw new AppError(404, "Barangay not found.");
    res.json(b);
  });

  router.post("/barangays", (req, res) => {
    const id = changes.createBarangay(req.body ?? {});
    res.status(201).json(getBarangay(db, id));
  });

  // Send any of name, municipality, population, areaKm2, and the full list of purok names. Editing and deleting need the
  // officer's password typed again within the last few minutes (POST /api/auth/confirm).
  router.put("/barangays/:id", requireRecentPassword(sessions), (req, res) => {
    const id = idParam(String(req.params.id));
    changes.updateBarangay(id, req.body ?? {});
    res.json(getBarangay(db, id));
  });

  router.delete("/barangays/:id", requireRecentPassword(sessions), (req, res) => {
    changes.deleteBarangay(idParam(String(req.params.id)));
    res.json({ ok: true });
  });

  return router;
}
