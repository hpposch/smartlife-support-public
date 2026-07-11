// Rauchtest Phase 3: SLA-Fristen/Pause/Eskalation, Erstellungs- und
// Zeitregeln, CSAT und Webhook-Zustellung (inkl. Signaturprüfung).
// Aufruf: CSAT_ENABLED=true npx tsx scripts/smoke-phase3.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { db } from "../src/lib/db";
import { queues } from "../src/lib/queue";
import { findOrCreateContact } from "../src/server/contacts";
import { runTimeBasedRules } from "../src/server/automation";
import { checkSlaBreaches } from "../src/server/sla";
import { createTicket, finalizeNewTicket, updateTicket } from "../src/server/tickets";
import { deliverWebhook, emitWebhookEvent } from "../src/server/webhooks";

async function main() {
  const suffix = Math.random().toString(36).slice(2, 8);

  // --- Setup: SLA-Richtlinie (24/7, 60 min / 480 min) + Erstellungsregel ---
  const policy = await db.slaPolicy.create({
    data: {
      name: `Smoke-SLA-${suffix}`,
      targets: { normal: { firstResponseMin: 60, resolutionMin: 480 }, high: { firstResponseMin: 30, resolutionMin: 240 } },
      position: -1000, // gewinnt vor allen anderen
    },
  });
  const rule = await db.automationRule.create({
    data: {
      name: `Smoke-Regel-${suffix}`,
      trigger: "ticket_created",
      conditions: { subjectContains: `smoketest-${suffix}` },
      actions: { setPriority: "high", addTags: [`smoke-${suffix}`], assign: "round_robin" },
      position: -1000,
    },
  });

  // --- 1) Erstellungsregel + SLA-Zuordnung ---
  const contact = await findOrCreateContact(db, `phase3-${suffix}@example.com`, "Phase3 Kunde");
  const ticket = await createTicket(
    { subject: `Anfrage smoketest-${suffix}`, channel: "api", contactId: contact.id },
    { contactId: contact.id }
  );
  await db.message.create({
    data: { ticketId: ticket.id, type: "customer", contactId: contact.id, bodyText: "Test" },
  });
  await finalizeNewTicket(ticket.id);

  let current = await db.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: { tags: { include: { tag: true } } },
  });
  assert.equal(current.priority, "high", "Regel setzt Priorität");
  assert.ok(current.tags.some((t) => t.tag.name === `smoke-${suffix}`), "Regel setzt Tag");
  assert.ok(current.assigneeId, "Round-Robin weist zu");
  assert.ok(current.slaPolicyId === policy.id, "SLA-Richtlinie zugeordnet");
  // high: Erstreaktion 30 min (24/7) → ~30 min ab Erstellung
  const frMinutes = (current.firstResponseDueAt!.getTime() - current.createdAt.getTime()) / 60000;
  assert.ok(Math.abs(frMinutes - 30) < 1, `Erstreaktionsfrist ~30 min (ist ${frMinutes})`);
  console.log("✓ Erstellungsregel (Priorität, Tag, Round-Robin) + SLA-Fristen");

  // --- 2) SLA-Pause bei "Wartet auf Kunde" ---
  await updateTicket(ticket.id, { status: "pending_customer" }, {});
  current = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { tags: { include: { tag: true } } } });
  assert.ok(current.slaPausedAt, "SLA-Uhr pausiert");
  await updateTicket(ticket.id, { status: "open" }, {});
  current = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { tags: { include: { tag: true } } } });
  assert.equal(current.slaPausedAt, null, "SLA-Uhr läuft wieder");
  console.log("✓ SLA-Pause und Fortsetzung");

  // --- 3) Eskalation bei Fristverletzung ---
  await db.ticket.update({
    where: { id: ticket.id },
    data: { firstResponseDueAt: new Date(Date.now() - 60000) },
  });
  await checkSlaBreaches();
  const breach = await db.slaEvent.findUnique({
    where: { ticketId_target: { ticketId: ticket.id, target: "first_response" } },
  });
  assert.equal(breach?.outcome, "breached", "Verletzung erfasst");
  const sysNote = await db.message.findFirst({
    where: { ticketId: ticket.id, type: "system", bodyText: { contains: "SLA-Verletzung" } },
  });
  assert.ok(sysNote, "System-Notiz zur Verletzung");
  console.log("✓ SLA-Eskalation (Ereignis + System-Notiz + Benachrichtigungs-Job)");

  // --- 4) Lösung + CSAT ---
  process.env.CSAT_ENABLED = "true";
  await updateTicket(ticket.id, { status: "resolved" }, {});
  const resolution = await db.slaEvent.findUnique({
    where: { ticketId_target: { ticketId: ticket.id, target: "resolution" } },
  });
  assert.equal(resolution?.outcome, "met", "Lösungs-Ziel erfüllt");
  const survey = await db.csatSurvey.findUnique({ where: { ticketId: ticket.id } });
  assert.ok(survey, "CSAT-Umfrage angelegt");
  await db.csatSurvey.update({
    where: { id: survey!.id },
    data: { rating: 5, answeredAt: new Date() },
  });
  console.log("✓ Lösungs-SLA erfüllt + CSAT-Umfrage erstellt");

  // --- 5) Zeitregel: Auto-Schließen ---
  await db.automationRule.create({
    data: {
      name: `Smoke-Zeitregel-${suffix}`,
      trigger: "time_based",
      conditions: { status: "resolved", olderThanHours: 0.0001 },
      actions: { setStatus: "closed", noteText: "Automatisch geschlossen (Smoke-Test)." },
      position: -999,
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  await runTimeBasedRules();
  current = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { tags: { include: { tag: true } } } });
  assert.equal(current.status, "closed", "Zeitregel schließt Ticket");
  console.log("✓ Zeitregel: Auto-Schließen inkl. System-Notiz");

  // --- 6) Webhook mit Signaturprüfung ---
  const received: { body: string; signature: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body, signature: String(req.headers["x-signature"] ?? "") });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(4567, r));
  const hook = await db.webhook.create({
    data: { url: "http://localhost:4567/hook", events: ["ticket.closed"], secret: "smoke-secret" },
  });
  await emitWebhookEvent("ticket.closed", ticket.id);
  // Job direkt zustellen (ohne Worker-Prozess)
  const jobs = await queues().webhook.getJobs(["waiting", "delayed"]);
  for (const job of jobs) {
    if (job.data.webhookId === hook.id) await deliverWebhook(job.data.webhookId, job.data.body);
  }
  assert.equal(received.length, 1, "Webhook zugestellt");
  const expected = `sha256=${createHmac("sha256", "smoke-secret").update(received[0].body).digest("hex")}`;
  assert.equal(received[0].signature, expected, "HMAC-Signatur korrekt");
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.event, "ticket.closed");
  assert.equal(payload.data.number, current.number);
  server.close();
  console.log("✓ Webhook: Zustellung + korrekte HMAC-Signatur");

  // --- Aufräumen (Testregeln/-richtlinie deaktivieren) ---
  await db.automationRule.deleteMany({ where: { name: { contains: suffix } } });
  await db.slaPolicy.update({ where: { id: policy.id }, data: { isActive: false } });
  await db.webhook.delete({ where: { id: hook.id } });
  void rule;

  console.log("\nAlle Phase-3-Rauchtests bestanden.");
}

main()
  .catch((error) => {
    console.error("Rauchtest fehlgeschlagen:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    const q = queues();
    await Promise.allSettled(
      [q.mailPoll, q.emailIngest, q.emailSend, q.notify, q.backup, q.slaCheck, q.timeRules, q.webhook].map((x) => x.close())
    );
    q.connection.disconnect();
  });
