// Regel-Engine: Erstellungsregeln (bei Ticketeingang) und zeitgesteuerte
// Regeln (z. B. Auto-Schließen gelöster Tickets). Bedingungen und Aktionen
// sind strukturierte JSON-Objekte, gepflegt über Verwaltung → Automatisierung.
import type { Prisma, Ticket } from "@prisma/client";
import { db } from "@/lib/db";

export interface CreationConditions {
  channels?: string[];
  priorities?: string[];
  categoryIds?: string[];
  subjectContains?: string;
}

export interface CreationActions {
  setPriority?: "low" | "normal" | "high" | "urgent";
  setCategoryId?: string;
  setTeamId?: string;
  /** konkrete User-ID oder "round_robin" (Team-Mitglied mit wenigsten offenen Tickets) */
  assign?: string;
  addTags?: string[];
}

export interface TimeConditions {
  status: "resolved" | "pending_customer";
  olderThanHours: number;
}

export interface TimeActions {
  setStatus?: "closed";
  noteText?: string;
}

export function creationRuleMatches(conditions: CreationConditions, ticket: Ticket): boolean {
  if (conditions.channels?.length && !conditions.channels.includes(ticket.channel)) return false;
  if (conditions.priorities?.length && !conditions.priorities.includes(ticket.priority)) {
    return false;
  }
  if (
    conditions.categoryIds?.length &&
    (!ticket.categoryId || !conditions.categoryIds.includes(ticket.categoryId))
  ) {
    return false;
  }
  if (
    conditions.subjectContains &&
    !ticket.subject.toLowerCase().includes(conditions.subjectContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** Team-Mitglied mit den wenigsten offenen zugewiesenen Tickets. */
async function pickRoundRobin(teamId: string | null): Promise<string | null> {
  const members = await db.teamMember.findMany({
    where: teamId ? { teamId } : {},
    include: { user: true },
  });
  const active = members.filter((m) => m.user.isActive);
  if (active.length === 0) return null;

  const counts = await db.ticket.groupBy({
    by: ["assigneeId"],
    where: {
      assigneeId: { in: active.map((m) => m.userId) },
      status: { in: ["new", "open", "pending_internal"] },
    },
    _count: true,
  });
  const countOf = new Map(counts.map((c) => [c.assigneeId, c._count]));
  active.sort((a, b) => (countOf.get(a.userId) ?? 0) - (countOf.get(b.userId) ?? 0));
  return active[0].userId;
}

/**
 * Erstellungsregeln auf ein neues Ticket anwenden (nach Anlage der ersten
 * Nachricht, vor der SLA-Zuordnung). Regeln laufen in Positions-Reihenfolge;
 * spätere Regeln können frühere überschreiben.
 */
export async function runCreationRules(ticketId: string): Promise<void> {
  const rules = await db.automationRule.findMany({
    where: { trigger: "ticket_created", isActive: true },
    orderBy: { position: "asc" },
  });
  if (rules.length === 0) return;

  for (const rule of rules) {
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    if (!creationRuleMatches(rule.conditions as CreationConditions, ticket)) continue;

    const actions = rule.actions as CreationActions;
    const data: Prisma.TicketUncheckedUpdateInput = {};
    if (actions.setPriority) data.priority = actions.setPriority;
    if (actions.setCategoryId) data.categoryId = actions.setCategoryId;
    if (actions.setTeamId) data.teamId = actions.setTeamId;
    if (actions.assign) {
      data.assigneeId =
        actions.assign === "round_robin"
          ? await pickRoundRobin(actions.setTeamId ?? ticket.teamId)
          : actions.assign;
    }

    if (Object.keys(data).length > 0) {
      await db.ticket.update({ where: { id: ticketId }, data });
    }
    if (actions.addTags?.length) {
      for (const name of actions.addTags) {
        const tag = await db.tag.upsert({
          where: { name: name.toLowerCase() },
          update: {},
          create: { name: name.toLowerCase() },
        });
        await db.ticketTag.upsert({
          where: { ticketId_tagId: { ticketId, tagId: tag.id } },
          update: {},
          create: { ticketId, tagId: tag.id },
        });
      }
    }
    await db.ticketEvent.create({
      data: {
        ticketId,
        eventType: "automation_applied",
        payload: { rule: rule.name, actions: actions as Prisma.InputJsonValue },
      },
    });
  }
}

/**
 * Zeitgesteuerte Regeln (Worker, alle 15 min) — z. B. „Gelöst + 5 Tage ohne
 * Antwort → automatisch schließen“. Gibt die Zahl der geänderten Tickets zurück.
 */
export async function runTimeBasedRules(): Promise<number> {
  const { updateTicket } = await import("./tickets");
  const rules = await db.automationRule.findMany({
    where: { trigger: "time_based", isActive: true },
    orderBy: { position: "asc" },
  });

  let changed = 0;
  for (const rule of rules) {
    const conditions = rule.conditions as unknown as TimeConditions;
    const actions = rule.actions as TimeActions;
    if (!conditions.status || !conditions.olderThanHours || !actions.setStatus) continue;

    const cutoff = new Date(Date.now() - conditions.olderThanHours * 60 * 60 * 1000);
    const tickets = await db.ticket.findMany({
      where: { status: conditions.status, updatedAt: { lt: cutoff } },
      take: 100,
    });

    for (const ticket of tickets) {
      if (actions.noteText) {
        await db.message.create({
          data: { ticketId: ticket.id, type: "system", bodyText: actions.noteText },
        });
      }
      await updateTicket(ticket.id, { status: actions.setStatus }, {});
      await db.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: "automation_applied",
          payload: { rule: rule.name, actions: actions as unknown as Prisma.InputJsonValue },
        },
      });
      changed++;
    }
  }
  return changed;
}
