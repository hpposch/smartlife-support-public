// Benachrichtigungs-Vorlagen. Bewusst schlichtes HTML — Zustellbarkeit
// schlägt Optik. Platzhalter werden serverseitig ersetzt.
import { subjectTag } from "@/lib/ticket-token";
import { env } from "@/lib/env";

interface TicketInfo {
  number: number;
  token: string;
  subject: string;
  contactName?: string | null;
  // Produktname für Anrede/Signatur in Kunden-Mails (Mehrprodukt-Betrieb)
  productName?: string;
}

function layout(body: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">${body}</div>`;
}

function teamSignature(productName?: string): string {
  return `Ihr ${productName ?? "SmartLife"}-Support-Team`;
}

export function ticketConfirmation(t: TicketInfo) {
  const greeting = t.contactName ? `Hallo ${t.contactName},` : "Hallo,";
  return {
    subject: `Re: ${t.subject} ${subjectTag(t.number, t.token)}`,
    html: layout(
      `<p>${greeting}</p>
       <p>vielen Dank für Ihre Anfrage. Wir haben sie unter der Ticketnummer
       <strong>#${t.number}</strong> aufgenommen und melden uns so schnell wie möglich.</p>
       <p>Antworten Sie einfach auf diese E-Mail, um Ihrer Anfrage etwas hinzuzufügen.</p>
       <p>${teamSignature(t.productName)}</p>`
    ),
    text: `${greeting}\n\nvielen Dank für Ihre Anfrage. Wir haben sie unter der Ticketnummer #${t.number} aufgenommen und melden uns so schnell wie möglich.\n\nAntworten Sie einfach auf diese E-Mail, um Ihrer Anfrage etwas hinzuzufügen.\n\n${teamSignature(t.productName)}`,
  };
}

export function portalLogin(contactName: string | null, loginUrl: string, productName?: string) {
  const greeting = contactName ? `Hallo ${contactName},` : "Hallo,";
  return {
    subject: `Ihr Anmeldelink für das ${productName ?? "SmartLife"}-Supportportal`,
    html: layout(
      `<p>${greeting}</p>
       <p>mit diesem Link melden Sie sich im Supportportal an (30 Minuten gültig):</p>
       <p><a href="${loginUrl}">Jetzt anmelden</a></p>
       <p>Falls Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.</p>
       <p>${teamSignature(productName)}</p>`
    ),
    text: `${greeting}\n\nmit diesem Link melden Sie sich im Supportportal an (30 Minuten gültig):\n\n${loginUrl}\n\nFalls Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.\n\n${teamSignature(productName)}`,
  };
}

export function csatSurvey(t: TicketInfo, token: string, portalBase?: string) {
  const greeting = t.contactName ? `Hallo ${t.contactName},` : "Hallo,";
  const base = `${portalBase ?? env.appUrl}/csat/${token}`;
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<a href="${base}?rating=${n}" style="display:inline-block;padding:8px 14px;margin:0 3px;border:1px solid #d1d5db;border-radius:8px;text-decoration:none;color:#1f2937;font-size:18px">${n}</a>`
    )
    .join("");
  return {
    subject: `Wie zufrieden waren Sie mit unserer Hilfe? (Ticket #${t.number})`,
    html: layout(
      `<p>${greeting}</p>
       <p>Ihre Anfrage <strong>„${t.subject}“</strong> wurde gelöst. Wie zufrieden
       waren Sie mit unserem Support? (1 = unzufrieden, 5 = sehr zufrieden)</p>
       <p style="text-align:center;margin:20px 0">${stars}</p>
       <p>Vielen Dank!<br/>${teamSignature(t.productName)}</p>`
    ),
    text: `${greeting}\n\nIhre Anfrage „${t.subject}“ wurde gelöst. Wie zufrieden waren Sie mit unserem Support? (1 = unzufrieden, 5 = sehr zufrieden)\n\nBewerten: ${base}\n\nVielen Dank!\n${teamSignature(t.productName)}`,
  };
}

export function slaBreach(t: TicketInfo, targetLabel: string, dueAt: Date) {
  const url = `${env.appUrl}/tickets/by-number/${t.number}`;
  return {
    subject: `⚠ SLA-Verletzung in Ticket #${t.number}: ${targetLabel}`,
    html: layout(
      `<p>In Ticket <strong>#${t.number}</strong> („${t.subject}“) wurde das
       SLA-Ziel <strong>${targetLabel}</strong> verletzt (fällig:
       ${dueAt.toLocaleString("de-AT", { timeZone: "Europe/Vienna" })}).</p>
       <p><a href="${url}">Ticket öffnen</a></p>`
    ),
    text: `In Ticket #${t.number} („${t.subject}“) wurde das SLA-Ziel ${targetLabel} verletzt (fällig: ${dueAt.toISOString()}).\n\nTicket öffnen: ${url}`,
  };
}

export function agentNewMessage(t: TicketInfo, preview: string) {
  const url = `${env.appUrl}/tickets/by-number/${t.number}`;
  return {
    subject: `Neue Kundenantwort in Ticket #${t.number}: ${t.subject}`,
    html: layout(
      `<p>Es gibt eine neue Kundenantwort in Ticket <strong>#${t.number}</strong> („${t.subject}“):</p>
       <blockquote style="border-left:3px solid #d1d5db;margin:0;padding:4px 12px;color:#4b5563">${preview}</blockquote>
       <p><a href="${url}">Ticket öffnen</a></p>`
    ),
    text: `Neue Kundenantwort in Ticket #${t.number} („${t.subject}“):\n\n${preview}\n\nTicket öffnen: ${url}`,
  };
}
