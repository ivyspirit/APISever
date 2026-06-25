import type { Response } from "express";

/**
 * The one error shape shared by every endpoint:
 * `{ "error": { "code": "...", "message": "..." } }` (SPEC.md 5a).
 */
export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}
