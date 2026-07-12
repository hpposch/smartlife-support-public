import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { b2cConfig, buildAuthUrl, newFlowState, type B2cFlowState } from "@/lib/b2c";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const config = b2cConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/portal/login?error=b2c", request.url));
  }

  const flow = newFlowState();
  // State/Nonce/PKCE-Verifier verschlüsselt im Cookie zwischenspeichern
  const session = await getIronSession<B2cFlowState>(await cookies(), {
    cookieName: "smartlife_b2c_flow",
    password: env.sessionSecret,
    ttl: 600,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });
  session.state = flow.state;
  session.nonce = flow.nonce;
  session.verifier = flow.verifier;
  await session.save();

  return NextResponse.redirect(await buildAuthUrl(config, flow));
}
