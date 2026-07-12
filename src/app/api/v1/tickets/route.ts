// Integrations-API: Tickets programmatisch erstellen (z. B. aus
// SmartLife-Produkten). Auth: Authorization: Bearer <API_KEY>.
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { defaultProduct } from "@/lib/product";
import { textToHtml } from "@/lib/sanitize";
import { findOrCreateContact } from "@/server/contacts";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "@/server/tickets";

function authorized(request: NextRequest): boolean {
  const configured = env.apiKey;
  if (!configured) return false;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

const bodySchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100_000),
  contact_email: z.string().email(),
  contact_name: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  send_confirmation: z.boolean().optional(),
  // Produkt-Zuordnung (Mehrprodukt-Betrieb); ohne Angabe: Default-Produkt
  product: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Ungültiger oder fehlender API-Key" } },
      { status: 401 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Ungültige Eingabe", details: parsed.error.flatten() } },
      { status: 422 }
    );
  }
  const input = parsed.data;

  const contact = await findOrCreateContact(db, input.contact_email, input.contact_name);
  if (contact.isBlocked) {
    return NextResponse.json(
      { error: { code: "contact_blocked", message: "Kontakt ist blockiert" } },
      { status: 403 }
    );
  }

  const product = input.product
    ? await db.product.findUnique({ where: { key: input.product } })
    : await defaultProduct();
  if (!product) {
    return NextResponse.json(
      { error: { code: "unknown_product", message: `Unbekanntes Produkt: ${input.product}` } },
      { status: 422 }
    );
  }

  const ticket = await createTicket(
    {
      subject: input.subject,
      channel: "api",
      contactId: contact.id,
      productId: product.id,
      priority: input.priority,
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
  if (input.send_confirmation) await enqueueTicketConfirmation(ticket.id);

  return NextResponse.json(
    { data: { id: ticket.id, number: ticket.number, status: ticket.status } },
    { status: 201 }
  );
}
