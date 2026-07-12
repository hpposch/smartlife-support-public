// Produkte (Mehrprodukt-Betrieb): Jedes Produkt hat ein eigenes Portal-Branding
// und optional eine eigene Domain. Tickets, Wissensdatenbank und Postfächer
// hängen an genau einem Produkt.
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { saveUploadedImage } from "@/lib/branding";
import { db } from "@/lib/db";
import { DEFAULT_ACCENT } from "@/lib/product";

function normalizedDomain(value: FormDataEntryValue | null): string | null {
  const domain = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return domain || null;
}

function normalizedUrl(value: FormDataEntryValue | null): string | null {
  const url = String(value ?? "").trim().replace(/\/$/, "");
  return url || null;
}

async function saveProduct(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const name = String(formData.get("name") ?? "").trim();
  if (!key || !name) return;

  const accentRaw = String(formData.get("accentColor") ?? "").trim().toLowerCase();
  const logoKey = await saveUploadedImage(formData.get("logo"), `logo-${key}`);
  const data = {
    key,
    name,
    domain: normalizedDomain(formData.get("domain")),
    portalUrl: normalizedUrl(formData.get("portalUrl")),
    // Standardfarbe nicht speichern — so greifen spätere Default-Anpassungen
    accentColor: /^#[0-9a-f]{6}$/.test(accentRaw) && accentRaw !== DEFAULT_ACCENT ? accentRaw : null,
    ...(logoKey ? { logoKey } : {}),
    ...(formData.get("removeLogo") === "1" ? { logoKey: null } : {}),
  };
  if (id) {
    await db.product.update({ where: { id }, data });
  } else {
    await db.product.create({ data });
  }
  revalidatePath("/settings/products");
  revalidatePath("/kb");
}

async function makeDefault(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await db.$transaction([
    db.product.updateMany({ data: { isDefault: false } }),
    db.product.update({ where: { id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/settings/products");
}

async function deleteProduct(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  try {
    await db.product.delete({ where: { id } });
  } catch (error) {
    // FK-Restrict: Produkt hat noch Tickets/Artikel/Postfächer
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return;
    throw error;
  }
  revalidatePath("/settings/products");
}

export default async function ProductsPage() {
  await requireAdmin();
  const products = await db.product.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { tickets: true, kbArticles: true, mailboxes: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Produkte</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ein Portal, mehrere Produkte: Die Domain entscheidet, welches Produkt (Name,
          Wissensdatenbank, Anfragen) Kunden sehen. Ohne Domain-Treffer gilt das
          Standard-Produkt. Beide Domains zeigen per DNS/Reverse-Proxy auf diese Installation.
        </p>
      </div>

      <div className="space-y-4">
        {products.map((p) => (
          <form
            key={p.id}
            action={saveProduct}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <input type="hidden" name="id" value={p.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-500">
                Anzeigename (Portal-Branding) *
                <input name="name" defaultValue={p.name} required className="input mt-1" />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Kürzel (für API/Import) *
                <input name="key" defaultValue={p.key} required className="input mt-1" />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Portal-Domain
                <input
                  name="domain"
                  defaultValue={p.domain ?? ""}
                  placeholder="support.beispiel.de"
                  className="input mt-1"
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Portal-URL (Links in Kunden-Mails)
                <input
                  name="portalUrl"
                  defaultValue={p.portalUrl ?? ""}
                  placeholder="https://support.beispiel.de"
                  className="input mt-1"
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Portalfarbe (Hero-Hintergrund, Buttons)
                <input
                  name="accentColor"
                  type="color"
                  defaultValue={p.accentColor ?? DEFAULT_ACCENT}
                  className="mt-1 h-9 w-16 cursor-pointer rounded border border-slate-200"
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Logo (PNG/JPG/SVG/WebP, max. 2 MB)
                <span className="mt-1 flex items-center gap-2">
                  {p.logoKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/${p.logoKey}`} alt="" className="h-8 w-auto rounded border border-slate-100 bg-white p-0.5" />
                  )}
                  <input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="text-xs" />
                  {p.logoKey && (
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <input type="checkbox" name="removeLogo" value="1" /> entfernen
                    </label>
                  )}
                </span>
              </label>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
              <span>
                {p._count.tickets} Tickets · {p._count.kbArticles} KB-Artikel · {p._count.mailboxes}{" "}
                Postfächer
              </span>
              {p.isDefault ? (
                <span className="rounded bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                  Standard-Produkt
                </span>
              ) : (
                <button formAction={makeDefault} className="text-blue-700 hover:underline">
                  Als Standard setzen
                </button>
              )}
              <span className="ml-auto flex gap-3">
                {!p.isDefault &&
                  p._count.tickets + p._count.kbArticles + p._count.mailboxes === 0 && (
                    <button formAction={deleteProduct} className="text-red-600 hover:underline">
                      Löschen
                    </button>
                  )}
                <button type="submit" className="btn-secondary">
                  Speichern
                </button>
              </span>
            </div>
          </form>
        ))}
      </div>

      <form action={saveProduct} className="rounded-lg border border-dashed border-slate-300 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Neues Produkt</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-500">
            Anzeigename *
            <input name="name" required placeholder="z. B. plantbeat" className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Kürzel *
            <input name="key" required placeholder="z. B. plantbeat" className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Portal-Domain
            <input name="domain" placeholder="support.plantbeat.io" className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Portal-URL
            <input name="portalUrl" placeholder="https://support.plantbeat.io" className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Portalfarbe
            <input
              name="accentColor"
              type="color"
              defaultValue={DEFAULT_ACCENT}
              className="mt-1 h-9 w-16 cursor-pointer rounded border border-slate-200"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Logo (optional)
            <input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="mt-1 block text-xs" />
          </label>
        </div>
        <button type="submit" className="btn-primary mt-3">
          Produkt anlegen
        </button>
      </form>
    </div>
  );
}
