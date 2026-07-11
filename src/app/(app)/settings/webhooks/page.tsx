import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

const EVENTS = ["ticket.created", "ticket.replied", "ticket.resolved", "ticket.closed"] as const;

async function createWebhook(formData: FormData) {
  "use server";
  await requireAdmin();
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return;
  const events = EVENTS.filter((e) => formData.get(`event_${e}`));
  if (events.length === 0) return;
  await db.webhook.create({
    data: { url, events: [...events], secret: randomBytes(24).toString("hex") },
  });
  revalidatePath("/settings/webhooks");
}

async function toggleWebhook(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const hook = await db.webhook.findUniqueOrThrow({ where: { id } });
  await db.webhook.update({
    where: { id },
    data: { isActive: !hook.isActive, failureCount: 0 },
  });
  revalidatePath("/settings/webhooks");
}

async function deleteWebhook(formData: FormData) {
  "use server";
  await requireAdmin();
  await db.webhook.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/settings/webhooks");
}

export default async function WebhooksPage() {
  await requireAdmin();
  const hooks = await db.webhook.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Webhooks</h1>
      <p className="text-sm text-slate-500">
        Bei den gewählten Ereignissen wird ein <code>POST</code> mit JSON-Payload an die URL
        gesendet. Die Signatur steht im Header <code>X-Signature</code> (
        <code>sha256=HMAC(secret, body)</code>). Nach 20 Fehlversuchen in Folge wird der Hook
        automatisch deaktiviert.
      </p>

      <div className="space-y-3">
        {hooks.map((hook) => (
          <div key={hook.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{hook.url}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {hook.events.join(", ")}
                  {hook.failureCount > 0 && (
                    <span className="ml-2 text-amber-600">{hook.failureCount} Fehlversuch(e)</span>
                  )}
                  {!hook.isActive && <span className="ml-2 text-red-600">deaktiviert</span>}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-400">Secret: {hook.secret}</p>
              </div>
              <div className="flex shrink-0 gap-3">
                <form action={toggleWebhook}>
                  <input type="hidden" name="id" value={hook.id} />
                  <button type="submit" className="text-xs text-blue-700 hover:underline">
                    {hook.isActive ? "Deaktivieren" : "Aktivieren"}
                  </button>
                </form>
                <form action={deleteWebhook}>
                  <input type="hidden" name="id" value={hook.id} />
                  <button type="submit" className="text-xs text-red-600 hover:underline">
                    Löschen
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
        {hooks.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400 shadow-sm">
            Noch keine Webhooks.
          </p>
        )}
      </div>

      <form
        action={createWebhook}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neuer Webhook</h2>
        <input name="url" type="url" required placeholder="https://…" className="input" />
        <div className="flex flex-wrap gap-4 text-sm">
          {EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-1.5">
              <input type="checkbox" name={`event_${event}`} defaultChecked />
              <code className="text-xs">{event}</code>
            </label>
          ))}
        </div>
        <button type="submit" className="btn-primary">
          Anlegen
        </button>
      </form>
    </div>
  );
}
