import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContact } from "@/lib/portal-session";
import { currentProduct } from "@/lib/product";
import { STATUS_COLORS, STATUS_LABELS, formatDateTime } from "@/lib/labels";
import { addCustomerMessage } from "@/server/messages";
import { updateTicket } from "@/server/tickets";

async function loadOwnTicket(ticketId: string) {
  const contact = await requireContact();
  const product = await currentProduct();
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      messages: {
        // Portal sieht nur Kundennachrichten und Agentenantworten
        where: { type: { in: ["customer", "agent_reply"] } },
        orderBy: { createdAt: "asc" },
        include: { user: true, attachments: true },
      },
    },
  });
  // Nur eigene Tickets des Produkts der aufgerufenen Domain
  if (!ticket || ticket.contactId !== contact.id || ticket.productId !== product.id) notFound();
  return { contact, ticket };
}

const replySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().min(1).max(100_000),
});

async function portalReply(formData: FormData) {
  "use server";
  const input = replySchema.parse({
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });
  const { contact, ticket } = await loadOwnTicket(input.ticketId);
  await addCustomerMessage({
    ticketId: ticket.id,
    contactId: contact.id,
    bodyText: input.body.trim(),
  });
  revalidatePath(`/portal/tickets/${ticket.id}`);
}

async function portalClose(formData: FormData) {
  "use server";
  const ticketId = String(formData.get("ticketId"));
  const { contact, ticket } = await loadOwnTicket(ticketId);
  await updateTicket(ticket.id, { status: "closed" }, { contactId: contact.id });
  redirect("/portal");
}

export default async function PortalTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ticket } = await loadOwnTicket(id);
  const isClosed = ticket.status === "closed";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            <span className="text-slate-400">#{ticket.number}</span> {ticket.subject}
          </h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>
            {STATUS_LABELS[ticket.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          erstellt am {formatDateTime(ticket.createdAt)}
        </p>
      </div>

      <div className="space-y-3">
        {ticket.messages.map((message) => {
          const isAgent = message.type === "agent_reply";
          return (
            <div
              key={message.id}
              className={`rounded-lg border p-4 shadow-sm ${
                isAgent ? "border-blue-200 bg-blue-50/40" : "border-slate-200 bg-white"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {isAgent ? `SmartLife Support${message.user ? ` (${message.user.name})` : ""}` : "Sie"}
                </span>
                <span>{formatDateTime(message.createdAt)}</span>
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
                        📎 {att.fileName}
                      </a>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isClosed ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
          Diese Anfrage ist geschlossen. Bei weiteren Fragen erstellen Sie bitte eine neue Anfrage.
        </p>
      ) : (
        <form
          action={portalReply}
          className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="ticketId" value={ticket.id} />
          <textarea
            name="body"
            required
            rows={5}
            placeholder="Ihre Antwort …"
            className="input"
          />
          <div className="mt-3 flex items-center justify-between">
            <button type="submit" className="btn-primary">
              Antwort senden
            </button>
          </div>
        </form>
      )}

      {!isClosed && (
        <form action={portalClose} className="mt-3 text-right">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <button type="submit" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
            Anfrage schließen (Problem gelöst)
          </button>
        </form>
      )}
    </div>
  );
}
