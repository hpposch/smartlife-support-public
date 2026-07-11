// KI-Chat-Assistent für Hilfe-Center und Kundenportal: beantwortet Fragen
// auf Basis der Wissensdatenbank und bietet bei Bedarf an, ein Support-
// Ticket mit dem kompletten Chatverlauf zu erstellen.
import * as z from "zod/v4";
import { db } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { extractKeywords } from "./ai";
import { aiCompleteStructured } from "./ai-provider";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export const CHAT_LIMITS = { maxMessages: 16, maxChars: 3000 };

/** Verlauf begrenzen (Kosten-/Missbrauchsschutz). */
export function clampChat(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-CHAT_LIMITS.maxMessages).map((m) => ({
    role: m.role,
    text: m.text.slice(0, CHAT_LIMITS.maxChars),
  }));
}

/** Chatverlauf als Ticket-Text formatieren. */
export function formatTranscript(history: ChatMessage[]): string {
  const lines = history.map(
    (m) => `${m.role === "user" ? "Kunde" : "Assistent"}: ${m.text.trim()}`
  );
  return `Anfrage aus dem Chat-Assistenten.\n\n--- Chatverlauf ---\n\n${lines.join("\n\n")}`;
}

const responseSchema = z.object({
  reply: z.string().describe("Antwort an den Kunden, Markdown erlaubt"),
  offer_ticket: z
    .boolean()
    .describe(
      "true, wenn ein Support-Ticket sinnvoll ist (Frage nicht beantwortbar, kontospezifisches Problem, Fehlermeldung, Kunde wünscht menschliche Hilfe)"
    ),
  suggested_subject: z
    .string()
    .nullable()
    .describe("Kurzer Ticket-Betreff, falls offer_ticket true, sonst null"),
});

export interface AssistantResult {
  reply: string;
  replyHtml: string;
  offerTicket: boolean;
  suggestedSubject: string | null;
}

export async function assistantReply(history: ChatMessage[]): Promise<AssistantResult> {
  const chat = clampChat(history);

  // Passende KB-Artikel zu den letzten Nutzer-Nachrichten suchen
  const userText = chat
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.text)
    .join(" ");
  const keywords = extractKeywords(userText, 6);
  const articles =
    keywords.length > 0
      ? await db.kbArticle.findMany({
          where: {
            status: "published",
            visibility: "public",
            AND: [{ OR: [{ categoryId: null }, { category: { isHidden: false } }] }],
            OR: keywords.flatMap((kw) => [
              { title: { contains: kw, mode: "insensitive" as const } },
              { bodyMarkdown: { contains: kw, mode: "insensitive" as const } },
            ]),
          },
          take: 4,
          select: { title: true, slug: true, bodyMarkdown: true },
        })
      : [];

  const kbContext =
    articles.length > 0
      ? `\n\nWissensdatenbank-Artikel (verlinke passende als [Titel](/kb/slug)):\n\n${articles
          .map((a) => `### ${a.title} (slug: ${a.slug})\n${a.bodyMarkdown.slice(0, 2500)}`)
          .join("\n\n")}`
      : "\n\n(Keine passenden Wissensdatenbank-Artikel gefunden.)";

  const parsed = await aiCompleteStructured({
    maxTokens: 2048,
    schema: responseSchema,
    schemaName: "chat_reply",
    system: `Du bist der Chat-Assistent des smartlife-BI-Supportportals (Business-Intelligence-Software).

Regeln:
- Antworte in der Sprache des Kunden (Deutsch bei deutschen Nachrichten)
- Beantworte Fragen NUR auf Basis der mitgelieferten Wissensdatenbank-Artikel und allgemeinem Produktwissen daraus — erfinde keine Funktionen, Preise oder Zusagen
- Verlinke passende Artikel im Format [Titel](/kb/slug)
- Halte Antworten kompakt (wenige Absätze, gern Aufzählungen)
- Setze offer_ticket auf true, wenn du nicht sicher weiterhelfen kannst, das Anliegen kontospezifisch ist (Rechnung, Zugang, Fehler in der Umgebung des Kunden) oder der Kunde menschliche Hilfe wünscht — biete das Ticket dann auch im Antworttext an
- Du kannst KEINE Aktionen ausführen (nichts ändern, nichts einsehen) — nur informieren und die Ticket-Erstellung anbieten${kbContext}`,
    messages: chat.map((m) => ({ role: m.role, content: m.text })),
  });

  if (!parsed) throw new Error("Assistent-Antwort nicht parsebar");

  return {
    reply: parsed.reply,
    replyHtml: renderMarkdown(parsed.reply),
    offerTicket: parsed.offer_ticket,
    suggestedSubject: parsed.suggested_subject,
  };
}
