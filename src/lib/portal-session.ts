// Getrennter Auth-Kontext fürs Kundenportal: eigenes Cookie, eigene Session —
// Agenten-Session und Portal-Session sind niemals austauschbar.
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "./db";
import { env } from "./env";

export interface PortalSessionData {
  contactId?: string;
}

export const portalSessionOptions: SessionOptions = {
  cookieName: "smartlife_portal_session",
  password: env.sessionSecret,
  ttl: 60 * 60 * 24 * 30, // 30 Tage
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

export async function getPortalSession() {
  return getIronSession<PortalSessionData>(await cookies(), portalSessionOptions);
}

export const getCurrentContact = cache(async () => {
  const session = await getPortalSession();
  if (!session.contactId) return null;
  const contact = await db.contact.findUnique({
    where: { id: session.contactId },
    include: { organization: true },
  });
  if (!contact || contact.isBlocked || contact.anonymizedAt) return null;
  return contact;
});

export async function requireContact() {
  const contact = await getCurrentContact();
  if (!contact) redirect("/portal/login");
  return contact;
}
