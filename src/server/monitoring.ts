// Betriebs-Monitoring: Heartbeats von Worker und Postfach-Abruf in Redis,
// Auswertung im Healthcheck und Alert-Mail bei stehendem Mail-Abruf.
//
// Konfiguration (.env):
//   ALERT_EMAIL  Empfänger für Betriebs-Alerts (leer = keine Alert-Mails)
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";

export async function recordHeartbeat(name: string): Promise<void> {
  await queues().connection.set(`heartbeat:${name}`, String(Date.now()), "EX", 3600);
}

/** Alter des letzten Heartbeats in Millisekunden (null = nie gesehen). */
export async function heartbeatAge(name: string): Promise<number | null> {
  const value = await queues().connection.get(`heartbeat:${name}`);
  if (!value) return null;
  return Date.now() - Number(value);
}

/**
 * Alert, wenn der Postfach-Abruf steht (Heartbeat älter als 3 Abruf-Intervalle,
 * mindestens 5 Minuten). Gedrosselt auf eine Mail pro 6 Stunden.
 */
export async function checkMailPollAndAlert(): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail) return;
  const activeMailboxes = await db.mailbox.count({ where: { isActive: true } });
  if (activeMailboxes === 0) return;

  const pollInterval = Number(process.env.MAIL_POLL_INTERVAL_MS ?? 60_000);
  const threshold = Math.max(3 * pollInterval, 5 * 60_000);
  const age = await heartbeatAge("mail-poll");
  if (age !== null && age < threshold) return;

  const redis = queues().connection;
  const throttleKey = "alert:mail-poll";
  const throttled = await redis.set(throttleKey, "1", "EX", 6 * 3600, "NX");
  if (throttled !== "OK") return;

  const mailbox = await db.mailbox.findFirst({ where: { isActive: true } });
  if (!mailbox) return;
  const { smtpTransport } = await import("@/mail/mailer");
  const minutes = age === null ? "unbekannt (nie gelaufen)" : `${Math.round(age / 60_000)} min`;
  try {
    await smtpTransport(mailbox).sendMail({
      from: { name: "SmartLife Support Monitoring", address: mailbox.address },
      to: alertEmail,
      subject: "⚠ Support-System: Postfach-Abruf steht",
      text: `Der IMAP-Abruf ist seit ${minutes} nicht mehr gelaufen (Schwelle: ${Math.round(threshold / 60_000)} min).\n\nBitte Worker-Prozess und Postfach-Zugangsdaten prüfen. Details: /api/health`,
    });
    console.warn(`[monitor] Alert versendet: Mail-Abruf steht seit ${minutes}`);
  } catch (error) {
    console.error("[monitor] Alert-Versand fehlgeschlagen:", error);
  }
}
