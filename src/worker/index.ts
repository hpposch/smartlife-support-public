// Worker-Prozess: verarbeitet alle asynchronen Jobs (IMAP-Abruf, Ingest,
// SMTP-Versand, Benachrichtigungen). Start: `npm run worker`
import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { createRedis, queues, type NotifyJob } from "@/lib/queue";
import { ingestEmail } from "@/mail/ingest";
import { pollAllMailboxes } from "@/mail/poll";
import { sendAgentReply, sendNotification } from "@/mail/send";
import { createBackup } from "@/server/backup";

const connection = createRedis();
const POLL_INTERVAL_MS = Number(process.env.MAIL_POLL_INTERVAL_MS ?? 60_000);
const BACKUP_CRON = process.env.BACKUP_CRON ?? "0 3 * * *"; // täglich 03:00

async function main() {
  // Wiederkehrende Jobs (ein Scheduler-Eintrag je Job, überlebt Neustarts)
  await queues().mailPoll.upsertJobScheduler("poll-all", { every: POLL_INTERVAL_MS });
  await queues().backup.upsertJobScheduler("daily-backup", { pattern: BACKUP_CRON });

  const workers = [
    new Worker(
      "mail-poll",
      async () => {
        await pollAllMailboxes();
      },
      { connection, concurrency: 1 }
    ),

    new Worker<{ mailboxId: string; rawEmlKey: string }>(
      "email-ingest",
      async (job) => {
        const mailbox = await db.mailbox.findUniqueOrThrow({
          where: { id: job.data.mailboxId },
        });
        await ingestEmail(mailbox, job.data.rawEmlKey);
      },
      { connection, concurrency: 4 }
    ),

    new Worker<{ messageId: string }>(
      "email-send",
      async (job) => {
        await sendAgentReply(job.data.messageId);
      },
      { connection, concurrency: 2 }
    ),

    new Worker<NotifyJob>(
      "notify",
      async (job) => {
        await sendNotification(job.data);
      },
      { connection, concurrency: 2 }
    ),

    new Worker(
      "backup",
      async () => {
        const info = await createBackup();
        console.log(
          `[backup] ${info.fileName} erstellt (${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB)`
        );
      },
      { connection, concurrency: 1 }
    ),
  ];

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`[${worker.name}] Job ${job?.id} fehlgeschlagen:`, error.message);
    });
  }

  console.log(
    `Worker gestartet (Postfach-Abruf alle ${Math.round(POLL_INTERVAL_MS / 1000)} s)`
  );

  const shutdown = async () => {
    console.log("Worker fährt herunter …");
    await Promise.allSettled(workers.map((w) => w.close()));
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Worker-Start fehlgeschlagen:", error);
  process.exit(1);
});
