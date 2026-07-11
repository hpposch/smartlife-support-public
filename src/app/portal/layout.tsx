import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentContact, getPortalSession } from "@/lib/portal-session";

async function portalLogout() {
  "use server";
  const session = await getPortalSession();
  session.destroy();
  redirect("/portal/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const contact = await getCurrentContact();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <Link href="/portal" className="text-sm font-semibold">
            SmartLife <span className="text-blue-600">Support</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            {contact && (
              <>
                <Link href="/portal" className="hover:text-slate-900">
                  Meine Anfragen
                </Link>
                <Link href="/portal/new" className="hover:text-slate-900">
                  Neue Anfrage
                </Link>
              </>
            )}
            <Link href="/kb" className="hover:text-slate-900">
              Hilfe-Center
            </Link>
          </nav>
          {contact && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="text-slate-500">{contact.name ?? contact.email}</span>
              <form action={portalLogout}>
                <button type="submit" className="btn-secondary">
                  Abmelden
                </button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
