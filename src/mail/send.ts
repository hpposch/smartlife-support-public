// Versand von Agentenantworten und Benachrichtigungen per SMTP,
// mit korrekten Threading-Headern (In-Reply-To/References) und
// Speicherung der versendeten Message-ID für eingehendes Threading.
import type Mail from "nodemailer/lib/mailer";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";
import { replySubject } from "@/lib/ticket-token";
import { smtpTransport } from "./mailer";
import * as templates from "./templates";

/** Threading-Header: referenziert die letzte E-Mail-Nachricht des Tickets. */
async function threadingHeaders(ticketId: string) {
  const lastEmail = await db.message.findFirst({
    where: { ticketId, emailMessageId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!lastEmail?.emailMessageId) return {};
  const prior = await db.message.findMany({
    where: { ticketId, emailMessageId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { emailMessageId: true },
    take: 20,
  });
  return {
    inReplyTo: lastEmail.emailMessageId,
    references: prior.map((m) => m.emailMessageId!).join(" "),
  };
}

async function loadMailboxForTicket(ticketId: string) {
  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { mailbox: true, contact: true, team: true },
  });
  const mailbox =
    ticket.mailbox ?? (await db.mailbox.findFirst({ where: { isActive: true } }));
  if (!mailbox) throw new Error("Kein aktives Postfach für den Versand konfiguriert");
  return { ticket, mailbox };
}

/** Agentenantwort (messages.send_status = pending) versenden. */
export async function sendAgentReply(messageId: string): Promise<void> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { attachments: true, user: true },
  });
  if (message.type !== "agent_reply" || message.sendStatus === "sent") return;

  const { ticket, mailbox } = await loadMailboxForTicket(message.ticketId);
  const headers = await threadingHeaders(ticket.id);

  const attachments: Mail.Attachment[] = await Promise.all(
    message.attachments.map(async (att) => ({
      filename: att.fileName,
      contentType: att.contentType,
      content: await readStoredFile(att.storageKey),
    }))
  );

  const signature = ticket.team?.emailSignature;
  const html = message.bodyHtml! + (signature ? `<br/><br/>-- <br/>${signature}` : "");
  const text = message.bodyText + (signature ? `\n\n-- \n${signature}` : "");

  try {
    const info = await smtpTransport(mailbox).sendMail({
      from: { name: `SmartLife Support`, address: mailbox.address },
      to: message.emailTo,
      subject: replySubject(ticket.subject, ticket.number, ticket.token),
      html,
      text,
      attachments,
      ...headers,
    });
    await db.message.update({
      where: { id: message.id },
      data: {
        sendStatus: "sent",
        sendError: null,
        emailMessageId: info.messageId,
        emailFrom: mailbox.address,
        inReplyTo: headers.inReplyTo ?? null,
      },
    });
  } catch (error) {
    await db.message.update({
      where: { id: message.id },
      data: { sendStatus: "failed", sendError: String(error).slice(0, 1000) },
    });
    throw error; // BullMQ-Retry greift; nach 3 Versuchen bleibt "failed" sichtbar
  }
}

/** Benachrichtigungs-Mails (Bestätigung, Agenten-Hinweis). */
export async function sendNotification(job: {
  kind: "ticket_confirmation" | "agent_new_message";
  ticketId: string;
  messageId?: string;
}): Promise<void> {
  const { ticket, mailbox } = await loadMailboxForTicket(job.ticketId);

  if (job.kind === "ticket_confirmation") {
    if (ticket.contact.isBlocked) return;
    const tpl = templates.ticketConfirmation({
      number: ticket.number,
      token: ticket.token,
      subject: ticket.subject,
      contactName: ticket.contact.name,
    });
    const headers = await threadingHeaders(ticket.id);
    const info = await smtpTransport(mailbox).sendMail({
      from: { name: "SmartLife Support", address: mailbox.address },
      to: ticket.contact.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      ...headers,
    });
    // Message-ID der Bestätigung speichern — Kunden antworten oft genau darauf
    await db.message.create({
      data: {
        ticketId: ticket.id,
        type: "system",
        bodyText: "Eingangsbestätigung an den Kunden versendet.",
        emailMessageId: info.messageId,
        emailFrom: mailbox.address,
        emailTo: [ticket.contact.email],
        sendStatus: "sent",
      },
    });
    return;
  }

  if (job.kind === "agent_new_message") {
    if (!ticket.assigneeId) return;
    const [assignee, message] = await Promise.all([
      db.user.findUnique({ where: { id: ticket.assigneeId } }),
      job.messageId
        ? db.message.findUnique({ where: { id: job.messageId } })
        : Promise.resolve(null),
    ]);
    if (!assignee?.isActive) return;
    const tpl = templates.agentNewMessage(
      { number: ticket.number, token: ticket.token, subject: ticket.subject },
      (message?.bodyText ?? "").slice(0, 300)
    );
    await smtpTransport(mailbox).sendMail({
      from: { name: "SmartLife Support", address: mailbox.address },
      to: assignee.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }
}
