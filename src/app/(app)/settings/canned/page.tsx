import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

async function createCanned(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return;
  await db.cannedResponse.create({ data: { title, body, createdBy: admin.id } });
  revalidatePath("/settings/canned");
}

async function deleteCanned(formData: FormData) {
  "use server";
  await requireAdmin();
  await db.cannedResponse.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/settings/canned");
}

export default async function CannedPage() {
  await requireAdmin();
  const canned = await db.cannedResponse.findMany({ orderBy: { title: "asc" } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Textbausteine</h1>
      <p className="text-sm text-slate-500">
        Verfügbare Platzhalter: <code>{"{{ticket.number}}"}</code>,{" "}
        <code>{"{{contact.name}}"}</code>, <code>{"{{agent.name}}"}</code>
      </p>

      <ul className="space-y-3">
        {canned.map((item) => (
          <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{item.title}</h2>
              <form action={deleteCanned}>
                <input type="hidden" name="id" value={item.id} />
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  Löschen
                </button>
              </form>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.body}</p>
          </li>
        ))}
      </ul>

      <form
        action={createCanned}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neuer Textbaustein</h2>
        <input name="title" required placeholder="Titel" className="input" />
        <textarea name="body" required rows={4} placeholder="Text …" className="input" />
        <button type="submit" className="btn-primary">
          Speichern
        </button>
      </form>
    </div>
  );
}
