// Ausgehende Webhooks: signierte POST-Requests an konfigurierte URLs bei
// Ticket-Ereignissen. Versand asynchron über die Queue (Retry mit Backoff);
// nach 20 Fehlversuchen in Folge wird der Hook deaktiviert.
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";

export type WebhookEvent = "ticket.created" | "ticket.replied" | "ticket.resolved" | "ticket.closed";

const DISABLE_AFTER_FAILURES = 20;

/** Ereignis an alle passenden aktiven Webhooks verteilen. */
export async function emitWebhookEvent(event: WebhookEvent, ticketId: string): Promise<void> {
  const hooks = await db.webhook.findMany({
    where: { isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (hooks.length === 0) return;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { contact: true, assignee: true, category: true },
  });
  if (!ticket) return;

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data: {
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      channel: ticket.channel,
      category: ticket.category?.name ?? null,
      assignee: ticket.assignee?.email ?? null,
      contact: { email: ticket.contact.email, name: ticket.contact.name },
      created_at: ticket.createdAt.toISOString(),
    },
  };

  for (const hook of hooks) {
    await queues().webhook.add(event, { webhookId: hook.id, body: JSON.stringify(payload) });
  }
}

/** Einen Webhook-Job zustellen (läuft im Worker). */
export async function deliverWebhook(webhookId: string, body: string): Promise<void> {
  const hook = await db.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.isActive) return;

  const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (hook.failureCount > 0) {
      await db.webhook.update({ where: { id: hook.id }, data: { failureCount: 0 } });
    }
  } catch (error) {
    const updated = await db.webhook.update({
      where: { id: hook.id },
      data: { failureCount: { increment: 1 } },
    });
    if (updated.failureCount >= DISABLE_AFTER_FAILURES) {
      await db.webhook.update({ where: { id: hook.id }, data: { isActive: false } });
    }
    throw error; // BullMQ-Retry
  }
}
