import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCredentials } from "@/lib/auth";
import { rateLimit, rateLimitReset } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const [byIp, byEmail] = await Promise.all([
    rateLimit("login-ip", ip, { max: 20, windowSeconds: 900 }),
    rateLimit("login-email", email, { max: 10, windowSeconds: 900 }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) redirect("/login?error=ratelimit");

  const user = await verifyCredentials(email, password);
  if (!user) redirect("/login?error=1");
  await rateLimitReset("login-email", email);

  const session = await getSession();
  session.userId = user.id;
  await session.save();
  redirect("/tickets");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">SmartLife Support</h1>
        <p className="mb-6 text-sm text-slate-500">Anmeldung für Agenten</p>
        {params.error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {params.error === "ratelimit"
              ? "Zu viele Versuche — bitte in 15 Minuten erneut versuchen."
              : "E-Mail oder Passwort falsch."}
          </p>
        )}
        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">E-Mail</label>
            <input name="email" type="email" required autoFocus className="input" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Passwort</label>
            <input name="password" type="password" required className="input" />
          </div>
          <button type="submit" className="btn-primary w-full justify-center">
            Anmelden
          </button>
        </form>
      </div>
    </main>
  );
}
