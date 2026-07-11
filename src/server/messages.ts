import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { sanitizeAgentHtml, htmlToText, textToHtml } from "@/lib/sanitize";
import { storeFile } from "@/lib/storage";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface UploadedFile {
  name: string;
  type: string;
  data: Buffer;
}

async function createAttachments(messageId: string, files: UploadedFile[]) {
  for (const file of files) {
    if (file.data.length === 0) continue;
    if (file.data.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Anhang "${file.name}" ist größer als 15 MB`);
    }
    const storageKey = await storeFile("attachments", file.data);
    await db.attachment.create({
      data: {
        messageId,
        fileName: file.name || "datei",
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.data.length,
        storageKey,
      },
    });
  }
}

/**
 * Öffentliche Agentenantwort: speichert die Nachricht, setzt den Status,
 * pflegt first_replied_at und reiht den E-Mail-Versand ein.
 */
export async function addAgentReply(params: {
  ticketId: string;
  userId: string;
  bodyText: string;
  files?: UploadedFile[];
  setStatus?: "pending_customer" | "resolved" | "open";
}) {
  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: params.ticketId },
    include: { contact: true },
  });
  if (ticket.contact.isBlocked) throw new Error("Kontakt ist blockiert");

  const bodyText = params.bodyText.trim();
  if (!bodyText) throw new Error("Antwort darf nicht leer sein");

  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      type: "agent_reply",
      userId: params.userId,
      bodyText,
      bodyHtml: textToHtml(bodyText),
      emailTo: [ticket.contact.email],
      sendStatus: "pending",
    },
  });
  await createAttachments(message.id, params.files ?? []);

  const status = params.setStatus ?? "pending_customer";
  const isFirstReply = !ticket.firstRepliedAt;
  await db.$transaction([
    db.ticket.update({
      where: { id: ticket.id },
      data: {
        status,
        firstRepliedAt: ticket.firstRepliedAt ?? new Date(),
        resolvedAt: status === "resolved" ? ticket.resolvedAt ?? new Date() : ticket.resolvedAt,
      },
    }),
    db.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: "replied",
        actorUserId: params.userId,
        payload: { messageId: message.id, status },
      },
    }),
  ]);

  // Phase 3: SLA-Ereignisse, Uhr-Pausierung, CSAT und Webhooks
  {
    const { recordFirstResponse, recordResolution, handleSlaStatusChange } = await import("./sla");
    const { emitWebhookEvent } = await import("./webhooks");
    const { enqueueCsatSurvey } = await import("./tickets");
    if (isFirstReply) await recordFirstResponse(ticket.id);
    await handleSlaStatusChange(ticket.id, ticket.status, status);
    if (status === "resolved") {
      await recordResolution(ticket.id);
      await enqueueCsatSurvey(ticket.id);
      await emitWebhookEvent("ticket.resolved", ticket.id);
    }
    await emitWebhookEvent("ticket.replied", ticket.id);
  }

  await queues().emailSend.add("send", { messageId: message.id });
  return message;
}

/** Interne Notiz — nur für Agenten sichtbar, kein Versand. */
export async function addInternalNote(params: {
  ticketId: string;
  userId: string;
  bodyText: string;
  files?: UploadedFile[];
}) {
  const bodyText = params.bodyText.trim();
  if (!bodyText) throw new Error("Notiz darf nicht leer sein");

  const message = await db.message.create({
    data: {
      ticketId: params.ticketId,
      type: "internal_note",
      userId: params.userId,
      bodyText,
      bodyHtml: textToHtml(bodyText),
    },
  });
  await createAttachments(message.id, params.files ?? []);
  await db.ticket.update({ where: { id: params.ticketId }, data: { updatedAt: new Date() } });
  return message;
}

/** Eingehende Kundennachricht (aus Ingest-Worker oder API). */
export async function addCustomerMessage(params: {
  ticketId: string;
  contactId: string;
  bodyText: string;
  bodyHtml?: string | null;
  emailMeta?: {
    messageId?: string;
    inReplyTo?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    rawEmlKey?: string;
  };
}) {
  const message = await db.message.create({
    data: {
      ticketId: params.ticketId,
      type: "customer",
      contactId: params.contactId,
      bodyText: params.bodyText,
      bodyHtml: params.bodyHtml ?? null,
      emailMessageId: params.emailMeta?.messageId,
      inReplyTo: params.emailMeta?.inReplyTo,
      emailFrom: params.emailMeta?.from,
      emailTo: params.emailMeta?.to ?? [],
      emailCc: params.emailMeta?.cc ?? [],
      rawEmlKey: params.emailMeta?.rawEmlKey,
    },
  });

  // Kundenantwort öffnet das Ticket wieder
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: params.ticketId } });
  if (ticket.status !== "new" && ticket.status !== "open") {
    await db.$transaction([
      db.ticket.update({
        where: { id: ticket.id },
        data: { status: "open", resolvedAt: null, closedAt: null },
      }),
      db.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: "status_changed",
          actorContactId: params.contactId,
          payload: { from: ticket.status, to: "open", reason: "customer_reply" },
        },
      }),
    ]);
    // SLA-Uhr läuft weiter (Fristen um die Wartezeit verschoben)
    const { handleSlaStatusChange } = await import("./sla");
    await handleSlaStatusChange(ticket.id, ticket.status, "open");
  } else {
    await db.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  }

  // Zugewiesenen Agenten informieren
  if (ticket.assigneeId) {
    await queues().notify.add("agent_new_message", {
      kind: "agent_new_message",
      ticketId: ticket.id,
      messageId: message.id,
    });
  }

  return message;
}

export { sanitizeAgentHtml, htmlToText };
