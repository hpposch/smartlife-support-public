import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Schedule, WeekdayKey } from "@/lib/business-hours";

const DAYS: { key: WeekdayKey; label: string }[] = [
  { key: "mon", label: "Montag" },
  { key: "tue", label: "Dienstag" },
  { key: "wed", label: "Mittwoch" },
  { key: "thu", label: "Donnerstag" },
  { key: "fri", label: "Freitag" },
  { key: "sat", label: "Samstag" },
  { key: "sun", label: "Sonntag" },
];

const PRIORITIES = [
  { key: "urgent", label: "Dringend" },
  { key: "high", label: "Hoch" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Niedrig" },
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function saveBusinessHours(formData: FormData) {
  "use server";
  await requireAdmin();
  const schedule: Schedule = {};
  for (const day of DAYS) {
    if (!formData.get(`${day.key}_active`)) continue;
    const from = String(formData.get(`${day.key}_from`) ?? "");
    const to = String(formData.get(`${day.key}_to`) ?? "");
    if (HHMM.test(from) && HHMM.test(to) && from < to) {
      schedule[day.key] = [[from, to]];
    }
  }
  const holidays = String(formData.get("holidays") ?? "")
    .split(/\s+/)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const timezone = String(formData.get("timezone") ?? "Europe/Vienna");

  const existing = await db.businessHours.findFirst();
  if (existing) {
    await db.businessHours.update({
      where: { id: existing.id },
      data: { schedule, holidays, timezone },
    });
  } else {
    await db.businessHours.create({
      data: { name: "Standard", schedule, holidays, timezone },
    });
  }
  revalidatePath("/settings/sla");
}

const policySchema = z.object({
  name: z.string().min(1),
  useBusinessHours: z.string().optional(),
});

async function createPolicy(formData: FormData) {
  "use server";
  await requireAdmin();
  const input = policySchema.parse({
    name: formData.get("name"),
    useBusinessHours: formData.get("useBusinessHours") ?? undefined,
  });

  const targets: Record<string, { firstResponseMin?: number; resolutionMin?: number }> = {};
  for (const priority of PRIORITIES) {
    const fr = Number(formData.get(`${priority.key}_first`));
    const res = Number(formData.get(`${priority.key}_resolution`));
    const entry: { firstResponseMin?: number; resolutionMin?: number } = {};
    if (fr > 0) entry.firstResponseMin = Math.round(fr * 60);
    if (res > 0) entry.resolutionMin = Math.round(res * 60);
    if (Object.keys(entry).length > 0) targets[priority.key] = entry;
  }

  const businessHours = input.useBusinessHours ? await db.businessHours.findFirst() : null;
  const max = await db.slaPolicy.aggregate({ _max: { position: true } });
  await db.slaPolicy.create({
    data: {
      name: input.name,
      targets,
      businessHoursId: businessHours?.id ?? null,
      position: (max._max.position ?? 0) + 1,
    },
  });
  revalidatePath("/settings/sla");
}

async function togglePolicy(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const policy = await db.slaPolicy.findUniqueOrThrow({ where: { id } });
  await db.slaPolicy.update({ where: { id }, data: { isActive: !policy.isActive } });
  revalidatePath("/settings/sla");
}

function minutesToHours(min?: number): string {
  return min ? `${(min / 60).toLocaleString("de-AT")} h` : "—";
}

export default async function SlaSettingsPage() {
  await requireAdmin();
  const [businessHours, policies] = await Promise.all([
    db.businessHours.findFirst(),
    db.slaPolicy.findMany({ orderBy: { position: "asc" }, include: { businessHours: true } }),
  ]);
  const schedule = (businessHours?.schedule ?? {}) as Schedule;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">SLA & Geschäftszeiten</h1>

      <form
        action={saveBusinessHours}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Geschäftszeiten</h2>
        <p className="text-xs text-slate-500">
          SLA-Fristen laufen nur innerhalb dieser Zeiten. Feiertage werden übersprungen.
        </p>
        <div className="space-y-1.5">
          {DAYS.map((day) => {
            const range = schedule[day.key]?.[0];
            return (
              <div key={day.key} className="flex items-center gap-3 text-sm">
                <label className="flex w-32 items-center gap-2">
                  <input type="checkbox" name={`${day.key}_active`} defaultChecked={!!range} />
                  {day.label}
                </label>
                <input
                  type="time"
                  name={`${day.key}_from`}
                  defaultValue={range?.[0] ?? "09:00"}
                  className="input w-auto"
                />
                <span className="text-slate-400">bis</span>
                <input
                  type="time"
                  name={`${day.key}_to`}
                  defaultValue={range?.[1] ?? "17:00"}
                  className="input w-auto"
                />
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-500">
            Zeitzone
            <input
              name="timezone"
              defaultValue={businessHours?.timezone ?? "Europe/Vienna"}
              className="input mt-1"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Feiertage (YYYY-MM-DD, ein Datum pro Zeile)
            <textarea
              name="holidays"
              rows={3}
              defaultValue={(businessHours?.holidays ?? []).join("\n")}
              className="input mt-1 font-mono text-xs"
            />
          </label>
        </div>
        <button type="submit" className="btn-primary">
          Geschäftszeiten speichern
        </button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">SLA-Richtlinien</h2>
        {policies.length === 0 ? (
          <p className="text-sm text-slate-400">
            Noch keine Richtlinie — ohne Richtlinie werden keine Fristen berechnet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Erstreaktion (D/H/N/L)</th>
                <th className="py-2 pr-4">Lösung (D/H/N/L)</th>
                <th className="py-2 pr-4">Geschäftszeiten</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => {
                const targets = policy.targets as Record<
                  string,
                  { firstResponseMin?: number; resolutionMin?: number }
                >;
                const cell = (kind: "firstResponseMin" | "resolutionMin") =>
                  ["urgent", "high", "normal", "low"]
                    .map((p) => minutesToHours(targets[p]?.[kind]))
                    .join(" / ");
                return (
                  <tr key={policy.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {policy.name}
                      {!policy.isActive && <span className="ml-2 text-xs text-slate-400">(inaktiv)</span>}
                    </td>
                    <td className="py-2 pr-4 text-slate-600">{cell("firstResponseMin")}</td>
                    <td className="py-2 pr-4 text-slate-600">{cell("resolutionMin")}</td>
                    <td className="py-2 pr-4 text-slate-600">{policy.businessHours ? "ja" : "24/7"}</td>
                    <td className="py-2 text-right">
                      <form action={togglePolicy}>
                        <input type="hidden" name="id" value={policy.id} />
                        <button type="submit" className="text-xs text-blue-700 hover:underline">
                          {policy.isActive ? "Deaktivieren" : "Aktivieren"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <form
        action={createPolicy}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neue SLA-Richtlinie</h2>
        <input name="name" required placeholder="Name (z. B. Standard-SLA)" className="input" />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 pr-4">Priorität</th>
              <th className="py-1 pr-4">Erstreaktion (Std.)</th>
              <th className="py-1">Lösung (Std.)</th>
            </tr>
          </thead>
          <tbody>
            {PRIORITIES.map((priority) => (
              <tr key={priority.key}>
                <td className="py-1 pr-4">{priority.label}</td>
                <td className="py-1 pr-4">
                  <input
                    name={`${priority.key}_first`}
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="z. B. 4"
                    className="input w-28"
                  />
                </td>
                <td className="py-1">
                  <input
                    name={`${priority.key}_resolution`}
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="z. B. 24"
                    className="input w-28"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="useBusinessHours" defaultChecked />
          Fristen nur innerhalb der Geschäftszeiten zählen
        </label>
        <p className="text-xs text-slate-400">
          Leere Felder = kein Ziel für diese Priorität. Die Richtlinie gilt für alle neuen Tickets;
          bei mehreren aktiven Richtlinien gewinnt die zuerst angelegte.
        </p>
        <button type="submit" className="btn-primary">
          Richtlinie anlegen
        </button>
      </form>
    </div>
  );
}
