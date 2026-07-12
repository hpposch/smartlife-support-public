// Datenschutz-Seite eines Kontakts: Datenauskunft (JSON) und unwiderrufliche
// Anonymisierung (DSGVO). Nur für Admins.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { anonymizeContact } from "@/server/privacy";

async function runAnonymize(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "ANONYMISIEREN") return;
  await anonymizeContact(id, admin.id);
  redirect(`/contacts/${id}/privacy?done=1`);
}

export default async function ContactPrivacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { done } = await searchParams;
  const contact = await db.contact.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  });
  if (!contact) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">Datenschutz: {contact.name ?? contact.email}</h1>
      <p className="text-sm text-slate-500">
        {contact.email} · {contact._count.tickets} Ticket(s) · Kontakt seit{" "}
        {formatDateTime(contact.createdAt)}
      </p>

      {done && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Der Kontakt wurde anonymisiert.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Datenauskunft (Art. 15 DSGVO)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Alle gespeicherten Daten des Kontakts (Stammdaten, Tickets, Nachrichten) als JSON.
        </p>
        <a href={`/contacts/${contact.id}/export`} className="btn-secondary mt-3 inline-block">
          JSON herunterladen
        </a>
      </div>

      {contact.anonymizedAt ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Dieser Kontakt wurde am {formatDateTime(contact.anonymizedAt)} anonymisiert.
        </p>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-red-700">
            Anonymisieren (Art. 17 DSGVO) — unwiderruflich
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ersetzt Name, E-Mail und Telefonnummer, entfernt die B2C-Verknüpfung, schwärzt alle
            Nachrichteninhalte und Betreffzeilen und löscht sämtliche Anhänge. Tickets bleiben als
            anonyme Statistik-Datensätze erhalten. Beachten Sie: Anonymisierte Daten sind auch in
            künftigen Backups nicht mehr enthalten — bestehende Backups müssen separat bereinigt
            oder nach Frist gelöscht werden.
          </p>
          <form action={runAnonymize} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="id" value={contact.id} />
            <input
              name="confirm"
              required
              placeholder="Zur Bestätigung ANONYMISIEREN eintippen"
              className="input max-w-xs"
            />
            <button
              type="submit"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Anonymisieren
            </button>
          </form>
        </div>
      )}

      <Link href={`/tickets?q=${encodeURIComponent(contact.email)}`} className="text-sm text-blue-700 hover:underline">
        ← Tickets dieses Kontakts
      </Link>
    </div>
  );
}
