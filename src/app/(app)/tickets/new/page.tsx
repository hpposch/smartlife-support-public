import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIORITY_LABELS } from "@/lib/labels";
import { findOrCreateContact } from "@/server/contacts";
import { addInternalNote } from "@/server/messages";
import { createTicket } from "@/server/tickets";

const schema = z.object({
  email: z.string().email("Gültige Kunden-E-Mail angeben"),
  name: z.string(),
  subject: z.string().min(1),
  body: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  categoryId: z.string(),
});

async function createManualTicket(formData: FormData) {
  "use server";
  const user = await requireUser();
  const input = schema.parse({
    email: formData.get("email"),
    name: formData.get("name") ?? "",
    subject: formData.get("subject"),
    body: formData.get("body"),
    priority: formData.get("priority"),
    categoryId: formData.get("categoryId") ?? "",
  });

  const contact = await findOrCreateContact(db, input.email, input.name || null);
  const ticket = await createTicket(
    {
      subject: input.subject,
      channel: "manual",
      contactId: contact.id,
      priority: input.priority,
      categoryId: input.categoryId || null,
      assigneeId: user.id,
    },
    { userId: user.id }
  );
  // Erstinhalt (z. B. Telefonnotiz) als interne Notiz erfassen
  await addInternalNote({ ticketId: ticket.id, userId: user.id, bodyText: input.body });

  redirect(`/tickets/${ticket.id}`);
}

export default async function NewTicketPage() {
  await requireUser();
  const categories = await db.ticketCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Neues Ticket (manuell)</h1>
      <p className="mb-4 text-sm text-slate-500">
        Für Anfragen außerhalb der E-Mail — z. B. nach einem Telefonat. Der Inhalt wird als
        interne Notiz gespeichert; eine Antwort an den Kunden versenden Sie danach aus dem Ticket.
      </p>
      <form
        action={createManualTicket}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Kunden-E-Mail *
            <input name="email" type="email" required className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Kundenname
            <input name="name" className="input mt-1" />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          Betreff *
          <input name="subject" required className="input mt-1" />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Inhalt / Notiz *
          <textarea name="body" required rows={5} className="input mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Priorität
            <select name="priority" defaultValue="normal" className="input mt-1">
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Kategorie
            <select name="categoryId" defaultValue="" className="input mt-1">
              <option value="">— keine —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className="btn-primary">
          Ticket anlegen
        </button>
      </form>
    </div>
  );
}
