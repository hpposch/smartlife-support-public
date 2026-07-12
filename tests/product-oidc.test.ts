import { afterEach, describe, expect, it } from "vitest";
import { oidcConfigForProduct, productOidcConfig } from "../src/lib/b2c";

const product = {
  oidcAuthority: "https://login.plantbeat.io/oidc/v2.0",
  oidcClientId: "client-123",
  oidcSecretRef: "OIDC_PLANTBEAT_SECRET",
  portalUrl: "https://support.plantbeat.io",
};

afterEach(() => {
  delete process.env.OIDC_PLANTBEAT_SECRET;
  delete process.env.AZURE_B2C_CLIENT_ID;
  delete process.env.AZURE_B2C_CLIENT_SECRET;
  delete process.env.AZURE_B2C_AUTHORITY;
});

describe("productOidcConfig", () => {
  it("liefert null, wenn die Secret-ENV-Variable fehlt", () => {
    expect(productOidcConfig(product)).toBeNull();
  });

  it("baut Konfiguration mit Redirect auf die Produkt-Domain", () => {
    process.env.OIDC_PLANTBEAT_SECRET = "geheim";
    const config = productOidcConfig(product);
    expect(config?.clientId).toBe("client-123");
    expect(config?.clientSecret).toBe("geheim");
    expect(config?.redirectUri).toBe("https://support.plantbeat.io/portal/auth/b2c/callback");
  });

  it("fällt ohne Produkt-Konfiguration auf das globale B2C zurück", () => {
    process.env.AZURE_B2C_CLIENT_ID = "global-client";
    process.env.AZURE_B2C_CLIENT_SECRET = "global-secret";
    process.env.AZURE_B2C_AUTHORITY = "https://global.example/v2.0";
    const config = oidcConfigForProduct({
      oidcAuthority: null,
      oidcClientId: null,
      oidcSecretRef: null,
      portalUrl: null,
    });
    expect(config?.clientId).toBe("global-client");
  });
});
