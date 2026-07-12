// Ticket-Erstellung aus dem Chat-Assistenten: legt ein Ticket mit dem
// kompletten Chatverlauf als erster Kundennachricht an. Eingeloggte
// Portal-Kunden werden übernommen, anonyme Besucher geben ihre E-Mail an.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentContact } from "@/lib/portal-session";
import { productForHost } from "@/lib/product";
import { rateLimit } from "@/lib/ratelimit";
import { textToHtml } from "@/lib/sanitize";
import { attachUploads } from "@/lib/uploads";
import { findOrCreateContact } from "@/server/contacts";
import { CHAT_LIMITS, clampChat, formatTranscript } from "@/server/chat-assistant";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "@/server/tickets";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().min(1).max(CHAT_LIMITS.maxChars),
      })
    )
    .min(1)
    .max(CHAT_LIMITS.maxMessages),
  subject: z.string().min(3).max(300),
  email: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("chat-ticket-ip", ip, { max: 5, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Zu viele Tickets — bitte später erneut" } },
      { status: 429 }
    );
  }

  // multipart (Widget mit optionalem Anhang) oder JSON (API-Nutzung)
  let json: unknown = null;
  let uploadFile: FormDataEntryValue | null = null;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    json = form ? JSON.parse(String(form.get("payload") ?? "null")) : null;
    uploadFile = form?.get("file") ?? null;
  } else {
    json = await request.json().catch(() => null);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Ungültige Eingabe" } },
      { status: 422 }
    );
  }
  const input = parsed.data;

  // Kontakt: eingeloggter Portal-Kunde, sonst per angegebener E-Mail
  let contact = await getCurrentContact();
  if (!contact) {
    if (!input.email) {
      return NextResponse.json(
        { error: { code: "email_required", message: "E-Mail-Adresse erforderlich" } },
        { status: 422 }
      );
    }
    contact = await db.contact.findUnique({
      where: { email: input.email.toLowerCase().trim() },
      include: { organization: true },
    });
    if (!contact) {
      const created = await findOrCreateContact(db, input.email);
      contact = await db.contact.findUniqueOrThrow({
        where: { id: created.id },
        include: { organization: true },
      });
    }
  }
  if (contact.isBlocked || contact.anonymizedAt) {
    return NextResponse.json(
      { error: { code: "contact_blocked", message: "Ticket kann nicht erstellt werden" } },
      { status: 403 }
    );
  }

  const product = await productForHost(request.headers.get("host"));
  const transcript = formatTranscript(clampChat(input.messages));
  const ticket = await createTicket(
    { subject: input.subject, channel: "chat", contactId: contact.id, productId: product.id },
    { contactId: contact.id }
  );
  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "customer",
      contactId: contact.id,
      bodyText: transcript,
      bodyHtml: textToHtml(transcript),
    },
  });
  if (uploadFile) await attachUploads([uploadFile], message.id);
  await finalizeNewTicket(ticket.id);
  await enqueueTicketConfirmation(ticket.id);

  return NextResponse.json(
    { data: { number: ticket.number, loggedIn: !!(await getCurrentContact()) } },
    { status: 201 }
  );
}
