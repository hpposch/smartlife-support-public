import { afterEach, describe, expect, it } from "vitest";
import { b2cConfig, codeChallenge, extractProfile, newFlowState } from "../src/lib/b2c";

const B2C_KEYS = [
  "AZURE_B2C_TENANT",
  "AZURE_B2C_POLICY",
  "AZURE_B2C_CLIENT_ID",
  "AZURE_B2C_CLIENT_SECRET",
  "AZURE_B2C_AUTHORITY",
];

afterEach(() => {
  for (const key of B2C_KEYS) delete process.env[key];
});

describe("b2cConfig", () => {
  it("ist null ohne Konfiguration", () => {
    expect(b2cConfig()).toBeNull();
  });

  it("baut die Authority aus Tenant + Policy", () => {
    process.env.AZURE_B2C_TENANT = "smartlifekunden";
    process.env.AZURE_B2C_POLICY = "B2C_1_signin";
    process.env.AZURE_B2C_CLIENT_ID = "client-id";
    process.env.AZURE_B2C_CLIENT_SECRET = "secret";
    expect(b2cConfig()?.authority).toBe(
      "https://smartlifekunden.b2clogin.com/smartlifekunden.onmicrosoft.com/B2C_1_signin/v2.0"
    );
  });

  it("erlaubt Authority-Override (Custom Domain)", () => {
    process.env.AZURE_B2C_CLIENT_ID = "client-id";
    process.env.AZURE_B2C_CLIENT_SECRET = "secret";
    process.env.AZURE_B2C_AUTHORITY = "https://login.example.com/t/p/v2.0/";
    expect(b2cConfig()?.authority).toBe("https://login.example.com/t/p/v2.0");
  });
});

describe("PKCE", () => {
  it("Challenge ist SHA-256/base64url des Verifiers (RFC-7636-Testvektor)", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("Flow-State ist zufällig", () => {
    const a = newFlowState();
    const b = newFlowState();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier.length).toBeGreaterThanOrEqual(40);
  });
});

describe("extractProfile", () => {
  it("liest oid und emails[] (B2C-Standard)", () => {
    const profile = extractProfile({
      oid: "11111111-2222-3333-4444-555555555555",
      emails: ["Kunde@Example.COM"],
      name: "Max Mustermann",
    });
    expect(profile).toEqual({
      objectId: "11111111-2222-3333-4444-555555555555",
      email: "kunde@example.com",
      name: "Max Mustermann",
    });
  });

  it("fällt auf sub, email und given/family_name zurück", () => {
    const profile = extractProfile({
      sub: "sub-id",
      email: "a@b.de",
      given_name: "Max",
      family_name: "Mustermann",
    });
    expect(profile.objectId).toBe("sub-id");
    expect(profile.name).toBe("Max Mustermann");
  });

  it("wirft ohne E-Mail-Anspruch einen verständlichen Fehler", () => {
    expect(() => extractProfile({ oid: "x" })).toThrow(/E-Mail/);
  });

  it("wirft ohne Objekt-ID", () => {
    expect(() => extractProfile({ emails: ["a@b.de"] })).toThrow(/Objekt-ID/);
  });
});
