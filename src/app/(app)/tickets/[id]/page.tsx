import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatDateTime,
} from "@/lib/labels";
import { isAiEnabled } from "@/server/ai";
import { ReplyBox } from "./reply-box";
import { generateAiSummary, updateTicketProperties } from "./actions";

function SlaDue({ dueAt, done, paused }: { dueAt: Date; done: boolean; paused: boolean }) {
  if (done) return <span className="text-emerald-600">erfüllt</span>;
  const overdue = !paused && dueAt < new Date();
  return (
    <span className={overdue ? "font-medium text-red-600" : "text-slate-700"}>
      {overdue ? "überfällig seit " : "fällig "}
      {formatDateTime(dueAt)}
    </span>
  );
}

const MESSAGE_STYLES: Record<string, { label: string; frame: string; badge: string }> = {
  customer: { label: "Kunde", frame: "border-slate-200 bg-white", badge: "bg-slate-100 text-slate-700" },
  agent_reply: { label: "Antwort", frame: "border-blue-200 bg-blue-50/40", badge: "bg-blue-100 text-blue-700" },
  internal_note: { label: "Interne Notiz", frame: "border-amber-200 bg-amber-50/60", badge: "bg-amber-100 text-amber-800" },
  system: { label: "System", frame: "border-slate-200 bg-slate-50", badge: "bg-slate-100 text-slate-500" },
};

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      contact: { include: { organization: true } },
      assignee: true,
      team: true,
      category: true,
      product: true,
      tags: { include: { tag: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { user: true, contact: true, attachments: true },
      },
      events: { orderBy: { createdAt: "desc" }, take: 15, include: { actorUser: true } },
    },
  });
  if (!ticket) notFound();

  const [users, teams, categories, canned] = await Promise.all([
    db.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ orderBy: { name: "asc" } }),
    db.ticketCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.cannedResponse.findMany({ orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
              <span className="text-slate-400">#{ticket.number}</span> {ticket.subject}
            </h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}
            >
              {STATUS_LABELS[ticket.status]}
            </span>
            {isAiEnabled() && (
              <form action={generateAiSummary} className="ml-auto">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <button
                  type="submit"
                  className="rounded-md bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700 hover:bg-violet-100"
                  title="Zusammenfassung des Verlaufs als interne Notiz anhängen"
                >
                  ✨ Zusammenfassen
                </button>
              </form>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {ticket.contact.name ?? ticket.contact.email}
            {ticket.contact.organization && ` · ${ticket.contact.organization.name}`}
            {" · "}
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
              {ticket.product.name}
            </span>
            {" · "}erstellt am {formatDateTime(ticket.createdAt)}
          </p>
        </div>

        <div className="space-y-3">
          {ticket.messages
            .filter((m) => m.type !== "system" || m.sendStatus !== "sent")
            .map((message) => {
              const style = MESSAGE_STYLES[message.type];
              const author =
                message.user?.name ??
                message.contact?.name ??
                message.contact?.email ??
                "System";
              return (
                <div
                  key={message.id}
                  className={`rounded-lg border p-4 shadow-sm ${style.frame}`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${style.badge}`}>
                      {style.label}
                    </span>
                    <span className="font-medium text-slate-700">{author}</span>
                    <span>{formatDateTime(message.createdAt)}</span>
                    {message.sendStatus === "pending" && (
                      <span className="text-amber-600">Versand ausstehend …</span>
                    )}
                    {message.sendStatus === "failed" && (
                      <span className="font-medium text-red-600">
                        Versand fehlgeschlagen{message.sendError ? `: ${message.sendError}` : ""}
                      </span>
                    )}
                  </div>
                  {message.bodyHtml ? (
                    <div
                      className="email-body max-w-none overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                    />
                  ) : (
                    <p className="email-body whitespace-pre-wrap">{message.bodyText}</p>
                  )}
                  {message.attachments.filter((a) => !a.isInline).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.attachments
                        .filter((a) => !a.isInline)
                        .map((att) => (
                          <a
                            key={att.id}
                            href={`/attachments/${att.id}`}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-slate-50"
                          >
                            📎 {att.fileName} ({Math.ceil(att.sizeBytes / 1024)} KB)
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        <div className="mt-4">
          <ReplyBox
            ticketId={ticket.id}
            aiEnabled={isAiEnabled()}
            canned={canned.map((c) => ({ id: c.id, title: c.title, body: c.body }))}
            placeholders={{
              "ticket.number": String(ticket.number),
              "contact.name": ticket.contact.name ?? "",
              "agent.name": user.name,
            }}
          />
        </div>
      </div>

      <aside className="space-y-4">
        <form
          action={updateTicketProperties}
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="ticketId" value={ticket.id} />
          <h2 className="text-sm font-semibold">Eigenschaften</h2>

          <label className="block text-xs font-medium text-slate-500">
            Status
            <select name="status" defaultValue={ticket.status} className="input mt-1">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-500">
            Priorität
            <select name="priority" defaultValue={ticket.priority} className="input mt-1">
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-500">
            Zugewiesen an
            <select name="assigneeId" defaultValue={ticket.assigneeId ?? ""} className="input mt-1">
              <option value="">— niemand —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-500">
            Team
            <select name="teamId" defaultValue={ticket.teamId ?? ""} className="input mt-1">
              <option value="">— kein Team —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-500">
            Kategorie
            <select name="categoryId" defaultValue={ticket.categoryId ?? ""} className="input mt-1">
              <option value="">— keine —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-500">
            Tags (Komma-getrennt)
            <input
              name="tags"
              defaultValue={ticket.tags.map(({ tag }) => tag.name).join(", ")}
              className="input mt-1"
            />
          </label>

          <button type="submit" className="btn-primary w-full justify-center">
            Speichern
          </button>
        </form>

        {(ticket.firstResponseDueAt || ticket.resolutionDueAt) && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">SLA</h2>
            <ul className="space-y-1.5 text-sm">
              {ticket.firstResponseDueAt && (
                <li className="flex justify-between">
                  <span className="text-slate-500">Erstreaktion</span>
                  <SlaDue
                    dueAt={ticket.firstResponseDueAt}
                    done={!!ticket.firstRepliedAt}
                    paused={!!ticket.slaPausedAt}
                  />
                </li>
              )}
              {ticket.resolutionDueAt && (
                <li className="flex justify-between">
                  <span className="text-slate-500">Lösung</span>
                  <SlaDue
                    dueAt={ticket.resolutionDueAt}
                    done={!!ticket.resolvedAt}
                    paused={!!ticket.slaPausedAt}
                  />
                </li>
              )}
              {ticket.slaPausedAt && (
                <li className="text-xs text-slate-400">Uhr pausiert (wartet auf Kunde/gelöst)</li>
              )}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Kunde</h2>
          <p className="text-sm">{ticket.contact.name ?? "—"}</p>
          <p className="text-sm text-slate-500">{ticket.contact.email}</p>
          {ticket.contact.organization && (
            <p className="mt-1 text-sm text-slate-500">{ticket.contact.organization.name}</p>
          )}
          <Link
            href={`/tickets?q=${encodeURIComponent(ticket.contact.email)}&status=`}
            className="mt-2 inline-block text-xs text-blue-700 hover:underline"
          >
            Alle Tickets dieses Kunden →
          </Link>
          <Link
            href={`/contacts/${ticket.contact.id}/privacy`}
            className="mt-1 block text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Datenschutz (Auskunft/Anonymisierung)
          </Link>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Verlauf</h2>
          <ul className="space-y-1.5 text-xs text-slate-500">
            {ticket.events.map((event) => (
              <li key={event.id}>
                <span className="text-slate-400">{formatDateTime(event.createdAt)}</span>{" "}
                {event.actorUser?.name ?? "Kunde/System"} · {event.eventType}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
