import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totpCode, totpUri, verifyTotp } from "../src/lib/totp";

describe("totp", () => {
  it("Base32 round-trip", () => {
    const buffer = Buffer.from("Hallo Welt!");
    expect(base32Decode(base32Encode(buffer)).toString()).toBe("Hallo Welt!");
  });

  it("RFC-6238-Testvektor (SHA-1, T=59s → 287082)", () => {
    // Secret "12345678901234567890" = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
  });

  it("verifyTotp akzeptiert ±1 Zeitfenster, lehnt Falsches ab", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 59_000;
    expect(verifyTotp(secret, "287082", now)).toBe(true);
    expect(verifyTotp(secret, "287082", now + 30_000)).toBe(true); // vorheriges Fenster
    expect(verifyTotp(secret, "000000", now)).toBe(false);
    expect(verifyTotp(secret, "28708", now)).toBe(false);
  });

  it("totpUri enthält Secret, Konto und Issuer", () => {
    const uri = totpUri("ABC234", "agent@example.com", "smartlife");
    expect(uri).toContain("otpauth://totp/smartlife:agent%40example.com");
    expect(uri).toContain("secret=ABC234");
  });
});
