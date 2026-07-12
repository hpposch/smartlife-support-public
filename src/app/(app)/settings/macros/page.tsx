// Makros: eine vordefinierte Antwort + Eigenschaftsänderungen, die Agenten
// im Ticket mit einem Klick anwenden (z. B. „Gelöst + Abschlusstext + Tag“).
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/labels";

async function createMacro(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.macro.create({
    data: {
      name,
      body: String(formData.get("body") ?? "").trim() || null,
      setStatus: String(formData.get("setStatus") ?? "") || null,
      setPriority: String(formData.get("setPriority") ?? "") || null,
      addTags: String(formData.get("addTags") ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    },
  });
  revalidatePath("/settings/macros");
}

async function toggleMacro(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const macro = await db.macro.findUniqueOrThrow({ where: { id } });
  await db.macro.update({ where: { id }, data: { isActive: !macro.isActive } });
  revalidatePath("/settings/macros");
}

async function deleteMacro(formData: FormData) {
  "use server";
  await requireAdmin();
  await db.macro.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/settings/macros");
}

export default async function MacrosPage() {
  await requireAdmin();
  const macros = await db.macro.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Makros</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ein Klick im Ticket: sendet optional eine Antwort (Platzhalter{" "}
          <code>{"{{contact.name}}"}</code>, <code>{"{{ticket.number}}"}</code>,{" "}
          <code>{"{{agent.name}}"}</code>) und setzt Status, Priorität und Tags.
        </p>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
        {macros.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-400">Noch keine Makros.</li>
        )}
        {macros.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <div className="min-w-0">
              <span className={m.isActive ? "font-medium" : "text-slate-400 line-through"}>
                {m.name}
              </span>
              <span className="ml-2 text-xs text-slate-400">
                {[
                  m.body ? "Antwort" : null,
                  m.setStatus ? `→ ${STATUS_LABELS[m.setStatus as keyof typeof STATUS_LABELS] ?? m.setStatus}` : null,
                  m.setPriority ? `Prio ${PRIORITY_LABELS[m.setPriority as keyof typeof PRIORITY_LABELS] ?? m.setPriority}` : null,
                  m.addTags.length ? `+${m.addTags.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <span className="flex shrink-0 gap-3 text-xs">
              <form action={toggleMacro}>
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" className="text-blue-700 hover:underline">
                  {m.isActive ? "Deaktivieren" : "Aktivieren"}
                </button>
              </form>
              <form action={deleteMacro}>
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" className="text-red-600 hover:underline">
                  Löschen
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>

      <form
        action={createMacro}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neues Makro</h2>
        <input name="name" required placeholder="Name, z. B. „Gelöst + Abschluss“" className="input" />
        <textarea
          name="body"
          rows={4}
          placeholder={"Optionaler Antworttext an den Kunden …\nHallo {{contact.name}}, …"}
          className="input"
        />
        <div className="grid grid-cols-3 gap-3">
          <select name="setStatus" defaultValue="" className="input">
            <option value="">Status unverändert</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                → {label}
              </option>
            ))}
          </select>
          <select name="setPriority" defaultValue="" className="input">
            <option value="">Priorität unverändert</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="addTags" placeholder="Tags (Komma-getrennt)" className="input" />
        </div>
        <button type="submit" className="btn-primary">
          Anlegen
        </button>
      </form>
    </div>
  );
}
