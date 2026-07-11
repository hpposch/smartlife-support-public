// Azure AD B2C — OpenID Connect (Authorization Code Flow + PKCE) für das
// Kundenportal. Die Kundenkonten liegen in B2C; nach erfolgreichem Login
// wird der Kontakt über die B2C-Objekt-ID verknüpft (Fallback: E-Mail).
//
// Konfiguration (.env):
//   AZURE_B2C_TENANT        Tenant-Name, z. B. "smartlifekunden"
//                           (=> smartlifekunden.b2clogin.com / smartlifekunden.onmicrosoft.com)
//   AZURE_B2C_POLICY        User-Flow, z. B. "B2C_1_signin"
//   AZURE_B2C_CLIENT_ID     App-Registrierung (Web), Redirect-URI:
//                           {APP_URL}/portal/auth/b2c/callback
//   AZURE_B2C_CLIENT_SECRET Client-Secret der App-Registrierung
//   AZURE_B2C_AUTHORITY     optional: komplette Authority-URL überschreiben
//                           (Custom Domain oder Test-Stub)
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";

export interface B2cConfig {
  authority: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function b2cConfig(): B2cConfig | null {
  const clientId = process.env.AZURE_B2C_CLIENT_ID;
  const clientSecret = process.env.AZURE_B2C_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  let authority = process.env.AZURE_B2C_AUTHORITY;
  if (!authority) {
    const tenant = process.env.AZURE_B2C_TENANT;
    const policy = process.env.AZURE_B2C_POLICY;
    if (!tenant || !policy) return null;
    authority = `https://${tenant}.b2clogin.com/${tenant}.onmicrosoft.com/${policy}/v2.0`;
  }
  return {
    authority: authority.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri: `${env.appUrl}/portal/auth/b2c/callback`,
  };
}

export const isB2cEnabled = () => b2cConfig() !== null;

// ---------------------------------------------------------------------------
// Discovery (gecacht) + JWKS
// ---------------------------------------------------------------------------

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

let discoveryCache: { authority: string; metadata: OidcMetadata; fetchedAt: number } | null = null;
let jwksCache: { uri: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

export async function discover(config: B2cConfig): Promise<OidcMetadata> {
  const maxAgeMs = 60 * 60 * 1000;
  if (
    discoveryCache &&
    discoveryCache.authority === config.authority &&
    Date.now() - discoveryCache.fetchedAt < maxAgeMs
  ) {
    return discoveryCache.metadata;
  }
  const response = await fetch(`${config.authority}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`B2C-Discovery fehlgeschlagen: HTTP ${response.status}`);
  }
  const metadata = (await response.json()) as OidcMetadata;
  discoveryCache = { authority: config.authority, metadata, fetchedAt: Date.now() };
  return metadata;
}

function jwksFor(metadata: OidcMetadata) {
  if (!jwksCache || jwksCache.uri !== metadata.jwks_uri) {
    jwksCache = { uri: metadata.jwks_uri, jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)) };
  }
  return jwksCache.jwks;
}

// ---------------------------------------------------------------------------
// Authorization Code Flow + PKCE
// ---------------------------------------------------------------------------

export interface B2cFlowState {
  state: string;
  nonce: string;
  verifier: string;
}

export function newFlowState(): B2cFlowState {
  return {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
  };
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function buildAuthUrl(config: B2cConfig, flow: B2cFlowState): Promise<string> {
  const metadata = await discover(config);
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", `openid offline_access ${config.clientId}`);
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", codeChallenge(flow.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(
  config: B2cConfig,
  code: string,
  verifier: string
): Promise<{ idToken: string }> {
  const metadata = await discover(config);
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`B2C-Token-Austausch fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("B2C-Antwort enthält kein id_token");
  return { idToken: json.id_token };
}

export async function verifyIdToken(
  config: B2cConfig,
  idToken: string,
  expectedNonce: string
): Promise<JWTPayload> {
  const metadata = await discover(config);
  const { payload } = await jwtVerify(idToken, jwksFor(metadata), {
    issuer: metadata.issuer,
    audience: config.clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("Nonce stimmt nicht überein");
  return payload;
}

// ---------------------------------------------------------------------------
// Profil-Extraktion aus dem ID-Token
// ---------------------------------------------------------------------------

export interface B2cProfile {
  /** Objekt-ID des B2C-Kontos (oid, sonst sub) */
  objectId: string;
  email: string;
  name: string | null;
}

/**
 * B2C liefert die E-Mail je nach User-Flow unterschiedlich:
 * `emails` (Array), `email` oder `preferred_username`. Der Name kommt aus
 * `name` oder aus `given_name`/`family_name`.
 */
export function extractProfile(payload: JWTPayload): B2cProfile {
  const objectId = String(payload.oid ?? payload.sub ?? "");
  if (!objectId) throw new Error("ID-Token enthält keine Objekt-ID (oid/sub)");

  const emails = payload.emails;
  let email: string | undefined;
  if (Array.isArray(emails) && typeof emails[0] === "string") email = emails[0];
  else if (typeof payload.email === "string") email = payload.email;
  else if (typeof payload.preferred_username === "string" && payload.preferred_username.includes("@")) {
    email = payload.preferred_username;
  }
  if (!email) {
    throw new Error(
      "ID-Token enthält keine E-Mail — im B2C-User-Flow 'Email Addresses' als Anwendungsanspruch aktivieren"
    );
  }

  let name: string | null = typeof payload.name === "string" ? payload.name : null;
  if (!name) {
    const parts = [payload.given_name, payload.family_name].filter(
      (p): p is string => typeof p === "string"
    );
    name = parts.length > 0 ? parts.join(" ") : null;
  }

  return { objectId, email: email.toLowerCase().trim(), name };
}

/** Abmelde-URL bei B2C (beendet auch die SSO-Session), null wenn nicht unterstützt. */
export async function logoutUrl(config: B2cConfig): Promise<string | null> {
  const metadata = await discover(config);
  if (!metadata.end_session_endpoint) return null;
  const url = new URL(metadata.end_session_endpoint);
  url.searchParams.set("post_logout_redirect_uri", `${env.appUrl}/portal/login`);
  return url.toString();
}
