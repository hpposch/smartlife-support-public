// Rauchtest der E-Mail-Pipeline ohne IMAP: speist Roh-EMLs direkt in den
// Ingest ein und prüft Ticket-Erstellung, Threading und Loop-Schutz.
// Aufruf: npx tsx scripts/smoke-ingest.ts  (braucht DATABASE_URL + Redis)
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { queues } from "../src/lib/queue";
import { storeFile } from "../src/lib/storage";
import { ingestEmail } from "../src/mail/ingest";

function eml(opts: {
  from: string;
  subject: string;
  messageId: string;
  body: string;
  inReplyTo?: string;
  extraHeaders?: string[];
}): Buffer {
  return Buffer.from(
    [
      `From: ${opts.from}`,
      `To: support@smartlife.software`,
      `Subject: ${opts.subject}`,
      `Message-ID: ${opts.messageId}`,
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
      ...(opts.extraHeaders ?? []),
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      opts.body,
    ].join("\r\n")
  );
}

async function ingest(raw: Buffer, mailboxId: string) {
  const key = await storeFile("raw-eml", raw);
  const mailbox = await db.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  await ingestEmail(mailbox, key);
}

async function main() {
  process.env.SMOKE_MAILBOX_PASSWORD = "unused";
  const suffix = Math.random().toString(36).slice(2, 8);
  const product = await db.product.findFirstOrThrow({ where: { isDefault: true } });
  const mailbox = await db.mailbox.create({
    data: {
      name: "Smoke-Test",
      address: `smoke-${suffix}@example.com`,
      credentialsRef: "SMOKE_MAILBOX_PASSWORD",
      isActive: false, // kein IMAP-Poll
      productId: product.id,
    },
  });
  const customer = `kunde-${suffix}@example.com`;

  // 1) Neue Mail → neues Ticket + Kontakt + Bestätigungs-Job
  await ingest(
    eml({
      from: `Max Mustermann <${customer}>`,
      subject: "Drucker druckt nicht",
      messageId: `<m1-${suffix}@example.com>`,
      body: "Hallo, mein Drucker druckt nicht mehr.",
    }),
    mailbox.id
  );
  const ticket = await db.ticket.findFirstOrThrow({
    where: { contact: { email: customer } },
    include: { messages: true, contact: true },
  });
  assert.equal(ticket.subject, "Drucker druckt nicht");
  assert.equal(ticket.status, "new");
  assert.equal(ticket.channel, "email");
  assert.equal(ticket.contact.name, "Max Mustermann");
  assert.equal(ticket.messages.length, 1);
  console.log(`✓ Neues Ticket #${ticket.number} aus E-Mail erstellt`);

  // 2) Idempotenz: gleiche Message-ID nochmal → kein Duplikat
  await ingest(
    eml({
      from: customer,
      subject: "Drucker druckt nicht",
      messageId: `<m1-${suffix}@example.com>`,
      body: "Hallo, mein Drucker druckt nicht mehr.",
    }),
    mailbox.id
  );
  assert.equal(await db.message.count({ where: { ticketId: ticket.id } }), 1);
  console.log("✓ Idempotenz: doppelte Mail erzeugt kein Duplikat");

  // 3) Antwort via In-Reply-To → gleiches Ticket, Status bleibt new/open
  await ingest(
    eml({
      from: customer,
      subject: "Re: Drucker druckt nicht",
      messageId: `<m2-${suffix}@example.com>`,
      inReplyTo: `<m1-${suffix}@example.com>`,
      body: "Nachtrag: Fehlercode E42.",
    }),
    mailbox.id
  );
  assert.equal(await db.message.count({ where: { ticketId: ticket.id } }), 2);
  assert.equal(await db.ticket.count({ where: { contactId: ticket.contactId } }), 1);
  console.log("✓ Threading via In-Reply-To");

  // 4) Ticket auf "gelöst" setzen; Antwort nur mit Betreff-Tag → wieder offen
  await db.ticket.update({ where: { id: ticket.id }, data: { status: "resolved" } });
  await ingest(
    eml({
      from: customer,
      subject: `AW: Drucker druckt nicht [#${ticket.number}-${ticket.token}]`,
      messageId: `<m3-${suffix}@example.com>`,
      body: "Problem besteht weiterhin!",
    }),
    mailbox.id
  );
  const reopened = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(await db.message.count({ where: { ticketId: ticket.id } }), 3);
  assert.equal(reopened.status, "open");
  console.log("✓ Threading via Betreff-Tag; Kundenantwort öffnet Ticket wieder");

  // 5) Abwesenheitsnotiz ohne Ticketbezug → kein neues Ticket
  const ticketCountBefore = await db.ticket.count();
  await ingest(
    eml({
      from: `andere-${suffix}@example.com`,
      subject: "Abwesenheitsnotiz",
      messageId: `<m4-${suffix}@example.com>`,
      body: "Ich bin im Urlaub.",
      extraHeaders: ["Auto-Submitted: auto-replied"],
    }),
    mailbox.id
  );
  assert.equal(await db.ticket.count(), ticketCountBefore);
  console.log("✓ Auto-Reply ohne Ticketbezug erzeugt kein Ticket");

  // 6) Bounce → als System-Notiz am Ticket, kein Kundeneintrag
  await ingest(
    eml({
      from: "MAILER-DAEMON@mail.example.com",
      subject: "Undelivered Mail Returned to Sender",
      messageId: `<m5-${suffix}@example.com>`,
      inReplyTo: `<m3-${suffix}@example.com>`,
      body: "Delivery failed.",
    }),
    mailbox.id
  );
  const lastMessage = await db.message.findFirstOrThrow({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(lastMessage.type, "system");
  console.log("✓ Bounce wird als System-Notiz am Ticket vermerkt");

  console.log("\nAlle Rauchtests bestanden.");
}

main()
  .catch((error) => {
    console.error("Rauchtest fehlgeschlagen:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    const q = queues();
    await Promise.allSettled([
      q.mailPoll.close(),
      q.emailIngest.close(),
      q.emailSend.close(),
      q.notify.close(),
    ]);
    q.connection.disconnect();
  });
