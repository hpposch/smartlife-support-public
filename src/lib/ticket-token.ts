import { randomBytes } from "node:crypto";

export function generateTicketToken(): string {
  return randomBytes(4).toString("hex");
}

/** Betreff-Zusatz für Fallback-Threading, z. B. "[#1042-a3f9c2d1]" */
export function subjectTag(number: number, token: string): string {
  return `[#${number}-${token}]`;
}

const TAG_RE = /\[#(\d+)-([0-9a-f]{8})\]/i;

/** Extrahiert Ticketnummer + Token aus einem Betreff, falls vorhanden. */
export function parseSubjectTag(subject: string): { number: number; token: string } | null {
  const match = subject.match(TAG_RE);
  if (!match) return null;
  return { number: Number(match[1]), token: match[2].toLowerCase() };
}

/** Entfernt Re:/Fwd:-Präfixe und einen vorhandenen Ticket-Tag aus dem Betreff. */
export function cleanSubject(subject: string): string {
  return subject
    .replace(TAG_RE, "")
    .replace(/^(\s*((re|aw|fwd?|wg|sv|antw)\s*(\[\d+\])?\s*:)\s*)+/i, "")
    .trim();
}

/** Betreff für ausgehende Antworten. */
export function replySubject(originalSubject: string, number: number, token: string): string {
  const cleaned = cleanSubject(originalSubject) || "Ihre Anfrage";
  return `Re: ${cleaned} ${subjectTag(number, token)}`;
}
