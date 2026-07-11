import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContact } from "@/lib/portal-session";
import { textToHtml } from "@/lib/sanitize";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "@/server/tickets";

const schema = z.object({
  subject: z.string().min(3).max(500),
  body: z.string().min(5).max(100_000),
  categoryId: z.string(),
});

async function createPortalTicket(formData: FormData) {
  "use server";
  const contact = await requireContact();
  const input = schema.parse({
    subject: formData.get("subject"),
    body: formData.get("body"),
    categoryId: formData.get("categoryId") ?? "",
  });

  const ticket = await createTicket(
    {
      subject: input.subject,
      channel: "portal",
      contactId: contact.id,
      categoryId: input.categoryId || null,
    },
    { contactId: contact.id }
  );
  await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "customer",
      contactId: contact.id,
      bodyText: input.body,
      bodyHtml: textToHtml(input.body),
    },
  });
  await finalizeNewTicket(ticket.id);
  await enqueueTicketConfirmation(ticket.id);
  redirect(`/portal/tickets/${ticket.id}`);
}

export default async function PortalNewTicketPage() {
  await requireContact();
  const categories = await db.ticketCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Neue Anfrage</h1>
      <form
        action={createPortalTicket}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <label className="block text-xs font-medium text-slate-500">
          Betreff *
          <input name="subject" required minLength={3} className="input mt-1" />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Beschreibung *
          <textarea
            name="body"
            required
            minLength={5}
            rows={7}
            placeholder="Beschreiben Sie Ihr Anliegen so genau wie möglich …"
            className="input mt-1"
          />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Kategorie
          <select name="categoryId" defaultValue="" className="input mt-1">
            <option value="">— bitte wählen —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">
          Anfrage absenden
        </button>
      </form>
    </div>
  );
}
