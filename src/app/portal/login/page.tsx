import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentContact } from "@/lib/portal-session";
import {
  generatePortalToken,
  hashPortalToken,
  portalTokenExpiry,
} from "@/lib/portal-token";
import { queues } from "@/lib/queue";
import { rateLimit } from "@/lib/ratelimit";
import { findOrCreateContact } from "@/server/contacts";

async function requestLoginLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/portal/login?sent=1");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const [byIp, byEmail] = await Promise.all([
    rateLimit("portal-link-ip", ip, { max: 10, windowSeconds: 3600 }),
    rateLimit("portal-link-email", email, { max: 3, windowSeconds: 900 }),
  ]);
  // Immer dieselbe Antwort — keine Information, ob die Adresse existiert
  if (byIp.allowed && byEmail.allowed) {
    const contact = await findOrCreateContact(db, email);
    if (!contact.isBlocked && !contact.anonymizedAt) {
      const token = generatePortalToken();
      await db.portalLoginToken.create({
        data: {
          contactId: contact.id,
          tokenHash: hashPortalToken(token),
          expiresAt: portalTokenExpiry(),
        },
      });
      await queues().notify.add("portal_login", {
        kind: "portal_login",
        contactId: contact.id,
        token,
      });
    }
  }
  redirect("/portal/login?sent=1");
}

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const contact = await getCurrentContact();
  if (contact) redirect("/portal");

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold">Supportportal</h1>
      <p className="mb-6 text-sm text-slate-500">
        Geben Sie Ihre E-Mail-Adresse ein — wir senden Ihnen einen Anmeldelink.
      </p>
      {params.sent && (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Falls die Adresse bei uns registriert ist, wurde ein Anmeldelink versendet.
          Bitte prüfen Sie Ihr Postfach (Link 30 Minuten gültig).
        </p>
      )}
      {params.error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Der Anmeldelink ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.
        </p>
      )}
      <form action={requestLoginLink} className="space-y-4">
        <input
          name="email"
          type="email"
          required
          autoFocus
          placeholder="ihre@email.de"
          className="input"
        />
        <button type="submit" className="btn-primary w-full justify-center">
          Anmeldelink senden
        </button>
      </form>
    </div>
  );
}
