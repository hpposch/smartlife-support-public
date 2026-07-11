// Lokaler OIDC-Stub, der Azure AD B2C simuliert — für End-to-End-Tests des
// Portal-Logins ohne echten Tenant. NICHT für Produktion.
//
//   npx tsx scripts/b2c-stub.ts [port] [email] [name]
//
// Die App dagegen konfigurieren:
//   AZURE_B2C_AUTHORITY=http://localhost:4444
//   AZURE_B2C_CLIENT_ID=stub-client  AZURE_B2C_CLIENT_SECRET=stub-secret
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const port = Number(process.argv[2] ?? 4444);
const email = process.argv[3] ?? "b2c-kunde@example.com";
const displayName = process.argv[4] ?? "B2C Testkunde";
const issuer = `http://localhost:${port}`;
const objectId = process.env.STUB_OBJECT_ID ?? randomUUID();

// code → nonce der zugehörigen Authorize-Anfrage
const issuedCodes = new Map<string, string>();

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "stub-key", use: "sig", alg: "RS256" };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer);

    if (url.pathname === "/.well-known/openid-configuration") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
          end_session_endpoint: `${issuer}/logout`,
        })
      );
      return;
    }

    if (url.pathname === "/keys") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (url.pathname === "/authorize") {
      // "Login" sofort erfolgreich — Code ausstellen und zurückleiten
      const code = randomUUID();
      issuedCodes.set(code, url.searchParams.get("nonce") ?? "");
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.statusCode = 302;
      res.setHeader("Location", redirect.toString());
      res.end();
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const nonce = issuedCodes.get(params.get("code") ?? "");
      if (nonce === undefined) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      issuedCodes.delete(params.get("code")!);
      const idToken = await new SignJWT({
        oid: objectId,
        emails: [email],
        name: displayName,
        nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "stub-key" })
        .setIssuer(issuer)
        .setAudience(params.get("client_id") ?? "stub-client")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id_token: idToken, token_type: "Bearer" }));
      return;
    }

    if (url.pathname === "/logout") {
      const back = url.searchParams.get("post_logout_redirect_uri");
      res.statusCode = 302;
      res.setHeader("Location", back ?? issuer);
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`B2C-Stub läuft auf ${issuer} (Konto: ${email}, oid: ${objectId})`);
  });
}

main();
