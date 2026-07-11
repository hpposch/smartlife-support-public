// SLA-Verwaltung: Richtlinien-Zuordnung, Fristenberechnung in Geschäftszeiten,
// Pausierung bei "Wartet auf Kunde", Erfüllt/Verletzt-Ereignisse und Eskalation.
import type { BusinessHours, SlaPolicy, Ticket, TicketStatus } from "@prisma/client";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
  type Schedule,
} from "@/lib/business-hours";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";

const PAUSED_STATUSES: TicketStatus[] = ["pending_customer", "resolved", "closed"];

export interface SlaTargets {
  firstResponseMin?: number;
  resolutionMin?: number;
}

export function calendarOf(businessHours: BusinessHours | null): BusinessCalendar {
  if (!businessHours) return { timezone: "UTC", schedule: null, holidays: [] };
  return {
    timezone: businessHours.timezone,
    schedule: businessHours.schedule as Schedule | null,
    holidays: businessHours.holidays,
  };
}

interface PolicyConditions {
  channels?: string[];
  categoryIds?: string[];
  organizationIds?: string[];
}

/** Prüft, ob eine Richtlinie auf das Ticket passt (leere Bedingung = passt). */
export function policyMatches(conditions: PolicyConditions, ticket: Ticket): boolean {
  if (conditions.channels?.length && !conditions.channels.includes(ticket.channel)) return false;
  if (
    conditions.categoryIds?.length &&
    (!ticket.categoryId || !conditions.categoryIds.includes(ticket.categoryId))
  ) {
    return false;
  }
  if (
    conditions.organizationIds?.length &&
    (!ticket.organizationId || !conditions.organizationIds.includes(ticket.organizationId))
  ) {
    return false;
  }
  return true;
}

export function targetsForPriority(policy: SlaPolicy, priority: string): SlaTargets {
  const all = policy.targets as Record<string, SlaTargets>;
  return all?.[priority] ?? {};
}

/**
 * Richtlinie zuordnen und Fristen ab `createdAt` berechnen. Wird nach der
 * Ticket-Erstellung (nach den Erstellungsregeln) und bei Prioritätswechsel
 * aufgerufen.
 */
export async function applySla(ticketId: string): Promise<void> {
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const policies = await db.slaPolicy.findMany({
    where: { isActive: true },
    include: { businessHours: true },
    orderBy: { position: "asc" },
  });

  const policy = policies.find((p) => policyMatches(p.conditions as PolicyConditions, ticket));
  if (!policy) {
    if (ticket.slaPolicyId) {
      await db.ticket.update({
        where: { id: ticketId },
        data: { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null },
      });
    }
    return;
  }

  const targets = targetsForPriority(policy, ticket.priority);
  const calendar = calendarOf(policy.businessHours);
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      slaPolicyId: policy.id,
      firstResponseDueAt:
        targets.firstResponseMin && !ticket.firstRepliedAt
          ? addBusinessMinutes(ticket.createdAt, targets.firstResponseMin, calendar)
          : ticket.firstRepliedAt
            ? ticket.firstResponseDueAt
            : null,
      resolutionDueAt: targets.resolutionMin
        ? addBusinessMinutes(ticket.createdAt, targets.resolutionMin, calendar)
        : null,
      slaPausedAt: PAUSED_STATUSES.includes(ticket.status) ? ticket.slaPausedAt ?? new Date() : null,
    },
  });
}

/**
 * Statuswechsel: SLA-Uhr pausieren (Wartet auf Kunde / gelöst / geschlossen)
 * bzw. fortsetzen — beim Fortsetzen werden die Fristen um die pausierte
 * Geschäftszeit nach hinten geschoben.
 */
