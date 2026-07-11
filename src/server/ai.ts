// KI-Unterstützung (Phase 4) über die Claude API:
//   - Antwortentwürfe aus Ticketverlauf + passenden Wissensdatenbank-Artikeln
//   - Zusammenfassung langer Ticketverläufe (als interne Notiz)
//   - Auto-Klassifizierung neuer Tickets (Kategorie, Priorität, Stimmung)
//
// Aktivierung: ANTHROPIC_API_KEY setzen. Modell über AI_MODEL steuerbar
// (Standard: claude-opus-4-8). Auto-Klassifizierung per AI_AUTO_CLASSIFY=false
// abschaltbar.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { db } from "@/lib/db";

export const isAiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
export const isAutoClassifyEnabled = () =>
  isAiEnabled() && process.env.AI_AUTO_CLASSIFY !== "false";

const MODEL = () => process.env.AI_MODEL ?? "claude-opus-4-8";

let clientInstance: Anthropic | null = null;
function client(): Anthropic {
  if (!clientInstance) clientInstance = new Anthropic(); // liest ANTHROPIC_API_KEY/BASE_URL
  return clientInstance;
}

// ---------------------------------------------------------------------------
// Kontext-Aufbereitung (pur, testbar)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "der", "die", "das", "und", "oder", "aber", "nicht", "eine", "einen", "einem",
  "mein", "meine", "ihre", "sich", "wird", "kann", "haben", "sein", "sind",
  "ist", "auf", "mit", "von", "bei", "für", "zum", "zur", "des", "den", "dem",
  "the", "and", "with", "for", "from", "this", "that", "have", "wegen", "bitte",
  "hallo", "frage", "problem", "anfrage",
]);

/** Suchbegriffe aus dem Betreff für die KB-Artikelsuche. */
export function extractKeywords(subject: string, max = 5): string[] {
  const words = subject
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}

interface ConversationEntry {
  role: string;
  text: string;
}

/** Verlauf auf die letzten Einträge kürzen, jeder Eintrag längenbegrenzt. */
export function clampConversation(
  entries: ConversationEntry[],
  maxEntries = 20,
  maxCharsPerEntry = 4000
): ConversationEntry[] {
  return entries.slice(-maxEntries).map((entry) => ({
    role: entry.role,
    text:
      entry.text.length > maxCharsPerEntry
        ? `${entry.text.slice(0, maxCharsPerEntry)} …[gekürzt]`
        : entry.text,
  }));
}

async function buildTicketContext(ticketId: string) {
  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      contact: { include: { organization: true } },
      category: true,
      messages: { orderBy: { createdAt: "asc" }, include: { user: true } },
    },
  });

  const conversation = clampConversation(
    ticket.messages
      .filter((m) => m.type !== "system")
      .map((m) => ({
        role:
          m.type === "customer"
            ? "KUNDE"
            : m.type === "internal_note"
              ? `INTERNE NOTIZ (${m.user?.name ?? "Agent"})`
              : `SUPPORT (${m.user?.name ?? "Agent"})`,
        text: m.bodyText,
      }))
  );

  const transcript = conversation
    .map((entry) => `[${entry.role}]\n${entry.text}`)
    .join("\n\n---\n\n");

  return { ticket, transcript };
}

