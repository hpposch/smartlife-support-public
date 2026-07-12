import Link from "next/link";
import { revalidatePath } from "next/cache";
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

function isSlaOverdue(ticket: {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstRepliedAt: Date | null;
  resolvedAt: Date | null;
  slaPausedAt: Date | null;
  status: string;
}): boolean {
  if (ticket.slaPausedAt || ticket.status === "resolved" || ticket.status === "closed") return false;
  const now = new Date();
  if (ticket.firstResponseDueAt && !ticket.firstRepliedAt && ticket.firstResponseDueAt < now) return true;
  if (ticket.resolutionDueAt && !ticket.resolvedAt && ticket.resolutionDueAt < now) return true;
  return false;
}

async function saveView(formData: FormData) {
  "use server";
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return;
  const filters: Record<string, string> = {};
  for (const key of ["status", "priority", "assignee", "produkt", "q"]) {
    const value = String(formData.get(`f_${key}`) ?? "");
    if (value) filters[key] = value;
  }
  await db.savedView.upsert({
    where: { userId_name: { userId: user.id, name } },
    update: { filters },
    create: { userId: user.id, name, filters },
  });
  revalidatePath("/tickets");
}

async function deleteView(formData: FormData) {
  "use server";
  const user = await requireUser();
  await db.savedView.deleteMany({
    where: { id: String(formData.get("id")), userId: user.id },
  });
  revalidatePath("/tickets");
}

interface Filters {
  status?: string;
  priority?: string;
  assignee?: string;
  produkt?: string;
  sla?: string;
  q?: string;
  page?: string;
}

// Eingebaute Standard-Ansichten (wie BoldDesk-Views), ergänzt um eigene
const BUILTIN_VIEWS: { name: string; query: string }[] = [
  { name: "Meine offenen", query: "assignee=me&status=active" },
  { name: "Nicht zugewiesen", query: "assignee=none&status=active" },
  { name: "Wartet auf Kunde", query: "status=pending_customer" },
  { name: "Erstreaktion überfällig", query: "sla=response&status=active" },
  { name: "Lösung überfällig", query: "sla=resolution&status=active" },
  { name: "Alle ungelösten", query: "status=active" },
];

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
  if (filters.produkt) where.productId = filters.produkt;
  const now = new Date();
  if (filters.sla === "response") {
    where.slaPausedAt = null;
    where.firstRepliedAt = null;
    where.firstResponseDueAt = { lt: now };
  } else if (filters.sla === "resolution") {
    where.slaPausedAt = null;
    where.resolvedAt = null;
    where.resolutionDueAt = { lt: now };
  }
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

  const [tickets, total, products, views] = await Promise.all([
    db.ticket.findMany({
      where,
      include: { contact: true, assignee: true, product: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.ticket.count({ where }),
    db.product.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.savedView.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
  ]);
  const multiProduct = products.length > 1;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Tickets <span className="text-sm font-normal text-slate-500">({total})</span>
        </h1>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-slate-400">Ansichten:</span>
        {BUILTIN_VIEWS.map((view) => (
          <Link
            key={view.name}
            href={`/tickets?${view.query}`}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm hover:text-blue-700"
          >
            {view.name}
          </Link>
        ))}
      </div>

      {views.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-400">Eigene:</span>
          {views.map((view) => {
            const params = new URLSearchParams(view.filters as Record<string, string>);
            return (
              <span key={view.id} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm">
                <Link href={`/tickets?${params.toString()}`} className="hover:text-blue-700">
                  {view.name}
                </Link>
                <form action={deleteView}>
                  <input type="hidden" name="id" value={view.id} />
                  <button type="submit" className="text-slate-300 hover:text-red-600" title="Ansicht löschen">
                    ×
                  </button>
                </form>
              </span>
            );
          })}
        </div>
      )}

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
        {multiProduct && (
          <select name="produkt" defaultValue={filters.produkt ?? ""} className="input w-auto">
            <option value="">Alle Produkte</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
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

      <form action={saveView} className="mb-4 flex items-center gap-2">
        <input type="hidden" name="f_status" value={filters.status ?? ""} />
        <input type="hidden" name="f_priority" value={filters.priority ?? ""} />
        <input type="hidden" name="f_assignee" value={filters.assignee ?? ""} />
        <input type="hidden" name="f_produkt" value={filters.produkt ?? ""} />
        <input type="hidden" name="f_q" value={filters.q ?? ""} />
        <input name="name" required placeholder="Aktuelle Filter als Ansicht speichern …" className="input w-72 text-sm" />
        <button type="submit" className="btn-secondary text-sm">
          Ansicht speichern
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
                  {multiProduct && (
                    <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                      {ticket.product.name}
                    </span>
                  )}
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
                  {isSlaOverdue(ticket) && (
                    <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      SLA überfällig
                    </span>
                  )}
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
