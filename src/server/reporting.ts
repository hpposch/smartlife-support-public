// Kennzahlen für Berichte und CSV-Export. Zeitraum-basiert (from/to).
import { db } from "@/lib/db";

export interface ReportRange {
  from: Date;
  to: Date;
}

export async function overviewStats(range: ReportRange) {
  const createdWhere = { createdAt: { gte: range.from, lte: range.to } };

  const [created, resolved, openNow, firstResponses, resolutionTimes, slaEvents, csat] =
    await Promise.all([
      db.ticket.count({ where: createdWhere }),
      db.ticket.count({ where: { resolvedAt: { gte: range.from, lte: range.to } } }),
      db.ticket.count({ where: { status: { in: ["new", "open", "pending_internal", "pending_customer"] } } }),
      db.ticket.findMany({
        where: { ...createdWhere, firstRepliedAt: { not: null } },
        select: { createdAt: true, firstRepliedAt: true },
      }),
      db.ticket.findMany({
        where: { ...createdWhere, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
      db.slaEvent.groupBy({
        by: ["target", "outcome"],
        where: { occurredAt: { gte: range.from, lte: range.to } },
        _count: true,
      }),
      db.csatSurvey.aggregate({
        where: { answeredAt: { gte: range.from, lte: range.to }, rating: { not: null } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

  const avgHours = (pairs: { a: Date; b: Date }[]) =>
    pairs.length === 0
      ? null
      : pairs.reduce((sum, p) => sum + (p.b.getTime() - p.a.getTime()), 0) /
        pairs.length /
        3_600_000;

  const sla = { firstResponse: { met: 0, breached: 0 }, resolution: { met: 0, breached: 0 } };
  for (const event of slaEvents) {
    const bucket = event.target === "first_response" ? sla.firstResponse : sla.resolution;
    if (event.outcome === "met") bucket.met = event._count;
    else bucket.breached = event._count;
  }

  return {
    created,
    resolved,
    openNow,
    avgFirstResponseHours: avgHours(
      firstResponses.map((t) => ({ a: t.createdAt, b: t.firstRepliedAt! }))
    ),
    avgResolutionHours: avgHours(resolutionTimes.map((t) => ({ a: t.createdAt, b: t.resolvedAt! }))),
    sla,
    csatAvg: csat._avg.rating,
    csatCount: csat._count.rating,
  };
}

export async function ticketsPerDay(range: ReportRange) {
  const rows = await db.$queryRaw<{ day: Date; created: bigint; resolved: bigint }[]>`
    SELECT d.day,
           (SELECT count(*) FROM tickets t WHERE t.created_at >= d.day AND t.created_at < d.day + interval '1 day') AS created,
           (SELECT count(*) FROM tickets t WHERE t.resolved_at >= d.day AND t.resolved_at < d.day + interval '1 day') AS resolved
    FROM generate_series(date_trunc('day', ${range.from}::timestamptz),
                         date_trunc('day', ${range.to}::timestamptz),
                         interval '1 day') AS d(day)
    ORDER BY d.day`;
  return rows.map((r) => ({
    day: r.day,
    created: Number(r.created),
    resolved: Number(r.resolved),
  }));
}

export async function byCategory(range: ReportRange) {
  const groups = await db.ticket.groupBy({
    by: ["categoryId"],
    where: { createdAt: { gte: range.from, lte: range.to } },
    _count: true,
  });
  const categories = await db.ticketCategory.findMany();
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  return groups
    .map((g) => ({
      category: g.categoryId ? (nameOf.get(g.categoryId) ?? "?") : "(keine)",
      count: g._count,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function byAgent(range: ReportRange) {
  const groups = await db.ticket.groupBy({
    by: ["assigneeId"],
    where: { resolvedAt: { gte: range.from, lte: range.to }, assigneeId: { not: null } },
    _count: true,
  });
  const users = await db.user.findMany();
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return groups
    .map((g) => ({ agent: nameOf.get(g.assigneeId!) ?? "?", resolved: g._count }))
    .sort((a, b) => b.resolved - a.resolved);
}

/** Wissensdatenbank-Auswertung: Feedback je Artikel und Suchen ohne Treffer. */
export async function kbStats(range: ReportRange) {
  const feedback = await db.kbFeedback.groupBy({
    by: ["articleId", "helpful"],
    where: { createdAt: { gte: range.from, lte: range.to } },
    _count: true,
  });
  const byArticle = new Map<string, { up: number; down: number }>();
  for (const row of feedback) {
    const entry = byArticle.get(row.articleId) ?? { up: 0, down: 0 };
    if (row.helpful) entry.up += row._count;
    else entry.down += row._count;
    byArticle.set(row.articleId, entry);
  }
  const articles = await db.kbArticle.findMany({
    where: { id: { in: [...byArticle.keys()] } },
    select: { id: true, title: true, slug: true },
  });
  const rated = articles
    .map((a) => ({ ...a, ...byArticle.get(a.id)! }))
    .sort((a, b) => b.down - a.down || a.up - b.up)
    .slice(0, 10);

  // Häufigste Suchen ohne Treffer (Doku-Lücken)
  const missed = await db.kbSearchQuery.groupBy({
    by: ["query"],
    where: { createdAt: { gte: range.from, lte: range.to }, results: 0 },
    _count: true,
    orderBy: { _count: { query: "desc" } },
    take: 10,
  });

  return {
    rated,
    missedSearches: missed.map((m) => ({ query: m.query, count: m._count })),
  };
}

// --------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",;\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\n");
}

export async function ticketsCsv(range: ReportRange): Promise<string> {
  const tickets = await db.ticket.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    include: { contact: true, assignee: true, category: true, slaEvents: true },
    orderBy: { number: "asc" },
  });
  return toCsv(
    [
      "Nummer", "Betreff", "Status", "Priorität", "Kanal", "Kategorie", "Kunde",
      "Zugewiesen", "Erstellt", "Erste Antwort", "Gelöst", "SLA Erstreaktion", "SLA Lösung",
    ],
    tickets.map((t) => [
      t.number,
      t.subject,
      t.status,
      t.priority,
      t.channel,
      t.category?.name ?? "",
      t.contact.email,
      t.assignee?.name ?? "",
      t.createdAt.toISOString(),
      t.firstRepliedAt?.toISOString() ?? "",
      t.resolvedAt?.toISOString() ?? "",
      t.slaEvents.find((e) => e.target === "first_response")?.outcome ?? "",
      t.slaEvents.find((e) => e.target === "resolution")?.outcome ?? "",
    ])
  );
}
