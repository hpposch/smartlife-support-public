import type { KbArticle, KbCategory } from "@prisma/client";

/** Gemeinsames Formular für Neu & Bearbeiten (Server-Komponente). */
export function ArticleForm({
  article,
  categories,
  action,
}: {
  article?: KbArticle;
  categories: KbCategory[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      {article && <input type="hidden" name="id" value={article.id} />}
      <label className="block text-xs font-medium text-slate-500">
        Titel *
        <input name="title" required defaultValue={article?.title} className="input mt-1" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-medium text-slate-500">
          Kategorie
          <select name="categoryId" defaultValue={article?.categoryId ?? ""} className="input mt-1">
            <option value="">— keine —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Status
          <select name="status" defaultValue={article?.status ?? "draft"} className="input mt-1">
            <option value="draft">Entwurf</option>
            <option value="published">Veröffentlicht</option>
            <option value="archived">Archiviert</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Sichtbarkeit
          <select
            name="visibility"
            defaultValue={article?.visibility ?? "public"}
            className="input mt-1"
          >
            <option value="public">Öffentlich</option>
            <option value="customers">Nur eingeloggte Kunden</option>
            <option value="internal">Nur intern (Agenten)</option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-500">
        Inhalt (Markdown) *
        <textarea
          name="body"
          required
          rows={18}
          defaultValue={article?.bodyMarkdown}
          placeholder={"# Überschrift\n\nText mit **Markdown** …"}
          className="input mt-1 font-mono text-[13px]"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary">
          Speichern
        </button>
        {article?.status === "published" && (
          <a
            href={`/kb/${article.slug}`}
            target="_blank"
            className="text-sm text-blue-700 hover:underline"
          >
            Im Hilfe-Center ansehen →
          </a>
        )}
      </div>
    </form>
  );
}
