// Agenten-Dashboard („Meine Übersicht“) — angelehnt an BoldDesk: Kennzahlen-
// Kacheln mit Absprung in die vorgefilterte Ticketliste + jüngste eigene Tickets.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_COLORS, STATUS_LABELS, formatRelative } from "@/lib/labels";

const ACTIVE = ["new", "open", "pending_customer", "pending_internal"] as const;

function Tile({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "warn" | "danger";
}) {
  const color =
    tone === "danger" && value > 0
      ? "text-red-600"
      : tone === "warn" && value > 0
        ? "text-amber-600"
        : "text-slate-900";
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{value}</p>
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [mineOpen, unassigned, pendingCustomer, responseDue, resolutionDue, recent] =
    await Promise.all([
      db.ticket.count({ where: { assigneeId: user.id, status: { in: [...ACTIVE] } } }),
      db.ticket.count({ where: { assigneeId: null, status: { in: [...ACTIVE] } } }),
      db.ticket.count({ where: { assigneeId: user.id, status: "pending_customer" } }),
      db.ticket.count({
        where: {
          status: { in: [...ACTIVE] },
          slaPausedAt: null,
          firstRepliedAt: null,
          firstResponseDueAt: { lt: now },
        },
      }),
      db.ticket.count({
        where: {
          status: { in: [...ACTIVE] },
          slaPausedAt: null,
          resolvedAt: null,
          resolutionDueAt: { lt: now },
        },
      }),
      db.ticket.findMany({
        where: { assigneeId: user.id, status: { in: [...ACTIVE] } },
        include: { contact: true, product: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
    ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Meine Übersicht</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Mir zugewiesen (offen)" value={mineOpen} href="/tickets?assignee=me&status=active" />
        <Tile label="Nicht zugewiesen" value={unassigned} href="/tickets?assignee=none&status=active" tone="warn" />
        <Tile label="Wartet auf Kunde" value={pendingCustomer} href="/tickets?assignee=me&status=pending_customer" />
        <Tile label="Erstreaktion überfällig" value={responseDue} href="/tickets?sla=response&status=active" tone="danger" />
        <Tile label="Lösung überfällig" value={resolutionDue} href="/tickets?sla=resolution&status=active" tone="danger" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Meine zuletzt aktualisierten Tickets</h2>
          <Link href="/tickets?assignee=me&status=active" className="text-xs text-blue-700 hover:underline">
            Alle anzeigen →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            Aktuell sind Ihnen keine offenen Tickets zugewiesen.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="tabular-nums text-slate-400">#{ticket.number}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{ticket.subject}</span>
                  <span className="hidden text-slate-500 sm:inline">
                    {ticket.contact.name ?? ticket.contact.email}
                  </span>
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                    {ticket.product.name}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>
                    {STATUS_LABELS[ticket.status]}
                  </span>
                  <span className="w-24 text-right text-xs text-slate-400">
                    {formatRelative(ticket.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
