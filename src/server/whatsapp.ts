// WhatsApp Business (Cloud API): eingehende Nachrichten werden zu Tickets
// (Kanal "whatsapp"), Agentenantworten gehen als WhatsApp-Nachricht zurück.
//
// Konfiguration (.env):
//   WHATSAPP_TOKEN            Permanent-Token der Meta-App
//   WHATSAPP_PHONE_NUMBER_ID  Phone Number ID der Business-Nummer
//   WHATSAPP_VERIFY_TOKEN     frei gewähltes Token für die Webhook-Verifizierung
//   WHATSAPP_PRODUCT          optional: Produkt-Kürzel (Standard: Default-Produkt)
//   WHATSAPP_API_URL          optional: Basis-URL überschreiben (Test-Stub)
//
// Hinweis Cloud-API-Regel: freie Antworten sind nur innerhalb von 24 h nach
// der letzten Kundennachricht zustellbar; danach braucht es Template-Nachrichten.
import { db } from "@/lib/db";
import { textToHtml } from "@/lib/sanitize";
import { findOrCreateContact } from "./contacts";
import { createTicket, enqueueTicketConfirmation, finalizeNewTicket } from "./tickets";
import { addCustomerMessage } from "./messages";

export const isWhatsappEnabled = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const apiBase = () =>
  (process.env.WHATSAPP_API_URL ?? "https://graph.facebook.com/v20.0").replace(/\/$/, "");

export interface IncomingWhatsapp {
  waMessageId: string;
  fromPhone: string; // internationale Nummer ohne "+"
  senderName: string | null;
  text: string;
}

/** Text-Nachrichten aus einem Webhook-Payload ziehen (pur, testbar). */
export function extractIncomingMessages(payload: unknown): IncomingWhatsapp[] {
  const out: IncomingWhatsapp[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: unknown[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = (change as { value?: Record<string, unknown> }).value ?? {};
      const contacts = (value.contacts ?? []) as { wa_id?: string; profile?: { name?: string } }[];
      const messages = (value.messages ?? []) as {
        id?: string;
        from?: string;
        type?: string;
        text?: { body?: string };
      }[];
      for (const message of messages) {
        if (message.type !== "text" || !message.id || !message.from || !message.text?.body) continue;
        const profile = contacts.find((c) => c.wa_id === message.from);
        out.push({
          waMessageId: message.id,
          fromPhone: message.from,
          senderName: profile?.profile?.name ?? null,
          text: message.text.body,
        });
      }
    }
  }
  return out;
}

/** Eingehende WhatsApp-Nachricht → Kontakt + Ticket (oder Folgennachricht). */
export async function ingestWhatsappMessage(incoming: IncomingWhatsapp): Promise<void> {
  // Idempotenz: WhatsApp-Message-ID wie eine E-Mail-Message-ID behandeln
  const duplicate = await db.message.findUnique({
    where: { emailMessageId: incoming.waMessageId },
  });
  if (duplicate) return;

  // Kontakt über Telefonnummer; ohne Treffer synthetische Adresse anlegen
  let contact = await db.contact.findFirst({ where: { phone: incoming.fromPhone } });
  if (!contact) {
    contact = await findOrCreateContact(
      db,
      `wa-${incoming.fromPhone}@whatsapp.invalid`,
      incoming.senderName
    );
    await db.contact.update({ where: { id: contact.id }, data: { phone: incoming.fromPhone } });
  }
  if (contact.isBlocked || contact.anonymizedAt) return;

  // Offenes WhatsApp-Ticket des Kontakts weiterführen, sonst neues eröffnen
  let ticket = await db.ticket.findFirst({
    where: {
      contactId: contact.id,
      channel: "whatsapp",
      status: { notIn: ["closed", "resolved"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const isNew = !ticket;
  if (!ticket) {
    const productKey = process.env.WHATSAPP_PRODUCT;
    const product = productKey
      ? await db.product.findUnique({ where: { key: productKey } })
      : null;
    const { defaultProduct } = await import("@/lib/product");
    ticket = await createTicket(
      {
        subject: `WhatsApp: ${incoming.text.slice(0, 80)}`,
        channel: "whatsapp",
        contactId: contact.id,
        productId: (product ?? (await defaultProduct())).id,
      },
      { contactId: contact.id }
    );
    await db.message.create({
      data: {
        ticketId: ticket.id,
        type: "customer",
        contactId: contact.id,
        bodyText: incoming.text,
        bodyHtml: textToHtml(incoming.text),
        emailMessageId: incoming.waMessageId,
      },
    });
    await finalizeNewTicket(ticket.id);
    // Bestätigung nur bei echter E-Mail-Adresse sinnvoll
    if (!contact.email.endsWith("@whatsapp.invalid")) await enqueueTicketConfirmation(ticket.id);
  } else {
    const message = await addCustomerMessage({
      ticketId: ticket.id,
      contactId: contact.id,
      bodyText: incoming.text,
    });
    await db.message.update({
      where: { id: message.id },
      data: { emailMessageId: incoming.waMessageId },
    });
  }
  if (isNew) console.log(`[whatsapp] Neues Ticket aus Nachricht von ${incoming.fromPhone}`);
}

/** Freitext-Antwort an eine WhatsApp-Nummer senden (24-h-Fenster beachten). */
export async function sendWhatsappMessage(toPhone: string, text: string): Promise<string> {
  const response = await fetch(
    `${apiBase()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: text.slice(0, 4000) },
      }),
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp-Versand fehlgeschlagen: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as { messages?: { id?: string }[] };
  return json.messages?.[0]?.id ?? "wa-unbekannt";
}
