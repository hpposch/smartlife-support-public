import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContact } from "@/lib/portal-session";
import { currentProduct } from "@/lib/product";
import { textToHtml } from "@/lib/sanitize";
import { attachUploads } from "@/lib/uploads";
import { fieldsForProduct, validateCustomFieldValues } from "@/server/custom-fields";
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

  const product = await currentProduct();

  // Produktspezifische Felder validieren (Pflichtfelder!)
  const fields = await fieldsForProduct(product.id);
  const fieldInput: Record<string, string> = {};
  for (const field of fields) fieldInput[field.key] = String(formData.get(`cf_${field.key}`) ?? "");
  const validated = validateCustomFieldValues(fields, fieldInput);
  if (!validated.ok) {
    redirect(`/portal/new?fehler=${encodeURIComponent(validated.errors.join("; "))}`);
  }
  const ticket = await createTicket(
    {
      subject: input.subject,
      channel: "portal",
      contactId: contact.id,
      productId: product.id,
      categoryId: input.categoryId || null,
    },
    { contactId: contact.id }
  );
  if (Object.keys(validated.values).length > 0) {
    await db.ticket.update({ where: { id: ticket.id }, data: { customFields: validated.values } });
  }
  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "customer",
      contactId: contact.id,
      bodyText: input.body,
      bodyHtml: textToHtml(input.body),
    },
  });
  await attachUploads(formData.getAll("files"), message.id);
  await finalizeNewTicket(ticket.id);
  await enqueueTicketConfirmation(ticket.id);
  redirect(`/portal/tickets/${ticket.id}`);
}

export default async function PortalNewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  await requireContact();
  const { fehler } = await searchParams;
  const product = await currentProduct();
  const [categories, fields] = await Promise.all([
    db.ticketCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    fieldsForProduct(product.id),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Neue Anfrage</h1>
      {fehler && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
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
        {fields.map((field) => (
          <label key={field.id} className="block text-xs font-medium text-slate-500">
            {field.label} {field.required && "*"}
            {field.type === "select" ? (
              <select name={`cf_${field.key}`} required={field.required} defaultValue="" className="input mt-1">
                <option value="">— bitte wählen —</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={`cf_${field.key}`}
                type={field.type === "number" ? "number" : "text"}
                required={field.required}
                className="input mt-1"
              />
            )}
          </label>
        ))}
        <label className="block text-xs font-medium text-slate-500">
          Anhänge (optional, max. 5 Dateien à 10 MB)
          <input name="files" type="file" multiple className="input mt-1" />
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
