import Link from "next/link";
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatRelative,
} from "@/lib/labels";

const PAGE_SIZE = 50;

interface Filters {
  status?: string;
  priority?: string;
  assignee?: string;
  q?: string;
  page?: string;
}

export default async function TicketListPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const user = await requireUser();
  const filters = await searchParams;
  const page = Math.max(1, Number(filters.page) || 1);

  const where: Prisma.TicketWhereInput = {};
  if (filters.status === "active") {
    where.status = { in: ["new", "open", "pending_customer", "pending_internal"] };
  } else if (filters.status && filters.status in STATUS_LABELS) {
    where.status = filters.status as TicketStatus;
  }
  if (filters.priority && filters.priority in PRIORITY_LABELS) {
    where.priority = filters.priority as TicketPriority;
  }
  if (filters.assignee === "me") where.assigneeId = user.id;
  else if (filters.assignee === "none") where.assigneeId = null;
  if (filters.q) {
    const q = filters.q.trim();
    const asNumber = Number(q.replace(/^#/, ""));
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { contact: { email: { contains: q, mode: "insensitive" } } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
      ...(Number.isInteger(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
      { messages: { some: { bodyText: { contains: q, mode: "insensitive" as const } } } },
    ];
  }

  const [tickets, total] = await Promise.all([
    db.ticket.findMany({
      where,
      include: { contact: true, assignee: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.ticket.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Tickets <span className="text-sm font-normal text-slate-500">({total})</span>
        </h1>
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2" method="GET">
        <select name="status" defaultValue={filters.status ?? "active"} className="input w-auto">
          <option value="active">Alle aktiven</option>
          <option value="">Alle</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={filters.priority ?? ""} className="input w-auto">
          <option value="">Jede Priorität</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="assignee" defaultValue={filters.assignee ?? ""} className="input w-auto">
          <option value="">Jeder Agent</option>
          <option value="me">Mir zugewiesen</option>
          <option value="none">Nicht zugewiesen</option>
        </select>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Suche: Betreff, Kunde, #Nummer, Text …"
          className="input w-72"
        />
        <button type="submit" className="btn-secondary">
          Filtern
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Betreff</th>
              <th className="px-4 py-2.5">Kunde</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Priorität</th>
              <th className="px-4 py-2.5">Zugewiesen</th>
              <th className="px-4 py-2.5">Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  Keine Tickets gefunden.
                </td>
              </tr>
            )}
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{ticket.number}</td>
                <td className="max-w-md px-4 py-2.5">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="font-medium text-slate-900 hover:text-blue-700"
                  >
                    {ticket.subject}
                  </Link>
                  {ticket.tags.length > 0 && (
                    <span className="ml-2 space-x-1">
                      {ticket.tags.map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {ticket.contact.name ?? ticket.contact.email}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}
                  >
                    {STATUS_LABELS[ticket.status]}
                  </span>
                </td>
                <td className={`px-4 py-2.5 text-xs font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                  {PRIORITY_LABELS[ticket.priority]}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{ticket.assignee?.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{formatRelative(ticket.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          Seite {page} von {totalPages}
          {page > 1 && (
            <Link
              className="btn-secondary"
              href={{ query: { ...filters, page: page - 1 } }}
            >
              Zurück
            </Link>
          )}
          {page < totalPages && (
            <Link
              className="btn-secondary"
              href={{ query: { ...filters, page: page + 1 } }}
            >
              Weiter
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
