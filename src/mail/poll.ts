// IMAP-Poller: holt neue Mails aller aktiven Postfächer ab, legt die
// Rohdaten in der Datei-Ablage ab und reiht je Mail einen Ingest-Job ein.
// Fortschritt wird über die IMAP-UID (last_seen_uid) verfolgt.
import { ImapFlow } from "imapflow";
import type { Mailbox } from "@prisma/client";
import { db } from "@/lib/db";
import { mailboxPassword } from "@/lib/env";
import { queues } from "@/lib/queue";
import { storeFile } from "@/lib/storage";

async function pollMailbox(mailbox: Mailbox): Promise<number> {
  if (!mailbox.imapHost || !mailbox.imapPort || !mailbox.imapUser) {
    throw new Error(`Mailbox ${mailbox.address}: IMAP nicht konfiguriert`);
  }

  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapPort === 993,
    auth: { user: mailbox.imapUser, pass: mailboxPassword(mailbox.credentialsRef) },
    logger: false,
  });

  let ingested = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const lastSeen = Number(mailbox.lastSeenUid);
      let maxUid = lastSeen;

      for await (const msg of client.fetch(
        { uid: `${lastSeen + 1}:*` },
        { uid: true, source: true },
        { uid: true }
      )) {
        // "n:*" liefert immer mind. die letzte Mail — bereits Gesehenes überspringen
        if (msg.uid <= lastSeen || !msg.source) continue;

        const rawEmlKey = await storeFile("raw-eml", msg.source);
        await queues().emailIngest.add(
          "ingest",
          { mailboxId: mailbox.id, rawEmlKey },
          // UID als Job-ID: kein Doppel-Enqueue, falls das UID-Update fehlschlug
          { jobId: `${mailbox.id}:${msg.uid}` }
        );
        maxUid = Math.max(maxUid, msg.uid);
        ingested++;
      }

      if (maxUid > lastSeen) {
        await db.mailbox.update({
          where: { id: mailbox.id },
          data: { lastSeenUid: BigInt(maxUid) },
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return ingested;
}

export async function pollAllMailboxes(): Promise<void> {
  const mailboxes = await db.mailbox.findMany({ where: { isActive: true } });
  for (const mailbox of mailboxes) {
    try {
      const count = await pollMailbox(mailbox);
      if (count > 0) console.log(`[mail-poll] ${mailbox.address}: ${count} neue Mail(s)`);
    } catch (error) {
      // Ein defektes Postfach darf die anderen nicht blockieren
      console.error(`[mail-poll] Fehler bei ${mailbox.address}:`, error);
    }
  }
}
