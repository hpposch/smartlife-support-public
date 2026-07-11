// Benachrichtigungs-Vorlagen. Bewusst schlichtes HTML — Zustellbarkeit
// schlägt Optik. Platzhalter werden serverseitig ersetzt.
import { subjectTag } from "@/lib/ticket-token";
import { env } from "@/lib/env";

interface TicketInfo {
  number: number;
  token: string;
  subject: string;
  contactName?: string | null;
}

function layout(body: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">${body}</div>`;
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
       <p>Ihr SmartLife-Support-Team</p>`
    ),
    text: `${greeting}\n\nvielen Dank für Ihre Anfrage. Wir haben sie unter der Ticketnummer #${t.number} aufgenommen und melden uns so schnell wie möglich.\n\nAntworten Sie einfach auf diese E-Mail, um Ihrer Anfrage etwas hinzuzufügen.\n\nIhr SmartLife-Support-Team`,
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
