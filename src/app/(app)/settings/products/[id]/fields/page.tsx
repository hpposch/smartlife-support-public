// Custom Fields eines Produkts: werden Kunden beim Erstellen einer Anfrage
// im Portal abgefragt (optional als Pflichtfeld) und am Ticket gespeichert.
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  select: "Auswahl",
  number: "Zahl",
};

async function createField(formData: FormData) {
  "use server";
  await requireAdmin();
  const productId = String(formData.get("productId"));
  const label = String(formData.get("label") ?? "").trim();
  const key = (String(formData.get("key") ?? "").trim() || label)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  const type = ["text", "select", "number"].includes(String(formData.get("type")))
    ? String(formData.get("type"))
    : "text";
  if (!label || !key) return;
  const max = await db.customField.aggregate({
    where: { productId },
    _max: { sortOrder: true },
  });
  await db.customField.upsert({
    where: { productId_key: { productId, key } },
    update: { label, type, isActive: true },
    create: {
      productId,
      key,
      label,
      type,
      required: formData.get("required") === "1",
      options:
        type === "select"
          ? String(formData.get("options") ?? "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  revalidatePath(`/settings/products/${productId}/fields`);
}

async function toggleField(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const field = await db.customField.findUniqueOrThrow({ where: { id } });
  await db.customField.update({ where: { id }, data: { isActive: !field.isActive } });
  revalidatePath(`/settings/products/${field.productId}/fields`);
}

async function toggleRequired(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const field = await db.customField.findUniqueOrThrow({ where: { id } });
  await db.customField.update({ where: { id }, data: { required: !field.required } });
  revalidatePath(`/settings/products/${field.productId}/fields`);
}

async function deleteField(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const field = await db.customField.delete({ where: { id } });
  revalidatePath(`/settings/products/${field.productId}/fields`);
}

export default async function ProductFieldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: { customFields: { orderBy: [{ sortOrder: "asc" }] } },
  });
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Felder: {product.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Diese Felder füllen Kunden beim Erstellen einer Anfrage im Portal aus (Pflichtfelder
          müssen ausgefüllt werden). Die Werte stehen am Ticket und in der API
          (<code>custom_fields</code>).
        </p>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
        {product.customFields.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-400">Noch keine Felder.</li>
        )}
        {product.customFields.map((field) => (
          <li key={field.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <div className="min-w-0">
              <span className={field.isActive ? "font-medium" : "text-slate-400 line-through"}>
                {field.label}
              </span>
              <span className="ml-2 text-xs text-slate-400">
                {field.key} · {TYPE_LABELS[field.type] ?? field.type}
                {field.type === "select" && ` (${field.options.join(" / ")})`}
                {field.required && " · Pflicht"}
              </span>
            </div>
            <span className="flex shrink-0 gap-3 text-xs">
              <form action={toggleRequired}>
                <input type="hidden" name="id" value={field.id} />
                <button type="submit" className="text-blue-700 hover:underline">
                  {field.required ? "Optional machen" : "Pflicht machen"}
                </button>
              </form>
              <form action={toggleField}>
                <input type="hidden" name="id" value={field.id} />
                <button type="submit" className="text-blue-700 hover:underline">
                  {field.isActive ? "Deaktivieren" : "Aktivieren"}
                </button>
              </form>
              <form action={deleteField}>
                <input type="hidden" name="id" value={field.id} />
                <button type="submit" className="text-red-600 hover:underline">
                  Löschen
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>

      <form
        action={createField}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="productId" value={product.id} />
        <h2 className="text-sm font-semibold">Neues Feld</h2>
        <div className="grid grid-cols-2 gap-3">
          <input name="label" required placeholder="Anzeigename, z. B. Produktversion" className="input" />
          <input name="key" placeholder="Schlüssel (optional, sonst aus Name)" className="input" />
          <select name="type" defaultValue="text" className="input">
            <option value="text">Text</option>
            <option value="select">Auswahl</option>
            <option value="number">Zahl</option>
          </select>
          <input name="options" placeholder="Auswahloptionen (Komma-getrennt)" className="input" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="required" value="1" /> Pflichtfeld
        </label>
        <button type="submit" className="btn-primary">
          Feld anlegen
        </button>
      </form>

      <Link href="/settings/products" className="text-sm text-blue-700 hover:underline">
        ← Zurück zu den Produkten
      </Link>
    </div>
  );
}
