import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

async function createCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const max = await db.ticketCategory.aggregate({ _max: { sortOrder: true } });
  await db.ticketCategory.upsert({
    where: { name },
    update: { isActive: true },
    create: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/settings/categories");
}

async function toggleCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const category = await db.ticketCategory.findUniqueOrThrow({ where: { id } });
  await db.ticketCategory.update({ where: { id }, data: { isActive: !category.isActive } });
  revalidatePath("/settings/categories");
}

export default async function CategoriesPage() {
  await requireAdmin();
  const categories = await db.ticketCategory.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">Ticket-Kategorien</h1>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
        {categories.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className={cat.isActive ? "" : "text-slate-400 line-through"}>{cat.name}</span>
            <form action={toggleCategory}>
              <input type="hidden" name="id" value={cat.id} />
              <button type="submit" className="text-xs text-blue-700 hover:underline">
                {cat.isActive ? "Deaktivieren" : "Aktivieren"}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createCategory} className="flex gap-2">
        <input name="name" required placeholder="Neue Kategorie" className="input" />
        <button type="submit" className="btn-primary shrink-0">
          Hinzufügen
        </button>
      </form>
    </div>
  );
}
