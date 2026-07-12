// Versand von Agentenantworten und Benachrichtigungen per SMTP,
// mit korrekten Threading-Headern (In-Reply-To/References) und
// Speicherung der versendeten Message-ID für eingehendes Threading.
import type Mail from "nodemailer/lib/mailer";
import { db } from "@/lib/db";
import { defaultProduct, productPortalUrl } from "@/lib/product";
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
    include: { mailbox: true, contact: true, team: true, product: true },
  });
  // Bevorzugt das Postfach des Tickets, dann eines des Produkts, dann irgendein aktives
  const mailbox =
    ticket.mailbox ??
    (await db.mailbox.findFirst({ where: { isActive: true, productId: ticket.productId } })) ??
    (await db.mailbox.findFirst({ where: { isActive: true } }));
  if (!mailbox) throw new Error("Kein aktives Postfach für den Versand konfiguriert");
  return { ticket, mailbox, fromName: `${ticket.product.name} Support` };
}

/** Agentenantwort (messages.send_status = pending) versenden. */
export async function sendAgentReply(messageId: string): Promise<void> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { attachments: true, user: true },
  });
  if (message.type !== "agent_reply" || message.sendStatus === "sent") return;

  // WhatsApp-Tickets: Antwort als WhatsApp-Nachricht statt E-Mail
  const ticketMeta = await db.ticket.findUniqueOrThrow({
    where: { id: message.ticketId },
    include: { contact: true },
  });
  if (ticketMeta.channel === "whatsapp" && ticketMeta.contact.phone) {
    const { isWhatsappEnabled, sendWhatsappMessage } = await import("@/server/whatsapp");
    if (!isWhatsappEnabled()) throw new Error("WhatsApp ist nicht konfiguriert");
    try {
      const waId = await sendWhatsappMessage(ticketMeta.contact.phone, message.bodyText);
      await db.message.update({
        where: { id: message.id },
        data: { sendStatus: "sent", sendError: null, emailMessageId: waId },
      });
    } catch (error) {
      await db.message.update({
        where: { id: message.id },
        data: { sendStatus: "failed", sendError: String(error).slice(0, 1000) },
      });
      throw error;
    }
    return;
  }

  const { ticket, mailbox, fromName } = await loadMailboxForTicket(message.ticketId);
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
      from: { name: fromName, address: mailbox.address },
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

/** Benachrichtigungs-Mails (Bestätigung, Agenten-Hinweis, Portal-Login, CSAT, SLA). */
export async function sendNotification(
  job:
    | { kind: "ticket_confirmation" | "agent_new_message" | "csat"; ticketId: string; messageId?: string }
    | { kind: "sla_breach"; ticketId: string; target: "first_response" | "resolution" }
    | { kind: "portal_login"; contactId: string; token: string; productId?: string }
): Promise<void> {
  if (job.kind === "portal_login") {
    const product = job.productId
      ? await db.product.findUniqueOrThrow({ where: { id: job.productId } })
      : await defaultProduct();
    const [contact, mailbox] = await Promise.all([
      db.contact.findUniqueOrThrow({ where: { id: job.contactId } }),
      db.mailbox
        .findFirst({ where: { isActive: true, productId: product.id } })
        .then((m) => m ?? db.mailbox.findFirst({ where: { isActive: true } })),
    ]);
    if (!mailbox) throw new Error("Kein aktives Postfach für den Versand konfiguriert");
    if (contact.isBlocked || contact.anonymizedAt) return;
    // Der Link führt auf die Domain des Produkts, von dem der Login angefordert wurde
    const url = `${productPortalUrl(product)}/portal/auth/${job.token}`;
    const tpl = templates.portalLogin(contact.name, url, product.name);
    await smtpTransport(mailbox).sendMail({
      from: { name: `${product.name} Support`, address: mailbox.address },
      to: contact.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    return;
  }

  const { ticket, mailbox, fromName } = await loadMailboxForTicket(job.ticketId);

  if (job.kind === "ticket_confirmation") {
    if (ticket.contact.isBlocked) return;
    const tpl = templates.ticketConfirmation({
      number: ticket.number,
      token: ticket.token,
      subject: ticket.subject,
      contactName: ticket.contact.name,
      productName: ticket.product.name,
    });
    const headers = await threadingHeaders(ticket.id);
    const info = await smtpTransport(mailbox).sendMail({
      from: { name: fromName, address: mailbox.address },
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

  if (job.kind === "csat") {
    if (ticket.contact.isBlocked) return;
    const survey = await db.csatSurvey.findUnique({ where: { ticketId: ticket.id } });
    if (!survey || survey.answeredAt) return;
    const tpl = templates.csatSurvey(
      {
        number: ticket.number,
        token: ticket.token,
        subject: ticket.subject,
        contactName: ticket.contact.name,
        productName: ticket.product.name,
      },
      survey.token,
      productPortalUrl(ticket.product)
    );
    await smtpTransport(mailbox).sendMail({
      from: { name: fromName, address: mailbox.address },
      to: ticket.contact.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    return;
  }

  if (job.kind === "sla_breach") {
    // Zugewiesenen Agenten informieren, sonst alle Teamleitungen/Admins
    const recipients: string[] = [];
    if (ticket.assigneeId) {
      const assignee = await db.user.findUnique({ where: { id: ticket.assigneeId } });
      if (assignee?.isActive) recipients.push(assignee.email);
    }
    if (recipients.length === 0) {
      const leads = await db.user.findMany({
        where: { isActive: true, role: { in: ["team_lead", "admin"] } },
      });
      recipients.push(...leads.map((l) => l.email));
    }
    if (recipients.length === 0) return;
    const label = job.target === "first_response" ? "Erstreaktion" : "Lösung";
    const dueAt =
      job.target === "first_response" ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
    const tpl = templates.slaBreach(
      { number: ticket.number, token: ticket.token, subject: ticket.subject },
      label,
      dueAt ?? new Date()
    );
    await smtpTransport(mailbox).sendMail({
      from: { name: fromName, address: mailbox.address },
      to: recipients,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
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
      from: { name: fromName, address: mailbox.address },
      to: assignee.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }
}