/** Passende veröffentlichte KB-Artikel per Stichwortsuche auf dem Betreff. */
async function findRelevantKbArticles(subject: string, limit = 3) {
  const keywords = extractKeywords(subject);
  if (keywords.length === 0) return [];
  return db.kbArticle.findMany({
    where: {
      status: "published",
      OR: keywords.flatMap((kw) => [
        { title: { contains: kw, mode: "insensitive" as const } },
        { bodyMarkdown: { contains: kw, mode: "insensitive" as const } },
      ]),
    },
    take: limit,
  });
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// 1) Antwortentwurf
// ---------------------------------------------------------------------------

export async function draftReply(ticketId: string): Promise<string> {
  const { ticket, transcript } = await buildTicketContext(ticketId);
  const articles = await findRelevantKbArticles(ticket.subject);

  const kbContext =
    articles.length > 0
      ? `\n\nRelevante Wissensdatenbank-Artikel (nutze sie, wenn sie zur Frage passen):\n\n${articles
          .map((a) => `### ${a.title}\n${a.bodyMarkdown.slice(0, 3000)}`)
          .join("\n\n")}`
      : "";

  const response = await client().messages.create({
    model: MODEL(),
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: `Du bist ein erfahrener Support-Agent von SmartLife (Software-Unternehmen).
Du entwirfst Antworten an Kunden, die ein menschlicher Agent vor dem Versand prüft.

Regeln für den Entwurf:
- Deutsch, professionell-freundlich, Anrede "Sie"
- Beantworte konkret das Anliegen aus dem Verlauf; erfinde keine Fakten, Preise oder Zusagen
- Wenn dir Informationen fehlen, formuliere gezielte Rückfragen an den Kunden
- Kurz und klar; keine Floskel-Wände
- Gib NUR den Antworttext aus — keine Betreffzeile, keine Anführungszeichen, keine Erklärungen.
  Beginne mit der Anrede (z. B. "Hallo ${ticket.contact.name ?? ""}"), ende ohne Signatur
  (die Signatur ergänzt das System automatisch).`,
    messages: [
      {
        role: "user",
        content: `Ticket #${ticket.number} — Betreff: ${ticket.subject}
Kunde: ${ticket.contact.name ?? ticket.contact.email}${ticket.contact.organization ? ` (${ticket.contact.organization.name})` : ""}
Kategorie: ${ticket.category?.name ?? "—"}

Bisheriger Verlauf:

${transcript}${kbContext}

Entwirf jetzt die nächste Antwort an den Kunden.`,
      },
    ],
  });

  const draft = textOf(response);
  if (!draft) throw new Error("KI-Antwort war leer");
  return draft;
}

// ---------------------------------------------------------------------------
// 2) Zusammenfassung → interne Notiz
// ---------------------------------------------------------------------------

export async function summarizeTicket(ticketId: string, userId: string): Promise<void> {
  const { ticket, transcript } = await buildTicketContext(ticketId);

  const response = await client().messages.create({
    model: MODEL(),
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: `Du fasst Support-Ticketverläufe für Kollegen zusammen, die das Ticket übernehmen.
Antworte auf Deutsch, kompakt und sachlich, in dieser Struktur:
Anliegen: <1-2 Sätze>
Bisheriger Stand: <Stichpunkte, chronologisch>
Offene Punkte: <was als Nächstes zu tun ist / worauf gewartet wird>`,
    messages: [
      {
        role: "user",
        content: `Ticket #${ticket.number} — Betreff: ${ticket.subject}\nStatus: ${ticket.status}\n\n${transcript}`,
      },
    ],
  });

  const summary = textOf(response);
  if (!summary) throw new Error("KI-Zusammenfassung war leer");

  await db.message.create({
    data: {
      ticketId,
      type: "internal_note",
      userId,
      bodyText: `🤖 KI-Zusammenfassung:\n\n${summary}`,
    },
  });
}

// ---------------------------------------------------------------------------
// 3) Auto-Klassifizierung neuer Tickets
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  category: z
    .string()
    .nullable()
    .describe("Exakter Name einer der vorgegebenen Kategorien, oder null wenn keine passt"),
  priority: z
    .enum(["low", "normal", "high", "urgent"])
    .describe("Dringlichkeit aus Kundensicht (urgent nur bei Ausfall/Blocker)"),
  sentiment: z
    .enum(["neutral", "frustriert", "verärgert"])
    .describe("Stimmung des Kunden in der Nachricht"),
});

export async function classifyTicket(ticketId: string): Promise<void> {
  const { ticket, transcript } = await buildTicketContext(ticketId);
  const categories = await db.ticketCategory.findMany({ where: { isActive: true } });

  const response = await client().messages.parse({
    model: MODEL(),
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: zodOutputFormat(classificationSchema),
    },
    system:
      "Du klassifizierst eingehende Support-Tickets eines Software-Unternehmens. Antworte ausschließlich im vorgegebenen JSON-Format.",
    messages: [
      {
        role: "user",
        content: `Verfügbare Kategorien: ${categories.map((c) => c.name).join(", ") || "(keine)"}

Ticket-Betreff: ${ticket.subject}

Erste Nachricht(en):

${transcript.slice(0, 6000)}`,
      },
    ],
  });

  const result = response.parsed_output;
  if (!result) return;

  const applied: Record<string, string> = {};

  // Kategorie nur setzen, wenn noch keine vergeben ist (Regeln haben Vorrang)
  if (!ticket.categoryId && result.category) {
    const category = categories.find(
      (c) => c.name.toLowerCase() === result.category!.toLowerCase()
    );
    if (category) {
      await db.ticket.update({ where: { id: ticketId }, data: { categoryId: category.id } });
      applied.category = category.name;
    }
  }

  // Priorität nur anheben, wenn sie noch auf dem Standardwert steht
  if (ticket.priority === "normal" && (result.priority === "high" || result.priority === "urgent")) {
    const { updateTicket } = await import("./tickets");
    await updateTicket(ticketId, { priority: result.priority }, {});
    applied.priority = result.priority;
  }

  // Verärgerte Kunden sichtbar markieren
  if (result.sentiment === "verärgert" || result.sentiment === "frustriert") {
    const tag = await db.tag.upsert({
      where: { name: "verärgert" },
      update: {},
      create: { name: "verärgert", color: "red" },
    });
    await db.ticketTag.upsert({
      where: { ticketId_tagId: { ticketId, tagId: tag.id } },
      update: {},
      create: { ticketId, tagId: tag.id },
    });
    applied.sentiment = result.sentiment;
  }

  if (Object.keys(applied).length > 0) {
    await db.ticketEvent.create({
      data: { ticketId, eventType: "ai_classified", payload: applied },
    });
  }
}
