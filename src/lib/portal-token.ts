import { createHash, randomBytes } from "node:crypto";

export const PORTAL_TOKEN_TTL_MINUTES = 30;

/** Roh-Token für den Magic-Link (nur in der E-Mail, nie in der DB). */
export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

/** In der DB liegt nur der Hash — ein DB-Leak gibt keine gültigen Links preis. */
export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function portalTokenExpiry(): Date {
  return new Date(Date.now() + PORTAL_TOKEN_TTL_MINUTES * 60 * 1000);
}
