import type { TicketPriority, TicketStatus } from "@prisma/client";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Neu",
  open: "Offen",
  pending_customer: "Wartet auf Kunde",
  pending_internal: "Wartet intern",
  resolved: "Gelöst",
  closed: "Geschlossen",
};

export const STATUS_COLORS: Record<TicketStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  open: "bg-emerald-100 text-emerald-800",
  pending_customer: "bg-amber-100 text-amber-800",
  pending_internal: "bg-violet-100 text-violet-800",
  resolved: "bg-slate-200 text-slate-700",
  closed: "bg-slate-100 text-slate-500",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
};

export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  low: "text-slate-500",
  normal: "text-slate-700",
  high: "text-orange-600",
  urgent: "text-red-600",
};

export const ROLE_LABELS = {
  agent: "Agent",
  team_lead: "Teamleitung",
  admin: "Admin",
} as const;

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `vor ${days} T`;
  return formatDateTime(date);
}
