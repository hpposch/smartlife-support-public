import type { Prisma, TicketChannel, TicketPriority, TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { generateTicketToken } from "@/lib/ticket-token";

interface Actor {
  userId?: string;
  contactId?: string;
}

interface CreateTicketInput {
  subject: string;
  channel: TicketChannel;
  contactId: string;
  priority?: TicketPriority;
  teamId?: string | null;
  mailboxId?: string | null;
  categoryId?: string | null;
  assigneeId?: string | null;
}

export async function createTicket(input: CreateTicketInput, actor: Actor) {
  const contact = await db.contact.findUniqueOrThrow({ where: { id: input.contactId } });

  const ticket = await db.ticket.create({
    data: {
      subject: input.subject.slice(0, 500) || "(kein Betreff)",
      token: generateTicketToken(),
      channel: input.channel,
      priority: input.priority ?? "normal",
      contactId: contact.id,
      organizationId: contact.organizationId,
      teamId: input.teamId ?? null,
      mailboxId: input.mailboxId ?? null,
      categoryId: input.categoryId ?? null,
      assigneeId: input.assigneeId ?? null,
    },
  });

  await db.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      eventType: "created",
      actorUserId: actor.userId,
      actorContactId: actor.contactId,
      payload: { channel: input.channel },
    },
  });

  return ticket;
}

export interface TicketUpdateInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  teamId?: string | null;
  categoryId?: string | null;
}

/**
 * Zentrale Änderungsfunktion: schreibt Audit-Events für jede geänderte
 * Eigenschaft und pflegt die Zeitstempel (resolved_at/closed_at).
 */
export async function updateTicket(ticketId: string, input: TicketUpdateInput, actor: Actor) {
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });

  const data: Prisma.TicketUpdateInput = {};
  const events: Prisma.TicketEventCreateManyInput[] = [];

  const track = (eventType: string, from: unknown, to: unknown) => {
    events.push({
      ticketId,
      eventType,
      actorUserId: actor.userId,
      actorContactId: actor.contactId,
      payload: { from: from ?? null, to: to ?? null } as Prisma.InputJsonValue,
    });
  };

  if (input.status !== undefined && input.status !== ticket.status) {
    data.status = input.status;
    track("status_changed", ticket.status, input.status);
    if (input.status === "resolved" && !ticket.resolvedAt) data.resolvedAt = new Date();
    if (input.status === "closed" && !ticket.closedAt) data.closedAt = new Date();
    if (input.status === "open" || input.status === "new") {
      data.resolvedAt = null;
      data.closedAt = null;
    }
  }
  if (input.priority !== undefined && input.priority !== ticket.priority) {
    data.priority = input.priority;
    track("priority_changed", ticket.priority, input.priority);
  }
  if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
    data.assignee = input.assigneeId
      ? { connect: { id: input.assigneeId } }
      : { disconnect: true };
    track("assigned", ticket.assigneeId, input.assigneeId);
  }
  if (input.teamId !== undefined && input.teamId !== ticket.teamId) {
    data.team = input.teamId ? { connect: { id: input.teamId } } : { disconnect: true };
    track("team_changed", ticket.teamId, input.teamId);
  }
  if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
    data.category = input.categoryId
      ? { connect: { id: input.categoryId } }
      : { disconnect: true };
    track("category_changed", ticket.categoryId, input.categoryId);
  }

  if (events.length === 0) return ticket;

  const [updated] = await db.$transaction([
    db.ticket.update({ where: { id: ticketId }, data }),
    db.ticketEvent.createMany({ data: events }),
  ]);

  // Phase 3: SLA-Uhr, SLA-Ereignisse, CSAT und Webhooks an Statuswechsel koppeln
  const { handleSlaStatusChange, recordResolution, applySla } = await import("./sla");
  const { emitWebhookEvent } = await import("./webhooks");
  if (input.status !== undefined && input.status !== ticket.status) {
    await handleSlaStatusChange(ticketId, ticket.status, input.status);
    if (input.status === "resolved") {
      await recordResolution(ticketId);
      await enqueueCsatSurvey(ticketId);
      await emitWebhookEvent("ticket.resolved", ticketId);
    }
    if (input.status === "closed") await emitWebhookEvent("ticket.closed", ticketId);
  }
  if (input.priority !== undefined && input.priority !== ticket.priority) {
    await applySla(ticketId); // Fristen an neue Priorität anpassen
  }

  return updated;
}

/**
 * Nach der Erstellung (erste Nachricht liegt vor): Erstellungsregeln,
 * SLA-Zuordnung und Webhook — in dieser Reihenfolge, damit Regeln Priorität/
 * Kategorie noch beeinflussen, bevor die Fristen berechnet werden.
 */
export async function finalizeNewTicket(ticketId: string): Promise<void> {
  const { runCreationRules } = await import("./automation");
  const { applySla } = await import("./sla");
  const { emitWebhookEvent } = await import("./webhooks");
  await runCreationRules(ticketId);
  await applySla(ticketId);
  await emitWebhookEvent("ticket.created", ticketId);
}

/** CSAT-Umfrage anlegen und versenden (einmal pro Ticket, nur wenn aktiviert). */
export async function enqueueCsatSurvey(ticketId: string): Promise<void> {
  if (process.env.CSAT_ENABLED !== "true") return;
  const existing = await db.csatSurvey.findUnique({ where: { ticketId } });
  if (existing) return;
  const { randomBytes } = await import("node:crypto");
  await db.csatSurvey.create({
    data: { ticketId, token: randomBytes(24).toString("base64url") },
  });
  await queues().notify.add("csat", { kind: "csat", ticketId });
}

export async function setTicketTags(ticketId: string, tagNames: string[], actor: Actor) {
  const names = [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const tags = await Promise.all(
    names.map((name) => db.tag.upsert({ where: { name }, update: {}, create: { name } }))
  );
  await db.$transaction([
    db.ticketTag.deleteMany({ where: { ticketId } }),
    db.ticketTag.createMany({
      data: tags.map((tag) => ({ ticketId, tagId: tag.id })),
      skipDuplicates: true,
    }),
    db.ticketEvent.create({
      data: {
        ticketId,
        eventType: "tags_changed",
        actorUserId: actor.userId,
        payload: { to: names },
      },
    }),
  ]);
}

/** Bestätigungs-Mail an den Kunden einreihen (nach Ticket-Erstellung per E-Mail/API). */
export async function enqueueTicketConfirmation(ticketId: string) {
  await queues().notify.add("ticket_confirmation", { kind: "ticket_confirmation", ticketId });
}
