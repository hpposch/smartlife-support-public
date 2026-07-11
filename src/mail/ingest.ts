// Verarbeitung einer abgerufenen Roh-E-Mail zu Ticket + Nachricht.
// Threading in drei Stufen (s. docs/02-architektur.md):
//   1. In-Reply-To/References ↔ gespeicherte email_message_id
//   2. Ticket-Token im Betreff [#1000-a3f9c2d1]
//   3. sonst: neues Ticket
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import type { Mailbox, Ticket } from "@prisma/client";
import { db } from "@/lib/db";
import { headersFromMap, isAutoSubmitted, isBounce } from "@/lib/autoreply";
import { sanitizeEmailHtml, htmlToText, textToHtml } from "@/lib/sanitize";
import { readStoredFile, storeFile } from "@/lib/storage";
import { cleanSubject, parseSubjectTag } from "@/lib/ticket-token";
import { findOrCreateContact } from "@/server/contacts";
import { addCustomerMessage } from "@/server/messages";
import { createTicket, enqueueTicketConfirmation } from "@/server/tickets";

function firstAddress(addr: AddressObject | AddressObject[] | undefined) {
  const obj = Array.isArray(addr) ? addr[0] : addr;
  return obj?.value?.[0];
}

function allAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  const objs = Array.isArray(addr) ? addr : addr ? [addr] : [];
  return objs.flatMap((o) => o.value.map((v) => v.address ?? "").filter(Boolean));
}

/** Threading-Auflösung: findet das Zielticket für eine eingehende Mail. */
export async function resolveTicketForEmail(parsed: {
  inReplyTo?: string;
  references: string[];
  subject: string;
}): Promise<Ticket | null> {
  // Stufe 1: Referenzierte Message-IDs (ein- und ausgehende sind gespeichert)
  const refs = [parsed.inReplyTo, ...parsed.references].filter((r): r is string => !!r);
  if (refs.length > 0) {
    const match = await db.message.findFirst({
      where: { emailMessageId: { in: refs } },
      include: { ticket: true },
      orderBy: { createdAt: "desc" },
    });
    if (match) return match.ticket;
  }

  // Stufe 2: Token im Betreff
  const tag = parseSubjectTag(parsed.subject);
  if (tag) {
    const ticket = await db.ticket.findUnique({ where: { number: tag.number } });
    if (ticket && ticket.token === tag.token) return ticket;
  }

  return null;
}

export async function ingestEmail(mailbox: Mailbox, rawEmlKey: string): Promise<void> {
  const raw = await readStoredFile(rawEmlKey);
  const parsed: ParsedMail = await simpleParser(raw);

  const messageId = parsed.messageId ?? null;

  // Idempotenz: bereits verarbeitete Mail überspringen
  if (messageId) {
    const existing = await db.message.findUnique({ where: { emailMessageId: messageId } });
    if (existing) return;
  }

  const from = firstAddress(parsed.from);
  const fromAddress = from?.address?.toLowerCase();
  const headers = headersFromMap(parsed.headers as Map<string, unknown>);

  // Eigene Postfachadresse als Absender → verwerfen (Schleifen-Schutz)
  if (!fromAddress || fromAddress === mailbox.address.toLowerCase()) return;

  const subjectRaw = parsed.subject ?? "(kein Betreff)";
  const bodyHtml = parsed.html ? sanitizeEmailHtml(parsed.html) : null;
  const bodyText =
    (parsed.text?.trim() || (bodyHtml ? htmlToText(bodyHtml) : "")) || "(leere Nachricht)";
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];

  const bounce = isBounce(headers, fromAddress);
  const autoReply = !bounce && isAutoSubmitted(headers);

  // Bounce: als System-Notiz am referenzierten Ticket vermerken, sonst verwerfen
  if (bounce) {
    const ticket = await resolveTicketForEmail({
      inReplyTo: parsed.inReplyTo ?? undefined,
      references,
      subject: subjectRaw,
    });
    if (ticket) {
      await db.message.create({
        data: {
          ticketId: ticket.id,
          type: "system",
          bodyText: `Unzustellbarkeits-Benachrichtigung empfangen:\n\n${bodyText.slice(0, 2000)}`,
          emailMessageId: messageId,
          rawEmlKey,
        },
      });
    }
    return;
  }

  const contact = await findOrCreateContact(db, fromAddress, from?.name);
  if (contact.isBlocked) return;

  let ticket = await resolveTicketForEmail({
    inReplyTo: parsed.inReplyTo ?? undefined,
    references,
    subject: subjectRaw,
  });

  const isNewTicket = !ticket;
  if (!ticket) {
    // Auto-generierte Mail ohne Ticketbezug: kein neues Ticket eröffnen
    if (autoReply) return;
    ticket = await createTicket(
      {
        subject: cleanSubject(subjectRaw) || "(kein Betreff)",
        channel: "email",
        contactId: contact.id,
        teamId: mailbox.defaultTeamId,
        mailboxId: mailbox.id,
      },
      { contactId: contact.id }
    );
  }

  const message = await addCustomerMessage({
    ticketId: ticket.id,
    contactId: contact.id,
    bodyText,
    bodyHtml,
    emailMeta: {
      messageId: messageId ?? undefined,
      inReplyTo: parsed.inReplyTo ?? undefined,
      from: fromAddress,
      to: allAddresses(parsed.to),
      cc: allAddresses(parsed.cc),
      rawEmlKey,
    },
  });

  // Anhänge übernehmen (inkl. Inline-Bilder)
  for (const att of parsed.attachments ?? []) {
    if (!att.content || att.content.length === 0) continue;
    const storageKey = await storeFile("attachments", att.content as Buffer);
    await db.attachment.create({
      data: {
        messageId: message.id,
        fileName: att.filename ?? "anhang",
        contentType: att.contentType ?? "application/octet-stream",
        sizeBytes: att.size ?? (att.content as Buffer).length,
        storageKey,
        isInline: att.contentDisposition === "inline",
        contentId: att.cid ?? null,
      },
    });
  }

  // Bestätigung nur bei neuem Ticket und nicht auf Auto-Mails (Loop-Schutz)
  if (isNewTicket && !autoReply) {
    await enqueueTicketConfirmation(ticket.id);
  }
}

export { textToHtml };
