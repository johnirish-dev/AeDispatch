// Shared HTTP plumbing: the 404 for unknown API paths and one error handler
// that turns every failure into JSON `{ "error": "..." }`.

import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, isUniqueViolation } from "../errors";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // express.json() problems: broken JSON or a body that is too large
  const type = (err as { type?: string }).type;
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: "The request body is too large." });
    return;
  }
  // A database rule we did not check first: report it as a conflict, not a crash.
  if (isUniqueViolation(err)) {
    res.status(409).json({ error: "That already exists." });
    return;
  }
  const code = (err as { code?: string }).code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
    res.status(400).json({ error: "The data breaks a rule of the database." });
    return;
  }
  console.error("[api] unexpected error:", err);
  res.status(500).json({ error: "Something went wrong on the server." });
};

/** Reads a numeric id from a route parameter, or throws a 400. */
export function idParam(value: string | undefined, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, `${name} must be a positive whole number.`);
  return n;
}
