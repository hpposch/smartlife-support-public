// DSGVO-Werkzeuge: Kontakt-Anonymisierung, Datenexport, Aufbewahrungsfristen.
//
// Anonymisierung ersetzt personenbezogene Daten unwiderruflich; Tickets bleiben
// für Statistik/SLA-Auswertung erhalten (ohne Inhalte). Kein Löschen von
// Ticket-Zeilen — Nummernkreis und Reporting bleiben konsistent.
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const REDACTED_TEXT = "[Inhalt aus Datenschutzgründen entfernt]";

async function deleteAttachmentsOfMessages(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const attachments = await db.attachment.findMany({
    where: { messageId: { in: messageIds } },
  });
  for (const att of attachments) {
    const full = path.resolve(env.dataDir, att.storageKey);
    // resolveKey-Äquivalent: nur innerhalb des Datenverzeichnisses löschen
    if (full.startsWith(path.resolve(env.dataDir) + path.sep)) {
      await rm(full, { force: true }).catch(() => {});
    }
  }
  await db.attachment.deleteMany({ where: { messageId: { in: messageIds } } });
  return attachments.length;
}

/** Alle Inhalte der Tickets einer Menge schwärzen (Betreff, Nachrichten, Anhänge). */
async function redactTickets(ticketIds: string[]) {
  if (ticketIds.length === 0) return;
  const messages = await db.message.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { id: true },
  });
  await deleteAttachmentsOfMessages(messages.map((m) => m.id));
  await db.message.updateMany({
    where: { ticketId: { in: ticketIds } },
    data: {
      bodyText: REDACTED_TEXT,
      bodyHtml: null,
      emailFrom: null,
      emailTo: [],
      emailCc: [],
    },
  });
  await db.ticket.updateMany({
    where: { id: { in: ticketIds } },
    data: { subject: "Anonymisierte Anfrage" },
  });
}

/** Kontakt vollständig anonymisieren (DSGVO Art. 17). Unwiderruflich. */
export async function anonymizeContact(contactId: string, actorUserId: string) {
  const contact = await db.contact.findUniqueOrThrow({
    where: { id: contactId },
    include: { tickets: { select: { id: true } } },
  });
  if (contact.anonymizedAt) return;

  await redactTickets(contact.tickets.map((t) => t.id));
  await db.portalLoginToken.deleteMany({ where: { contactId } });
  await db.contact.update({
    where: { id: contactId },
    data: {
      email: `anonymisiert-${contactId.slice(0, 8)}@anonym.invalid`,
      name: "Anonymisierter Kontakt",
      phone: null,
      azureB2cId: null,
      anonymizedAt: new Date(),
    },
  });
  for (const ticket of contact.tickets) {
    await db.ticketEvent.create({
      data: { ticketId: ticket.id, eventType: "anonymized", actorUserId, payload: {} },
    });
  }
}

/** Datenauskunft (DSGVO Art. 15): alle gespeicherten Daten eines Kontakts als JSON. */
export async function exportContactData(contactId: string) {
  const contact = await db.contact.findUniqueOrThrow({
    where: { id: contactId },
    include: {
      organization: true,
      tickets: {
        include: {
          messages: {
            select: {
              type: true,
              bodyText: true,
              createdAt: true,
              emailFrom: true,
              emailTo: true,
              attachments: { select: { fileName: true, sizeBytes: true } },
            },
          },
          csatSurvey: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return {
    exportedAt: new Date().toISOString(),
    contact: {
      email: contact.email,
      name: contact.name,
      phone: contact.phone,
      organization: contact.organization?.name ?? null,
      createdAt: contact.createdAt,
    },
    tickets: contact.tickets.map((t) => ({
      number: t.number,
      subject: t.subject,
      status: t.status,
      channel: t.channel,
      createdAt: t.createdAt,
      csatRating: t.csatSurvey?.rating ?? null,
      messages: t.messages,
    })),
  };
}

/**
 * Aufbewahrungsfrist: Inhalte von Tickets schwärzen, die seit mehr als
 * `days` Tagen geschlossen sind (RETENTION_ANONYMIZE_DAYS). Kontakte bleiben.
 */
export async function enforceRetention(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const tickets = await db.ticket.findMany({
    where: {
      status: "closed",
      closedAt: { lt: cutoff },
      subject: { not: "Anonymisierte Anfrage" },
    },
    select: { id: true },
    take: 500,
  });
  await redactTickets(tickets.map((t) => t.id));
  return tickets.length;
}
