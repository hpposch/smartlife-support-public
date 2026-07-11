// Rauchtest Phase 4 (KI): startet einen lokalen Claude-API-Stub und prüft
// Antwortentwurf, Zusammenfassung und Auto-Klassifizierung gegen die DB.
// Aufruf: npx tsx scripts/smoke-ai.ts  (braucht DATABASE_URL + Redis)
import assert from "node:assert/strict";
import { createServer } from "node:http";

// Stub-Umgebung VOR dem Import von ai.ts setzen (Client liest env beim Bau)
const STUB_PORT = 4747;
process.env.ANTHROPIC_API_KEY = "stub-key";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${STUB_PORT}`;

async function startStub(): Promise<() => void> {
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/v1/messages") && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);

      let text: string;
      if (request.output_config?.format) {
        // Klassifizierungs-Aufruf (strukturierte Ausgabe)
        text = JSON.stringify({
          category: "Abrechnung",
          priority: "high",
          sentiment: "verärgert",
        });
      } else if (String(request.system ?? "").includes("entwirfst Antworten")) {
        text = "Hallo Frau Beispiel,\n\nvielen Dank für Ihre Nachricht zur Rechnung. [Stub-Entwurf]";
      } else {
        text = "Anliegen: Kunde reklamiert Rechnung. [Stub-Zusammenfassung]";
      }

      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((r) => server.listen(STUB_PORT, r));
  return () => server.close();
}

async function main() {
  const stopStub = await startStub();
  const { db } = await import("../src/lib/db");
  const { findOrCreateContact } = await import("../src/server/contacts");
  const { createTicket } = await import("../src/server/tickets");
  const { classifyTicket, draftReply, summarizeTicket, isAutoClassifyEnabled } = await import(
    "../src/server/ai"
  );

  try {
    assert.ok(isAutoClassifyEnabled(), "KI aktiviert");

    const suffix = Math.random().toString(36).slice(2, 8);
    const contact = await findOrCreateContact(db, `ai-${suffix}@example.com`, "Frau Beispiel");
    const ticket = await createTicket(
      { subject: `Beschwerde zur Rechnung ${suffix}`, channel: "api", contactId: contact.id },
      { contactId: contact.id }
    );
    await db.message.create({
      data: {
        ticketId: ticket.id,
        type: "customer",
        contactId: contact.id,
        bodyText: "Das ist jetzt das dritte Mal, dass die Rechnung falsch ist. Ich bin sehr verärgert!",
      },
    });
    await db.ticketCategory.upsert({
      where: { name: "Abrechnung" },
      update: { isActive: true },
      create: { name: "Abrechnung" },
    });

    // 1) Antwortentwurf
    const draft = await draftReply(ticket.id);
    assert.ok(draft.includes("Stub-Entwurf"), "Entwurf kommt aus der API");
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

    console.log("\nAlle KI-Rauchtests bestanden.");
  } finally {
    stopStub();
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
    const { queues } = await import("../src/lib/queue");
    const q = queues();
    await Promise.allSettled(
      [q.mailPoll, q.emailIngest, q.emailSend, q.notify, q.backup, q.slaCheck, q.timeRules, q.webhook, q.aiClassify].map((x) => x.close())
    );
    q.connection.disconnect();
  }
}

main().catch((error) => {
  console.error("Rauchtest fehlgeschlagen:", error);
  process.exit(1);
});
