import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { hashPortalToken } from "@/lib/portal-token";
import { rateLimit } from "@/lib/ratelimit";
import { portalSessionOptions, type PortalSessionData } from "@/lib/portal-session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("portal-auth-ip", ip, { max: 20, windowSeconds: 900 });
  if (!allowed) return NextResponse.redirect(new URL("/portal/login?error=1", request.url));

  const { token } = await params;
  const record = await db.portalLoginToken.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    include: { contact: true },
  });

  const valid =
    record &&
    !record.usedAt &&
    record.expiresAt > new Date() &&
    !record.contact.isBlocked &&
    !record.contact.anonymizedAt;

  if (!valid) return NextResponse.redirect(new URL("/portal/login?error=1", request.url));

  await db.portalLoginToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  // Login beweist den E-Mail-Besitz → Kontakt gilt als verifiziert
  if (!record.contact.verifiedAt) {
    await db.contact.update({
      where: { id: record.contactId },
      data: { verifiedAt: new Date() },
    });
  }

  const session = await getIronSession<PortalSessionData>(
    await cookies(),
    portalSessionOptions()
  );
  session.contactId = record.contactId;
  await session.save();

  return NextResponse.redirect(new URL("/portal", request.url));
}
