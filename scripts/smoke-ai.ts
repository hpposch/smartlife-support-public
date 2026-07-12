// Rauchtest Phase 4 (KI): startet den lokalen KI-API-Stub (Claude- und
// OpenAI-Format, scripts/ai-stub-server.ts) und prüft Antwortentwurf,
// Zusammenfassung, Auto-Klassifizierung und Chat-Assistent mit BEIDEN
// Providern gegen die DB.
// Aufruf: npx tsx scripts/smoke-ai.ts  (braucht DATABASE_URL + Redis)
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

// Stub-Umgebung VOR dem Import von ai.ts setzen
const STUB_PORT = 4747;
process.env.ANTHROPIC_API_KEY = "stub-key";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${STUB_PORT}`;

// Stub abgekoppelt (eigene Prozessgruppe, stdio ignoriert) starten, damit er
// beim Aufräumen samt Kindprozessen beendet werden kann und keine Pipe offen hält.
async function startStub(): Promise<ChildProcess> {
  const child = spawn("npx", ["tsx", "scripts/ai-stub-server.ts", String(STUB_PORT)], {
    stdio: "ignore",
    detached: true,
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`http://localhost:${STUB_PORT}/`, { method: "GET" });
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  stopStub(child);
  throw new Error("KI-Stub ist nicht gestartet");
}

function stopStub(child: ChildProcess) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM"); // ganze Prozessgruppe (npx + tsx)
    } catch {
      child.kill();
    }
  }
}

