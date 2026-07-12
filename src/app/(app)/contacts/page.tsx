// Kontakte-Verwaltung — angelehnt an BoldDesk: Liste mit Status
// (Verifiziert / Unverifiziert / Blockiert), Suche, Statusfilter und Aktionen.
// Kontakte werden automatisch verifiziert, sobald sie sich einloggen
// (Magic-Link oder B2C); Agenten können den Status manuell setzen.
import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatRelative } from "@/lib/labels";

const PAGE_SIZE = 50;

async function toggleVerified(formData: FormData) {
  "use server";
  await requireUser();
  const id = String(formData.get("id"));
  const contact = await db.contact.findUniqueOrThrow({ where: { id } });
  await db.contact.update({
    where: { id },
    data: { verifiedAt: contact.verifiedAt ? null : new Date() },
  });
  revalidatePath("/contacts");
}

async function toggleBlocked(formData: FormData) {
  "use server";
  await requireUser();
  const id = String(formData.get("id"));
  const contact = await db.contact.findUniqueOrThrow({ where: { id } });
  await db.contact.update({ where: { id }, data: { isBlocked: !contact.isBlocked } });
  revalidatePath("/contacts");
}

function StatusBadge({
  contact,
}: {
  contact: { isBlocked: boolean; verifiedAt: Date | null; anonymizedAt: Date | null };
}) {
  if (contact.anonymizedAt) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Anonymisiert</span>;
  }
  if (contact.isBlocked) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">⊘ Blockiert</span>;
  }
  if (contact.verifiedAt) {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Verifiziert</span>;
  }
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Unverifiziert</span>;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireUser();
  const { q, status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const where: Prisma.ContactWhereInput = {
    ...(q?.trim()
      ? {
          OR: [
            { email: { contains: q.trim(), mode: "insensitive" } },
            { name: { contains: q.trim(), mode: "insensitive" } },
            { organization: { name: { contains: q.trim(), mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(status === "verified" ? { verifiedAt: { not: null }, isBlocked: false } : {}),
    ...(status === "unverified" ? { verifiedAt: null, isBlocked: false, anonymizedAt: null } : {}),
    ...(status === "blocked" ? { isBlocked: true } : {}),
  };

  const [contacts, total, counts] = await Promise.all([
    db.contact.findMany({
      where,
      include: { organization: true, _count: { select: { tickets: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.contact.count({ where }),
    Promise.all([
      db.contact.count({ where: { verifiedAt: { not: null }, isBlocked: false } }),
      db.contact.count({ where: { verifiedAt: null, isBlocked: false, anonymizedAt: null } }),
      db.contact.count({ where: { isBlocked: true } }),
    ]),
  ]);
  const [verifiedCount, unverifiedCount, blockedCount] = counts;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusTabs = [
    { key: "", label: `Alle` },
    { key: "verified", label: `Verifiziert (${verifiedCount})` },
    { key: "unverified", label: `Unverifiziert (${unverifiedCount})` },
    { key: "blocked", label: `Blockiert (${blockedCount})` },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Kontakte <span className="text-sm font-normal text-slate-500">({total})</span>
        </h1>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {statusTabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/contacts?status=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full border px-2.5 py-1 shadow-sm ${
              (status ?? "") === tab.key
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white hover:text-blue-700"
            }`}
          >
            {tab.label}
          </Link>
        ))}
        <form method="GET" className="ml-auto flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q ?? ""} placeholder="Name, E-Mail, Firma …" className="input w-64" />
          <button type="submit" className="btn-secondary">
            Suchen
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">E-Mail</th>
              <th className="px-4 py-2.5">Telefon</th>
              <th className="px-4 py-2.5">Firma</th>
              <th className="px-4 py-2.5">Tickets</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Erstellt</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  Keine Kontakte gefunden.
                </td>
              </tr>
            )}
            {contacts.map((contact) => (
              <tr key={contact.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{contact.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{contact.email}</td>
                <td className="px-4 py-2.5 text-slate-500">{contact.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{contact.organization?.name ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/tickets?q=${encodeURIComponent(contact.email)}&status=`}
                    className="tabular-nums text-blue-700 hover:underline"
                  >
                    {contact._count.tickets}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge contact={contact} />
                </td>
                <td className="px-4 py-2.5 text-slate-500">{formatRelative(contact.createdAt)}</td>
                <td className="px-4 py-2.5">
                  {!contact.anonymizedAt && (
                    <span className="flex justify-end gap-3 text-xs">
                      {!contact.isBlocked && (
                        <form action={toggleVerified}>
                          <input type="hidden" name="id" value={contact.id} />
                          <button type="submit" className="text-blue-700 hover:underline">
                            {contact.verifiedAt ? "Verifizierung aufheben" : "Verifizieren"}
                          </button>
                        </form>
                      )}
                      <form action={toggleBlocked}>
                        <input type="hidden" name="id" value={contact.id} />
                        <button
                          type="submit"
                          className={contact.isBlocked ? "text-emerald-700 hover:underline" : "text-red-600 hover:underline"}
                        >
                          {contact.isBlocked ? "Entsperren" : "Blockieren"}
                        </button>
                      </form>
                      <Link
                        href={`/contacts/${contact.id}/privacy`}
                        className="text-slate-400 hover:text-slate-600 hover:underline"
                      >
                        Datenschutz
                      </Link>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          Seite {page} von {totalPages}
          {page > 1 && (
            <Link className="btn-secondary" href={{ query: { q, status, page: page - 1 } }}>
              Zurück
            </Link>
          )}
          {page < totalPages && (
            <Link className="btn-secondary" href={{ query: { q, status, page: page + 1 } }}>
              Weiter
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
