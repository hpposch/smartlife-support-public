import { describe, expect, it } from "vitest";
import {
  generatePortalToken,
  hashPortalToken,
  portalTokenExpiry,
  PORTAL_TOKEN_TTL_MINUTES,
} from "../src/lib/portal-token";

describe("portal-token", () => {
  it("erzeugt lange, eindeutige Tokens", () => {
    const a = generatePortalToken();
    const b = generatePortalToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hasht deterministisch und nicht-trivial", () => {
    const token = generatePortalToken();
    expect(hashPortalToken(token)).toBe(hashPortalToken(token));
    expect(hashPortalToken(token)).not.toContain(token);
    expect(hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Ablauf liegt in der Zukunft", () => {
    const expiry = portalTokenExpiry().getTime() - Date.now();
    expect(expiry).toBeGreaterThan((PORTAL_TOKEN_TTL_MINUTES - 1) * 60 * 1000);
    expect(expiry).toBeLessThanOrEqual(PORTAL_TOKEN_TTL_MINUTES * 60 * 1000);
  });
});
