import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/labels";

async function logout() {
  "use server";
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

export async function generateMetadata() {
  const { defaultProduct, productMetadata, productTitle } = await import("@/lib/product");
  const product = await defaultProduct();
  const meta = productMetadata(product);
  return { ...meta, title: `${productTitle(product)} — Agenten` };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-semibold">
            SmartLife <span className="text-blue-600">Support</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            <Link href="/" className="hover:text-slate-900">
              Übersicht
            </Link>
            <Link href="/tickets" className="hover:text-slate-900">
              Tickets
            </Link>
            <Link href="/tickets/new" className="hover:text-slate-900">
              Neues Ticket
            </Link>
            <Link href="/contacts" className="hover:text-slate-900">
              Kontakte
            </Link>
            {(user.role === "admin" || user.role === "team_lead") && (
              <Link href="/reports" className="hover:text-slate-900">
                Berichte
              </Link>
            )}
            {user.role === "admin" && (
              <Link href="/settings" className="hover:text-slate-900">
                Verwaltung
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link
              href="/settings/security"
              className="text-slate-400 hover:text-slate-600"
              title="Sicherheit (2FA)"
            >
              🔒
            </Link>
            <span className="text-slate-500">
              {user.name} · {ROLE_LABELS[user.role]}
            </span>
            <form action={logout}>
              <button type="submit" className="btn-secondary">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
