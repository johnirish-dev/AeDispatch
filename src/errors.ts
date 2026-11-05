// An error that carries the HTTP status the API should answer with. Services
// throw it; the API's error handler turns it into { error: "..." }.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** SQLite reports a violated UNIQUE rule with this code. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}
