// Worker-Prozess: verarbeitet alle asynchronen Jobs (IMAP-Abruf, Ingest,
// SMTP-Versand, Benachrichtigungen). Start: `npm run worker`
import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { createRedis, queues, type NotifyJob } from "@/lib/queue";
import { ingestEmail } from "@/mail/ingest";
import { pollAllMailboxes } from "@/mail/poll";
import { sendAgentReply, sendNotification } from "@/mail/send";
import { createBackup } from "@/server/backup";
import { runTimeBasedRules } from "@/server/automation";
import { checkSlaBreaches } from "@/server/sla";
import { deliverWebhook } from "@/server/webhooks";

const connection = createRedis();
const POLL_INTERVAL_MS = Number(process.env.MAIL_POLL_INTERVAL_MS ?? 60_000);
const BACKUP_CRON = process.env.BACKUP_CRON ?? "0 3 * * *"; // täglich 03:00

async function main() {
  // Wiederkehrende Jobs (ein Scheduler-Eintrag je Job, überlebt Neustarts)
  await queues().mailPoll.upsertJobScheduler("poll-all", { every: POLL_INTERVAL_MS });
  await queues().backup.upsertJobScheduler("daily-backup", { pattern: BACKUP_CRON });
  // Aufbewahrungsfrist (DSGVO): Inhalte alter geschlossener Tickets schwärzen
  if (Number(process.env.RETENTION_ANONYMIZE_DAYS) > 0) {
    await queues().backup.upsertJobScheduler("retention", { pattern: "30 4 * * *" });
  }
  await queues().slaCheck.upsertJobScheduler("sla-check", { every: 5 * 60_000 });
  await queues().timeRules.upsertJobScheduler("time-rules", { every: 15 * 60_000 });
  // Embeddings für neue/geänderte KB-Artikel (wirkt nur mit OpenAI-kompatiblem Provider)
  await queues().kbIndex.upsertJobScheduler("kb-index", { every: 10 * 60_000 });
  // Betriebs-Monitoring: Alert bei stehendem Postfach-Abruf (ALERT_EMAIL)
  await queues().slaCheck.upsertJobScheduler("monitor", { every: 10 * 60_000 });

  // Worker-Heartbeat für /api/health
  const { recordHeartbeat } = await import("@/server/monitoring");
  await recordHeartbeat("worker");
  setInterval(() => void recordHeartbeat("worker").catch(() => {}), 30_000);

  const workers = [
    new Worker(
      "kb-index",
      async () => {
        const { embedPendingArticles } = await import("@/server/kb-search");
        const count = await embedPendingArticles();
        if (count > 0) console.log(`[kb-index] ${count} Artikel-Embedding(s) aktualisiert`);
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "mail-poll",
      async () => {
        await pollAllMailboxes();
        const { recordHeartbeat } = await import("@/server/monitoring");
        await recordHeartbeat("mail-poll");
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
      async (job) => {
        if (job.name === "retention") {
          const days = Number(process.env.RETENTION_ANONYMIZE_DAYS);
          if (days > 0) {
            const { enforceRetention } = await import("@/server/privacy");
            const count = await enforceRetention(days);
            if (count > 0) console.log(`[retention] ${count} alte Tickets geschwärzt (> ${days} Tage geschlossen)`);
          }
          return;
        }
        const info = await createBackup();
        console.log(
          `[backup] ${info.fileName} erstellt (${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB)`
        );
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "sla-check",
      async (job) => {
        if (job.name === "monitor") {
          const { checkMailPollAndAlert } = await import("@/server/monitoring");
          await checkMailPollAndAlert();
          return;
        }
        const escalated = await checkSlaBreaches();
        if (escalated > 0) console.log(`[sla] ${escalated} Verletzung(en) eskaliert`);
      },
      { connection, concurrency: 1 }
    ),

    new Worker(
      "time-rules",
      async () => {
        const changed = await runTimeBasedRules();
        if (changed > 0) console.log(`[automation] ${changed} Ticket(s) durch Zeitregeln geändert`);
      },
      { connection, concurrency: 1 }
    ),

    new Worker<{ webhookId: string; body: string }>(
      "webhook",
      async (job) => {
        await deliverWebhook(job.data.webhookId, job.data.body);
      },
      { connection, concurrency: 4 }
    ),

    new Worker<{ ticketId: string }>(
      "ai-classify",
      async (job) => {
        const { classifyTicket, isAutoClassifyEnabled } = await import("@/server/ai");
        if (!isAutoClassifyEnabled()) return;
        await classifyTicket(job.data.ticketId);
      },
      { connection, concurrency: 2 }
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
