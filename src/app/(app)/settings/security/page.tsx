// Zwei-Faktor-Authentifizierung (TOTP) für das eigene Agenten-Konto:
// Secret wird erst nach Bestätigung eines gültigen Codes gespeichert.
import { toDataURL } from "qrcode";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";

async function startSetup() {
  "use server";
  await requireUser();
  const session = await getSession();
  session.pendingTotpSecret = generateTotpSecret();
  await session.save();
  redirect("/settings/security");
}

async function confirmSetup(formData: FormData) {
  "use server";
  const user = await requireUser();
  const session = await getSession();
  const secret = session.pendingTotpSecret;
  const code = String(formData.get("code") ?? "");
  if (!secret || !verifyTotp(secret, code)) redirect("/settings/security?error=1");
  await db.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
  session.pendingTotpSecret = undefined;
  await session.save();
  redirect("/settings/security?aktiviert=1");
}

async function disableTotp(formData: FormData) {
  "use server";
  const user = await requireUser();
  const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const code = String(formData.get("code") ?? "");
  if (!record.totpSecret || !verifyTotp(record.totpSecret, code)) {
    redirect("/settings/security?error=1");
  }
  await db.user.update({ where: { id: user.id }, data: { totpSecret: null } });
  redirect("/settings/security?deaktiviert=1");
}

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; aktiviert?: string; deaktiviert?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const session = await getSession();
  const pendingSecret = session.pendingTotpSecret;
  const qr = pendingSecret
    ? await toDataURL(totpUri(pendingSecret, user.email), { margin: 1, width: 200 })
    : null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">Sicherheit</h1>

      {params.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Der Code war ungültig — bitte erneut versuchen.
        </p>
      )}
      {params.aktiviert && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          2FA ist jetzt aktiv. Beim nächsten Login wird der Code abgefragt.
        </p>
      )}
      {params.deaktiviert && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">2FA wurde deaktiviert.</p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Zwei-Faktor-Authentifizierung (TOTP)</h2>
        {record.totpSecret ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-emerald-700">✓ Aktiv für {user.email}</p>
            <form action={disableTotp} className="flex items-center gap-2">
              <input
                name="code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                placeholder="Aktueller Code"
                className="input max-w-[10rem]"
              />
              <button type="submit" className="btn-secondary">
                2FA deaktivieren
              </button>
            </form>
          </div>
        ) : pendingSecret ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-slate-600">
              1. QR-Code mit Ihrer Authenticator-App scannen (oder Secret manuell eintragen):
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="TOTP-QR-Code" className="rounded border border-slate-200" />}
            <p className="break-all font-mono text-xs text-slate-500">{pendingSecret}</p>
            <p className="text-sm text-slate-600">2. Den angezeigten Code bestätigen:</p>
            <form action={confirmSetup} className="flex items-center gap-2">
              <input
                name="code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoFocus
                placeholder="123456"
                className="input max-w-[10rem]"
              />
              <button type="submit" className="btn-primary">
                Aktivieren
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-slate-500">
              Schützt Ihr Konto mit einem zweiten Faktor (Google/Microsoft Authenticator,
              1Password …).
            </p>
            <form action={startSetup} className="mt-3">
              <button type="submit" className="btn-primary">
                2FA einrichten
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
