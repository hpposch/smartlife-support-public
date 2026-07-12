// Einbettbares Kontaktformular: schlanke Seite für <iframe> auf Produkt-
// Websites. Produkt via ?product=<kürzel> oder über die aufgerufene Domain.
// Schutz: Honeypot-Feld + IP-Rate-Limit; kein Login nötig.
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { productForHost, defaultProduct } from "@/lib/product";
import { rateLimit } from "@/lib/ratelimit";
import { textToHtml } from "@/lib/sanitize";
import { findOrCreateContact } from "@/server/contacts";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "@/server/tickets";

export const metadata = { title: "Support-Anfrage" };

async function resolveProduct(productKey?: string) {
  if (productKey) {
    const product = await db.product.findUnique({ where: { key: productKey } });
    if (product) return product;
    return defaultProduct();
  }
  return productForHost((await headers()).get("host"));
}

async function submitEmbedTicket(formData: FormData) {
  "use server";
  // Honeypot: echte Browser lassen das unsichtbare Feld leer
  if (String(formData.get("website") ?? "") !== "") return;

  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 500);
  const body = String(formData.get("body") ?? "").trim().slice(0, 100_000);
  const productKey = String(formData.get("product") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || subject.length < 3 || body.length < 5) return;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("embed-form-ip", ip, { max: 5, windowSeconds: 3600 });
  if (!allowed) return;

  const product = await resolveProduct(productKey);
  const contact = await findOrCreateContact(db, email, String(formData.get("name") ?? "") || null);
  if (contact.isBlocked || contact.anonymizedAt) return;

  const ticket = await createTicket(
    { subject, channel: "api", contactId: contact.id, productId: product.id },
    { contactId: contact.id }
  );
  await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "customer",
      contactId: contact.id,
      bodyText: body,
      bodyHtml: textToHtml(body),
    },
  });
  await finalizeNewTicket(ticket.id);
  await enqueueTicketConfirmation(ticket.id);

  const { redirect } = await import("next/navigation");
  redirect(`/embed/form?product=${encodeURIComponent(productKey)}&gesendet=${ticket.number}`);
}

export default async function EmbedFormPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; gesendet?: string }>;
}) {
  const { product: productKey, gesendet } = await searchParams;
  const product = await resolveProduct(productKey);

  if (gesendet) {
    return (
      <div className="p-4">
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Vielen Dank! Ihre Anfrage wurde unter der Nummer <strong>#{gesendet}</strong> aufgenommen.
          Sie erhalten eine Bestätigung per E-Mail.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <form action={submitEmbedTicket} className="space-y-3">
        <input type="hidden" name="product" value={productKey ?? product.key} />
        {/* Honeypot — für Menschen unsichtbar */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />
        <div className="grid grid-cols-2 gap-3">
          <input name="name" placeholder="Ihr Name" className="input" />
          <input name="email" type="email" required placeholder="ihre@email.de *" className="input" />
        </div>
        <input name="subject" required minLength={3} placeholder="Betreff *" className="input" />
        <textarea
          name="body"
          required
          minLength={5}
          rows={5}
          placeholder="Beschreiben Sie Ihr Anliegen … *"
          className="input"
        />
        <button type="submit" className="btn-primary w-full justify-center">
          Anfrage an den {product.name}-Support senden
        </button>
      </form>
    </div>
  );
}