async function main() {
  const stub = await startStub();
  const { db } = await import("../src/lib/db");
  const { findOrCreateContact } = await import("../src/server/contacts");
  const { createTicket } = await import("../src/server/tickets");
  const { classifyTicket, draftReply, summarizeTicket, isAutoClassifyEnabled } = await import(
    "../src/server/ai"
  );
  const { assistantReply } = await import("../src/server/chat-assistant");

  const product = await db.product.findFirstOrThrow({ where: { isDefault: true } });
  async function makeTicket(contactId: string, subject: string, bodyText: string) {
    const ticket = await createTicket(
      { subject, channel: "api", contactId, productId: product.id },
      { contactId }
    );
    await db.message.create({
      data: { ticketId: ticket.id, type: "customer", contactId, bodyText },
    });
    return ticket;
  }

  try {
    assert.ok(isAutoClassifyEnabled(), "KI aktiviert");

    const suffix = Math.random().toString(36).slice(2, 8);
    const contact = await findOrCreateContact(db, `ai-${suffix}@example.com`, "Frau Beispiel");
    const ticket = await makeTicket(
      contact.id,
      `Beschwerde zur Rechnung ${suffix}`,
      "Das ist jetzt das dritte Mal, dass die Rechnung falsch ist. Ich bin sehr verärgert!"
    );
    await db.ticketCategory.upsert({
      where: { name: "Abrechnung" },
      update: { isActive: true },
      create: { name: "Abrechnung" },
    });

    // 1) Antwortentwurf
    const draft = await draftReply(ticket.id);
    assert.ok(draft.includes("Test-Stub"), "Entwurf kommt aus der API");
    assert.ok(draft.startsWith("Hallo"), "Entwurf beginnt mit Anrede");
    console.log("✓ KI-Antwortentwurf");

    // 2) Zusammenfassung als interne Notiz
    const admin = await db.user.findFirstOrThrow({ where: { role: "admin" } });
    await summarizeTicket(ticket.id, admin.id);
    const note = await db.message.findFirst({
      where: { ticketId: ticket.id, type: "internal_note", bodyText: { contains: "KI-Zusammenfassung" } },
    });
    assert.ok(note, "Zusammenfassung als interne Notiz gespeichert");
    console.log("✓ KI-Zusammenfassung als interne Notiz");

    // 3) Auto-Klassifizierung (Kategorie, Priorität, Stimmungs-Tag)
    await classifyTicket(ticket.id);
    const classified = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { category: true, tags: { include: { tag: true } } },
    });
    assert.equal(classified.category?.name, "Abrechnung", "Kategorie gesetzt");
    assert.equal(classified.priority, "high", "Priorität angehoben");
    assert.ok(classified.tags.some((t) => t.tag.name === "verärgert"), "Stimmungs-Tag gesetzt");
    const event = await db.ticketEvent.findFirst({
      where: { ticketId: ticket.id, eventType: "ai_classified" },
    });
    assert.ok(event, "Audit-Event geschrieben");
    console.log("✓ Auto-Klassifizierung (Kategorie, Priorität, Stimmungs-Tag, Audit)");

    // 4) Klassifizierung überschreibt vorhandene Kategorie NICHT
    const ticket2 = await createTicket(
      {
        subject: `Zweite Anfrage ${suffix}`,
        channel: "api",
        contactId: contact.id,
        productId: product.id,
        categoryId: (await db.ticketCategory.findFirstOrThrow({ where: { name: { not: "Abrechnung" } } })).id,
      },
      { contactId: contact.id }
    );
    await db.message.create({
      data: { ticketId: ticket2.id, type: "customer", contactId: contact.id, bodyText: "Test" },
    });
    const before = (await db.ticket.findUniqueOrThrow({ where: { id: ticket2.id } })).categoryId;
    await classifyTicket(ticket2.id);
    const after = (await db.ticket.findUniqueOrThrow({ where: { id: ticket2.id } })).categoryId;
    assert.equal(after, before, "Vorhandene Kategorie bleibt unangetastet");
    console.log("✓ Bestehende Kategorie hat Vorrang vor KI-Vorschlag");

    // -----------------------------------------------------------------------
    // OpenAI-kompatibler Provider: dieselben Kernfunktionen über
    // /v1/chat/completions desselben Stubs
    // -----------------------------------------------------------------------
    process.env.AI_PROVIDER = "openai";
    process.env.AI_BASE_URL = `http://localhost:${STUB_PORT}/v1`;
    process.env.AI_API_KEY = "stub-key";
    process.env.AI_MODEL = "stub-model";

    const draftOpenAi = await draftReply(ticket.id);
    assert.ok(draftOpenAi.includes("Test-Stub"), "OpenAI: Entwurf kommt aus der API");
    console.log("✓ OpenAI-Provider: Antwortentwurf");

    const ticket3 = await makeTicket(
      contact.id,
      `Dritte Anfrage ${suffix}`,
      "Schon wieder eine falsche Rechnung!"
    );
    await classifyTicket(ticket3.id);
    const classified3 = await db.ticket.findUniqueOrThrow({
      where: { id: ticket3.id },
      include: { category: true },
    });
    assert.equal(classified3.category?.name, "Abrechnung", "OpenAI: Kategorie gesetzt");
    assert.equal(classified3.priority, "high", "OpenAI: Priorität angehoben");
    console.log("✓ OpenAI-Provider: strukturierte Klassifizierung (response_format json_schema)");

    const chatProblem = await assistantReply(
      [{ role: "user", text: "Meine Dashboard-Anzeige funktioniert nicht, ich habe ein Problem." }],
      product.id
    );
    assert.equal(chatProblem.offerTicket, true, "OpenAI: Chat bietet Ticket an");
    assert.ok(chatProblem.reply.includes("[Stub]"), "OpenAI: Chat-Antwort kommt aus der API");
    const chatQuestion = await assistantReply(
      [{ role: "user", text: "Wie erstelle ich ein Dashboard?" }],
      product.id
    );
    assert.equal(chatQuestion.offerTicket, false, "OpenAI: normale Frage ohne Ticket-Angebot");
    assert.ok(chatQuestion.replyHtml.includes("/kb/"), "OpenAI: Antwort verlinkt KB-Artikel");
    console.log("✓ OpenAI-Provider: Chat-Assistent (Antwort + Ticket-Angebot)");

    // 4b) KB-Artikel-Entwurf aus Ticket
    const { draftKbArticleFromTicket } = await import("../src/server/ai");
    const kbDraftId = await draftKbArticleFromTicket(ticket.id, admin.id);
    const kbDraft = await db.kbArticle.findUniqueOrThrow({ where: { id: kbDraftId } });
    assert.equal(kbDraft.status, "draft", "KB-Entwurf ist Entwurf");
    assert.ok(kbDraft.bodyMarkdown.includes("[Stub]"), "KB-Entwurf kommt aus der API");
    assert.equal(kbDraft.productId, product.id, "KB-Entwurf im Produkt des Tickets");
    console.log("✓ KB-Artikel-Entwurf aus Ticket");

    // 5) Semantische Suche: Artikel einbetten, dann mit anderen Worten finden
    const { embedPendingArticles, searchKb } = await import("../src/server/kb-search");
    const kbCat = await db.kbCategory.upsert({
      where: { productId_slug: { productId: product.id, slug: `smoke-${suffix}` } },
      update: {},
      create: { name: `Smoke ${suffix}`, slug: `smoke-${suffix}`, productId: product.id },
    });
    await db.kbArticle.create({
      data: {
        title: `Exportieren von Berichten als PDF ${suffix}`,
        slug: `export-pdf-${suffix}`,
        bodyMarkdown: "Berichte lassen sich über das Menü Exportieren als PDF Datei speichern.",
        productId: product.id,
        categoryId: kbCat.id,
        status: "published",
        visibility: "public",
        publishedAt: new Date(),
      },
    });
    const embedded = await embedPendingArticles(200);
    assert.ok(embedded > 0, "Embeddings erzeugt");
    const hits = await searchKb({
      productId: product.id,
      query: `Exportieren PDF ${suffix}`,
      limit: 5,
    });
    assert.ok(hits.some((h) => h.slug === `export-pdf-${suffix}`), "Suche findet den Artikel");
    console.log(`✓ Volltext-/semantische Suche (${embedded} Artikel indexiert)`);

    console.log("\nAlle KI-Rauchtests bestanden (Anthropic- und OpenAI-Provider).");
  } finally {
    stopStub(stub);
    await db.$disconnect();
    const { queues } = await import("../src/lib/queue");
    const q = queues();
    await Promise.allSettled(
      [q.mailPoll, q.emailIngest, q.emailSend, q.notify, q.backup, q.slaCheck, q.timeRules, q.webhook, q.aiClassify, q.kbIndex].map((x) => x.close())
    );
    q.connection.disconnect();
  }
}

main().catch((error) => {
  console.error("Rauchtest fehlgeschlagen:", error);
  process.exit(1);
});