export async function handleSlaStatusChange(
  ticketId: string,
  from: TicketStatus,
  to: TicketStatus
): Promise<void> {
  const wasPaused = PAUSED_STATUSES.includes(from);
  const isPaused = PAUSED_STATUSES.includes(to);
  if (wasPaused === isPaused) return;

  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { slaPolicy: { include: { businessHours: true } } },
  });
  if (!ticket.slaPolicyId) return;

  if (isPaused) {
    if (!ticket.slaPausedAt) {
      await db.ticket.update({ where: { id: ticketId }, data: { slaPausedAt: new Date() } });
    }
    return;
  }

  // Fortsetzen: Fristen um pausierte Geschäftszeit verschieben
  if (!ticket.slaPausedAt) return;
  const calendar = calendarOf(ticket.slaPolicy?.businessHours ?? null);
  const pausedMinutes = businessMinutesBetween(ticket.slaPausedAt, new Date(), calendar);
  const shift = (date: Date | null) =>
    date ? addBusinessMinutes(date, pausedMinutes, calendar) : null;
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      slaPausedAt: null,
      firstResponseDueAt:
        ticket.firstRepliedAt ? ticket.firstResponseDueAt : shift(ticket.firstResponseDueAt),
      resolutionDueAt: shift(ticket.resolutionDueAt),
    },
  });
}

/** Einmaliges SLA-Ereignis schreiben (unique je Ticket+Ziel). */
async function recordSlaEvent(
  ticketId: string,
  target: "first_response" | "resolution",
  outcome: "met" | "breached",
  dueAt: Date
): Promise<boolean> {
  try {
    await db.slaEvent.create({ data: { ticketId, target, outcome, dueAt } });
    return true;
  } catch {
    return false; // bereits erfasst
  }
}

/** Bei der ersten Agentenantwort: Erstreaktions-Ziel bewerten. */
export async function recordFirstResponse(ticketId: string): Promise<void> {
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!ticket.firstResponseDueAt) return;
  const outcome = new Date() <= ticket.firstResponseDueAt ? "met" : "breached";
  await recordSlaEvent(ticketId, "first_response", outcome, ticket.firstResponseDueAt);
}

/** Beim Lösen: Lösungs-Ziel bewerten. */
export async function recordResolution(ticketId: string): Promise<void> {
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!ticket.resolutionDueAt) return;
  const outcome = new Date() <= ticket.resolutionDueAt ? "met" : "breached";
  await recordSlaEvent(ticketId, "resolution", outcome, ticket.resolutionDueAt);
}

/**
 * Eskalations-Lauf (Worker, alle 5 min): überfällige Ziele als verletzt
 * markieren, System-Notiz anhängen und den zuständigen Agenten informieren.
 */
export async function checkSlaBreaches(): Promise<number> {
  const now = new Date();
  let escalated = 0;

  const candidates = await db.ticket.findMany({
    where: {
      slaPolicyId: { not: null },
      slaPausedAt: null,
      status: { in: ["new", "open", "pending_internal"] },
      OR: [
        { firstResponseDueAt: { lt: now }, firstRepliedAt: null },
        { resolutionDueAt: { lt: now }, resolvedAt: null },
      ],
    },
    include: { slaEvents: true },
    take: 200,
  });

  for (const ticket of candidates) {
    const targets: ("first_response" | "resolution")[] = [];
    if (
      ticket.firstResponseDueAt &&
      ticket.firstResponseDueAt < now &&
      !ticket.firstRepliedAt &&
      !ticket.slaEvents.some((e) => e.target === "first_response")
    ) {
      targets.push("first_response");
    }
    if (
      ticket.resolutionDueAt &&
      ticket.resolutionDueAt < now &&
      !ticket.resolvedAt &&
      !ticket.slaEvents.some((e) => e.target === "resolution")
    ) {
      targets.push("resolution");
    }

    for (const target of targets) {
      const dueAt = target === "first_response" ? ticket.firstResponseDueAt! : ticket.resolutionDueAt!;
      const created = await recordSlaEvent(ticket.id, target, "breached", dueAt);
      if (!created) continue;
      escalated++;
      const label = target === "first_response" ? "Erstreaktion" : "Lösung";
      await db.message.create({
        data: {
          ticketId: ticket.id,
          type: "system",
          bodyText: `SLA-Verletzung: Ziel „${label}“ war fällig am ${dueAt.toISOString()}.`,
        },
      });
      await queues().notify.add("sla_breach", {
        kind: "sla_breach",
        ticketId: ticket.id,
        target,
      });
    }
  }
  return escalated;
}
