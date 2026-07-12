import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  name: z.string().min(1),
  address: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().positive(),
  imapUser: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().positive(),
  smtpUser: z.string().min(1),
  credentialsRef: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "Name einer ENV-Variable, z. B. MAILBOX_SUPPORT_PASSWORD"),
  productId: z.string().min(1),
});

async function createMailbox(formData: FormData) {
  "use server";
  await requireAdmin();
  const input = schema.parse(Object.fromEntries(formData));
  const team = await db.team.findFirst();
  await db.mailbox.create({
    data: { ...input, address: input.address.toLowerCase(), defaultTeamId: team?.id ?? null },
  });
  revalidatePath("/settings/mailboxes");
}

async function toggleMailbox(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const mailbox = await db.mailbox.findUniqueOrThrow({ where: { id } });
  await db.mailbox.update({ where: { id }, data: { isActive: !mailbox.isActive } });
  revalidatePath("/settings/mailboxes");
}

export default async function MailboxesPage() {
  await requireAdmin();
  const [mailboxes, products] = await Promise.all([
    db.mailbox.findMany({ orderBy: { address: "asc" }, include: { product: true } }),
    db.product.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Postfächer</h1>
      <p className="text-sm text-slate-500">
        Das Passwort wird nicht in der Datenbank gespeichert: <code>credentialsRef</code> benennt
        die Umgebungsvariable, die das Passwort enthält (z. B.{" "}
        <code>MAILBOX_SUPPORT_PASSWORD</code> in der <code>.env</code> bzw. im Deployment).
      </p>
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700">Gmail / Google Workspace</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Im Google-Konto die <strong>2-Faktor-Authentifizierung</strong> aktivieren</li>
          <li>
            Unter <em>Google-Konto → Sicherheit → App-Passwörter</em> ein{" "}
            <strong>App-Passwort</strong> erzeugen (16 Zeichen, ohne Leerzeichen eintragen)
          </li>
          <li>In Gmail unter <em>Einstellungen → Weiterleitung/POP/IMAP</em> IMAP aktivieren</li>
          <li>
            Hier eintragen: IMAP <code>imap.gmail.com:993</code>, SMTP{" "}
            <code>smtp.gmail.com:587</code>, Benutzer = vollständige Adresse
          </li>
          <li>
            Anbindung prüfen: <code>npm run mailbox:check -- &lt;adresse&gt;</code>
          </li>
        </ol>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Adresse</th>
              <th className="px-4 py-2">Produkt</th>
              <th className="px-4 py-2">IMAP</th>
              <th className="px-4 py-2">SMTP</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Noch kein Postfach angebunden.
                </td>
              </tr>
            )}
            {mailboxes.map((mb) => (
              <tr key={mb.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium">{mb.address}</td>
                <td className="px-4 py-2 text-slate-600">{mb.product.name}</td>
                <td className="px-4 py-2 text-slate-600">
                  {mb.imapHost}:{mb.imapPort}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {mb.smtpHost}:{mb.smtpPort}
                </td>
                <td className="px-4 py-2">
                  {mb.isActive ? (
                    <span className="text-emerald-600">aktiv</span>
                  ) : (
                    <span className="text-slate-400">pausiert</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={toggleMailbox}>
                    <input type="hidden" name="id" value={mb.id} />
                    <button type="submit" className="text-xs text-blue-700 hover:underline">
                      {mb.isActive ? "Pausieren" : "Aktivieren"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        action={createMailbox}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Postfach anbinden</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="name" required placeholder="Anzeigename (z. B. Support)" className="input" />
          <input name="address" type="email" required placeholder="support@smartlifebi.com" className="input" />
          <input name="imapHost" required placeholder="IMAP-Host (Gmail: imap.gmail.com)" className="input" />
          <input name="imapPort" type="number" defaultValue={993} required placeholder="IMAP-Port" className="input" />
          <input name="imapUser" required placeholder="IMAP-Benutzer" className="input" />
          <input name="smtpHost" required placeholder="SMTP-Host (Gmail: smtp.gmail.com)" className="input" />
          <input name="smtpPort" type="number" defaultValue={587} required placeholder="SMTP-Port" className="input" />
          <input name="smtpUser" required placeholder="SMTP-Benutzer" className="input" />
          <select name="productId" required className="input" title="Produkt: Mails an dieses Postfach werden diesem Produkt zugeordnet">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                Produkt: {p.name}
              </option>
            ))}
          </select>
          <input
            name="credentialsRef"
            required
            placeholder="ENV-Variable mit Passwort, z. B. MAILBOX_SUPPORT_PASSWORD"
            className="input sm:col-span-2"
          />
        </div>
        <button type="submit" className="btn-primary">
          Anbinden
        </button>
      </form>
    </div>
  );
}
