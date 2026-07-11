import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { b2cConfig, exchangeCode, extractProfile, verifyIdToken, type B2cFlowState } from "@/lib/b2c";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { portalSessionOptions, type PortalSessionData } from "@/lib/portal-session";
import { rateLimit } from "@/lib/ratelimit";
import { findOrCreateB2cContact } from "@/server/contacts";

function loginError(reason: string) {
  console.error(`[b2c] Login fehlgeschlagen: ${reason}`);
  return NextResponse.redirect(new URL("/portal/login?error=b2c", env.appUrl));
}

export async function GET(request: NextRequest) {
  const config = b2cConfig();
  if (!config) return loginError("nicht konfiguriert");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("b2c-callback-ip", ip, { max: 30, windowSeconds: 900 });
  if (!allowed) return loginError("Rate-Limit");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    // z. B. Nutzer bricht den B2C-Dialog ab (access_denied)
    return NextResponse.redirect(new URL("/portal/login", env.appUrl));
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return loginError("code/state fehlt");

  const flow = await getIronSession<B2cFlowState>(await cookies(), {
    cookieName: "smartlife_b2c_flow",
    password: env.sessionSecret,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });
  if (!flow.state || flow.state !== state) return loginError("State ungültig");

  try {
    const { idToken } = await exchangeCode(config, code, flow.verifier);
    const payload = await verifyIdToken(config, idToken, flow.nonce);
    const profile = extractProfile(payload);

    const contact = await findOrCreateB2cContact(db, profile);
    if (contact.isBlocked || contact.anonymizedAt) return loginError("Kontakt gesperrt");

    flow.destroy();
    const session = await getIronSession<PortalSessionData>(
      await cookies(),
      portalSessionOptions
    );
    session.contactId = contact.id;
    await session.save();

    return NextResponse.redirect(new URL("/portal", env.appUrl));
  } catch (error) {
    return loginError(String(error));
  }
}
