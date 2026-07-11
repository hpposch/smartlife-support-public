import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIORITY_LABELS } from "@/lib/labels";
import type { CreationActions, CreationConditions, TimeActions, TimeConditions } from "@/server/automation";

async function createCreationRule(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const conditions: CreationConditions = {};
  const channel = String(formData.get("channel") ?? "");
  if (channel) conditions.channels = [channel];
  const subjectContains = String(formData.get("subjectContains") ?? "").trim();
  if (subjectContains) conditions.subjectContains = subjectContains;

  const actions: CreationActions = {};
  const setPriority = String(formData.get("setPriority") ?? "");
  if (setPriority) actions.setPriority = setPriority as CreationActions["setPriority"];
  const setCategoryId = String(formData.get("setCategoryId") ?? "");
  if (setCategoryId) actions.setCategoryId = setCategoryId;
  const setTeamId = String(formData.get("setTeamId") ?? "");
  if (setTeamId) actions.setTeamId = setTeamId;
  const assign = String(formData.get("assign") ?? "");
  if (assign) actions.assign = assign;
  const tags = String(formData.get("addTags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length) actions.addTags = tags;

  const max = await db.automationRule.aggregate({ _max: { position: true } });
  await db.automationRule.create({
    data: {
      name,
      trigger: "ticket_created",
      conditions: conditions as object,
      actions: actions as object,
      position: (max._max.position ?? 0) + 1,
    },
  });
  revalidatePath("/settings/automation");
}

async function createTimeRule(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const olderThanHours = Number(formData.get("olderThanHours"));
  if (!name || !olderThanHours || olderThanHours <= 0) return;

  const conditions: TimeConditions = {
    status: formData.get("status") === "pending_customer" ? "pending_customer" : "resolved",
    olderThanHours,
  };
  const actions: TimeActions = {
    setStatus: "closed",
    noteText: String(formData.get("noteText") ?? "").trim() || undefined,
  };

  const max = await db.automationRule.aggregate({ _max: { position: true } });
  await db.automationRule.create({
    data: {
      name,
      trigger: "time_based",
      conditions: conditions as unknown as object,
      actions: actions as object,
      position: (max._max.position ?? 0) + 1,
    },
  });
  revalidatePath("/settings/automation");
}

async function toggleRule(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const rule = await db.automationRule.findUniqueOrThrow({ where: { id } });
  await db.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
  revalidatePath("/settings/automation");
}

async function deleteRule(formData: FormData) {
  "use server";
  await requireAdmin();
  await db.automationRule.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/settings/automation");
}

export default async function AutomationPage() {
  await requireAdmin();
  const [rules, categories, teams, users] = await Promise.all([
    db.automationRule.findMany({ orderBy: { position: "asc" } }),
    db.ticketCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.team.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Automatisierung</h1>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Regeln</h2>
        {rules.length === 0 && <p className="text-sm text-slate-400">Noch keine Regeln.</p>}
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{rule.name}</span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {rule.trigger === "ticket_created" ? "bei Erstellung" : "zeitgesteuert"}
                </span>
                {!rule.isActive && <span className="ml-2 text-xs text-slate-400">(inaktiv)</span>}
                <div className="mt-1 font-mono text-xs text-slate-400">
                  wenn {JSON.stringify(rule.conditions)} → {JSON.stringify(rule.actions)}
                </div>
              </div>
              <div className="flex shrink-0 gap-3">
                <form action={toggleRule}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button type="submit" className="text-xs text-blue-700 hover:underline">
                    {rule.isActive ? "Deaktivieren" : "Aktivieren"}
                  </button>
                </form>
                <form action={deleteRule}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button type="submit" className="text-xs text-red-600 hover:underline">
                    Löschen
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <form
        action={createCreationRule}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neue Erstellungsregel</h2>
        <p className="text-xs text-slate-500">
          Läuft bei jedem neuen Ticket. Leere Bedingungen passen immer.
        </p>
        <input name="name" required placeholder="Name (z. B. Rechnungsanfragen → Billing)" className="input" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-500">
            Wenn Kanal
            <select name="channel" defaultValue="" className="input mt-1">
              <option value="">— egal —</option>
              <option value="email">E-Mail</option>
              <option value="portal">Portal</option>
              <option value="api">API</option>
              <option value="manual">Manuell</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Wenn Betreff enthält
            <input name="subjectContains" placeholder="z. B. Rechnung" className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dann Priorität setzen
            <select name="setPriority" defaultValue="" className="input mt-1">
              <option value="">— nicht ändern —</option>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dann Kategorie setzen
            <select name="setCategoryId" defaultValue="" className="input mt-1">
              <option value="">— nicht ändern —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dann Team setzen
            <select name="setTeamId" defaultValue="" className="input mt-1">
              <option value="">— nicht ändern —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dann zuweisen
            <select name="assign" defaultValue="" className="input mt-1">
              <option value="">— nicht zuweisen —</option>
              <option value="round_robin">Automatisch verteilen (wenigste offene Tickets)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500 sm:col-span-2">
            Dann Tags hinzufügen (Komma-getrennt)
            <input name="addTags" placeholder="z. B. abrechnung, wichtig" className="input mt-1" />
          </label>
        </div>
        <button type="submit" className="btn-primary">
          Regel anlegen
        </button>
      </form>

      <form
        action={createTimeRule}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neue Zeitregel</h2>
        <p className="text-xs text-slate-500">
          Läuft alle 15 Minuten — z. B. „Gelöst + 5 Tage ohne Antwort → schließen“.
        </p>
        <input name="name" required placeholder="Name (z. B. Auto-Schließen)" className="input" />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-500">
            Wenn Status
            <select name="status" defaultValue="resolved" className="input mt-1">
              <option value="resolved">Gelöst</option>
              <option value="pending_customer">Wartet auf Kunde</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-500">
            unverändert seit (Stunden)
            <input name="olderThanHours" type="number" min="1" defaultValue={120} required className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Dann Status
            <input value="Geschlossen" disabled className="input mt-1 bg-slate-50" />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          System-Notiz (optional)
          <input
            name="noteText"
            placeholder="z. B. Automatisch geschlossen nach 5 Tagen ohne Rückmeldung."
            className="input mt-1"
          />
        </label>
        <button type="submit" className="btn-primary">
          Regel anlegen
        </button>
      </form>
    </div>
  );
}
