import { requireLead } from "@/lib/auth";
import { byAgent, byCategory, kbStats, overviewStats, ticketsPerDay } from "@/server/reporting";

function parseRange(params: { from?: string; to?: string }) {
  const to = params.to ? new Date(`${params.to}T23:59:59`) : new Date();
  const from = params.from
    ? new Date(`${params.from}T00:00:00`)
    : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function fmtHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} T`;
}

function slaRate(bucket: { met: number; breached: number }): string {
  const total = bucket.met + bucket.breached;
  if (total === 0) return "—";
  return `${Math.round((bucket.met / total) * 100)} % (${bucket.met}/${total})`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireLead();
  const params = await searchParams;
  const range = parseRange(params);
  const query = `from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}`;

  const [stats, perDay, categories, agents, kb] = await Promise.all([
    overviewStats(range),
    ticketsPerDay(range),
    byCategory(range),
    byAgent(range),
    kbStats(range),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Berichte</h1>
        <form method="GET" className="flex items-center gap-2 text-sm">
          <input
            type="date"
            name="from"
            defaultValue={range.from.toISOString().slice(0, 10)}
            className="input w-auto"
          />
          <span className="text-slate-400">bis</span>
          <input
            type="date"
            name="to"
            defaultValue={range.to.toISOString().slice(0, 10)}
            className="input w-auto"
          />
          <button type="submit" className="btn-secondary">
            Anwenden
          </button>
          <a href={`/reports/export?${query}`} className="btn-secondary">
            CSV-Export
          </a>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Erstellt" value={String(stats.created)} />
        <Stat label="Gelöst" value={String(stats.resolved)} />
        <Stat label="Aktuell offen" value={String(stats.openNow)} />
        <Stat label="Ø Erstreaktion" value={fmtHours(stats.avgFirstResponseHours)} />
        <Stat label="Ø Lösungszeit" value={fmtHours(stats.avgResolutionHours)} />
        <Stat label="SLA Erstreaktion" value={slaRate(stats.sla.firstResponse)} />
        <Stat label="SLA Lösung" value={slaRate(stats.sla.resolution)} />
        <Stat
          label="CSAT"
          value={stats.csatAvg ? `${stats.csatAvg.toFixed(1)} / 5 (${stats.csatCount})` : "—"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Nach Kategorie</h2>
          <table className="w-full text-sm">
            <tbody>
              {categories.map((row) => (
                <tr key={row.category} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5">{row.category}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400">Keine Tickets im Zeitraum.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Gelöste Tickets je Agent</h2>
          <table className="w-full text-sm">
            <tbody>
              {agents.map((row) => (
                <tr key={row.agent} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5">{row.agent}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.resolved}</td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400">Keine gelösten Tickets im Zeitraum.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Wissensdatenbank: Artikel-Feedback</h2>
          {kb.rated.length === 0 ? (
            <p className="text-sm text-slate-400">Noch kein Feedback im Zeitraum.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-1">Artikel</th>
                  <th className="py-1 text-right">👍</th>
                  <th className="py-1 text-right">👎</th>
                </tr>
              </thead>
              <tbody>
                {kb.rated.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="max-w-xs truncate py-1.5">
                      <a href={`/kb/${a.slug}`} target="_blank" className="hover:text-blue-700 hover:underline">
                        {a.title}
                      </a>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-600">{a.up}</td>
                    <td className="py-1.5 text-right tabular-nums text-red-600">{a.down}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Suchen ohne Treffer (Doku-Lücken)</h2>
          {kb.missedSearches.length === 0 ? (
            <p className="text-sm text-slate-400">Keine erfolglosen Suchen im Zeitraum.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {kb.missedSearches.map((m) => (
                <li key={m.query} className="flex justify-between border-t border-slate-100 py-1.5 first:border-0">
                  <span className="truncate">„{m.query}“</span>
                  <span className="tabular-nums text-slate-500">{m.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Verlauf (pro Tag)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-1.5 pr-4">Tag</th>
                <th className="py-1.5 pr-4 text-right">Erstellt</th>
                <th className="py-1.5 text-right">Gelöst</th>
              </tr>
            </thead>
            <tbody>
              {perDay.map((row) => (
                <tr key={row.day.toISOString()} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-4">
                    {row.day.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" })}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">{row.created || ""}</td>
                  <td className="py-1 text-right tabular-nums">{row.resolved || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
