import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __queues: ReturnType<typeof createQueues> | undefined;
}

export function createRedis() {
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
}

function createQueues() {
  const connection = createRedis();
  return {
    connection,
    /** Postfächer per IMAP abrufen (repeatable) */
    mailPoll: new Queue("mail-poll", { connection }),
    /** Eine abgerufene Roh-Mail zu Ticket/Nachricht verarbeiten */
    emailIngest: new Queue<{ mailboxId: string; rawEmlKey: string }>("email-ingest", {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    }),
    /** Eine Nachricht (Agentenantwort/Benachrichtigung) per SMTP versenden */
    emailSend: new Queue<{ messageId: string }>("email-send", {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10000 } },
    }),
    /** Benachrichtigungs-Mails (Bestätigung an Kunde, Hinweis an Agent) */
    notify: new Queue<NotifyJob>("notify", {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10000 } },
    }),
    /** Tägliches Voll-Backup (DB + Datei-Ablage als eine Datei) */
    backup: new Queue("backup", {
      connection,
      defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 60000 } },
    }),
  };
}

export type NotifyJob =
  | { kind: "ticket_confirmation"; ticketId: string }
  | { kind: "agent_new_message"; ticketId: string; messageId: string };

export function queues() {
  if (!globalThis.__queues) globalThis.__queues = createQueues();
  return globalThis.__queues;
}
