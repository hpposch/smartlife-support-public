// Zweiter Login-Schritt bei aktivierter 2FA: TOTP-Code aus der Authenticator-App.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";

async function confirmCode(formData: FormData) {
  "use server";
  const session = await getSession();
  const pendingUserId = session.pendingUserId;
  if (!pendingUserId) redirect("/login");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("totp-ip", ip, { max: 10, windowSeconds: 900 });
  if (!allowed) redirect("/login?error=ratelimit");

  const user = await db.user.findUnique({ where: { id: pendingUserId } });
  const code = String(formData.get("code") ?? "");
  if (!user?.isActive || !user.totpSecret || !verifyTotp(user.totpSecret, code)) {
    redirect("/login/2fa?error=1");
  }

  session.pendingUserId = undefined;
  session.userId = user.id;
  await session.save();
  redirect("/tickets");
}

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  if (!session.pendingUserId) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Zwei-Faktor-Code</h1>
        <p className="mb-6 text-sm text-slate-500">
          Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.
        </p>
        {params.error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Der Code war ungültig. Bitte erneut versuchen.
          </p>
        )}
        <form action={confirmCode} className="space-y-4">
          <input
            name="code"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
            placeholder="123456"
            className="input text-center text-lg tracking-[0.4em]"
          />
          <button type="submit" className="btn-primary w-full justify-center">
            Bestätigen
          </button>
        </form>
      </div>
    </main>
  );
}
