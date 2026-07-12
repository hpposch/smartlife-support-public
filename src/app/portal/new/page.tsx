// „Neue Anfrage“ im Kundenportal — angelehnt an BoldDesk: Rich-Text-Editor,
// Drag-&-Drop-Anhänge, CC-Empfänger, Typ (Pflicht), produktspezifische Felder,
// Dringlichkeit und „Auf der Seite bleiben“.
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContact } from "@/lib/portal-session";
import { currentProduct, productAccent } from "@/lib/product";
import { htmlToText, sanitizeEmailHtml } from "@/lib/sanitize";
import { attachUploads } from "@/lib/uploads";
import { FileDrop } from "@/components/file-drop";
import { RichTextEditor } from "@/components/rich-text-editor";
import { fieldsForProduct, validateCustomFieldValues } from "@/server/custom-fields";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "@/server/tickets";

const schema = z.object({
  subject: z.string().min(3).max(500),
  categoryId: z.string(),
  priority: z.enum(["low", "normal", "high"]).catch("normal"),
});

function parseCcEmails(raw: string, ownEmail: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e !== ownEmail)
    ),
  ].slice(0, 5);
}

async function createPortalTicket(formData: FormData) {
  "use server";
  const contact = await requireContact();
  const input = schema.parse({
    subject: formData.get("subject"),
    categoryId: formData.get("categoryId") ?? "",
    priority: formData.get("priority") ?? "normal",
  });

  // Rich-Text-Inhalt: serverseitig sanitisieren, Textfassung ableiten
  const bodyHtml = sanitizeEmailHtml(String(formData.get("bodyHtml") ?? ""));
  const bodyText = htmlToText(bodyHtml).trim();
  if (bodyText.length < 5) {
    redirect(`/portal/new?fehler=${encodeURIComponent("Bitte beschreiben Sie Ihr Anliegen (mind. 5 Zeichen).")}`);
  }

  const product = await currentProduct();

  // Produktspezifische Felder validieren (Pflichtfelder!)
  const fields = await fieldsForProduct(product.id);
  const fieldInput: Record<string, string> = {};
  for (const field of fields) fieldInput[field.key] = String(formData.get(`cf_${field.key}`) ?? "");
  const validated = validateCustomFieldValues(fields, fieldInput);
  if (!validated.ok) {
    redirect(`/portal/new?fehler=${encodeURIComponent(validated.errors.join("; "))}`);
  }

  const ccEmails = parseCcEmails(String(formData.get("cc") ?? ""), contact.email);

  const ticket = await createTicket(
    {
      subject: input.subject,
      channel: "portal",
      contactId: contact.id,
      productId: product.id,
      priority: input.priority,
      categoryId: input.categoryId || null,
    },
    { contactId: contact.id }
  );
  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      ...(Object.keys(validated.values).length > 0 ? { customFields: validated.values } : {}),
      ...(ccEmails.length > 0 ? { ccEmails } : {}),
    },
  });
  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "customer",
      contactId: contact.id,
      bodyText,
      bodyHtml,
    },
  });
  await attachUploads(formData.getAll("files"), message.id);
  await finalizeNewTicket(ticket.id);
  await enqueueTicketConfirmation(ticket.id);

  if (formData.get("stay") === "1") {
    redirect(`/portal/new?erstellt=${ticket.number}`);
  }
  redirect(`/portal/tickets/${ticket.id}`);
}

export default async function PortalNewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; erstellt?: string }>;
}) {
  await requireContact();
  const { fehler, erstellt } = await searchParams;
  const product = await currentProduct();
  const accent = productAccent(product);
  const [categories, fields] = await Promise.all([
    db.ticketCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    fieldsForProduct(product.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-2 text-xs text-slate-400">
        <Link href="/portal" className="hover:underline">
          ‹ Meine Anfragen
        </Link>
      </p>
      <h1 className="mb-4 text-lg font-semibold">Neue Anfrage</h1>
      {fehler && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
      {erstellt && (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Ihre Anfrage <strong>#{erstellt}</strong> wurde erstellt — Sie erhalten eine Bestätigung
          per E-Mail.
        </p>
      )}
      <form
        action={createPortalTicket}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <label className="block text-xs font-medium text-slate-500">
          Betreff *
          <input name="subject" required minLength={3} placeholder="Betreff eingeben" className="input mt-1" />
        </label>

        <div className="block text-xs font-medium text-slate-500">
          Beschreibung *
          <div className="mt-1">
            <RichTextEditor name="bodyHtml" placeholder="Beschreiben Sie Ihr Anliegen so genau wie möglich …" />
          </div>
        </div>

        <FileDrop name="files" maxFiles={5} maxMb={20} />

        <label className="block text-xs font-medium text-slate-500">
          CC (weitere Empfänger, durch Komma getrennt)
          <input name="cc" placeholder="kollege@firma.de, chef@firma.de" className="input mt-1" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-500">
            Typ {categories.length > 0 && "*"}
            <select
              name="categoryId"
              required={categories.length > 0}
              defaultValue=""
              className="input mt-1"
            >
              <option value="">— bitte wählen —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dringlichkeit
            <select name="priority" defaultValue="normal" className="input mt-1">
              <option value="low">Niedrig</option>
              <option value="normal">Normal</option>
              <option value="high">Hoch</option>
            </select>
          </label>
        </div>

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

        <div className="flex items-center gap-4 border-t border-slate-100 pt-4">
          <button type="submit" className="btn-primary" style={{ backgroundColor: accent }}>
            Anfrage absenden
          </button>
          <Link href="/portal" className="btn-secondary">
            Abbrechen
          </Link>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" name="stay" value="1" /> Auf der Seite bleiben
          </label>
        </div>
      </form>
    </div>
  );
}
