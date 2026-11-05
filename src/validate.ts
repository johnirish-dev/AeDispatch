// Small input checks used by the services and the API. Each one throws an
// AppError(400) with a message that names the field, so the client can show it.

import { AppError } from "./errors";
import { isValidDate } from "./util/dates";

const bad = (message: string): never => {
  throw new AppError(400, message);
};

export function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string") return bad(`${name} is required.`);
  const t = value.trim().replace(/\s+/g, " ");
  if (t === "") return bad(`${name} is required.`);
  if (t.length > max) return bad(`${name} must be at most ${max} characters.`);
  return t;
}

export function optionalText(value: unknown, name: string, max = 200): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, name, max);
}

export function int(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return bad(`${name} must be a whole number.`);
  if (value < min || value > max) return bad(`${name} must be from ${min} to ${max}.`);
  return value;
}

export function optionalInt(value: unknown, name: string, min: number, max: number): number | undefined {
  return value === undefined || value === null ? undefined : int(value, name, min, max);
}

/** A number greater than `min` (not equal) and at most `max`. */
export function numberAbove(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${name} must be a number.`);
  if (value <= min || value > max) return bad(`${name} must be more than ${min} and at most ${max}.`);
  return value;
}

export function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") return bad(`${name} must be true or false.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return bad(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/** A real calendar date written YYYY-MM-DD. */
export function dateText(value: unknown, name: string): string {
  if (typeof value !== "string" || !isValidDate(value)) return bad(`${name} must be a date like 2026-11-19.`);
  return value;
}

/** The body of a request as a plain object (Express leaves it undefined when there is none). */
export function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
