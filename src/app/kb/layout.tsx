import Link from "next/link";
import { getCurrentContact } from "@/lib/portal-session";
import { isAiEnabled } from "@/server/ai";
import { ChatWidget } from "@/components/chat-widget";

export default async function KbLayout({ children }: { children: React.ReactNode }) {
  const contact = await getCurrentContact();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <Link href="/kb" className="text-sm font-semibold">
            SmartLife <span className="text-blue-600">Hilfe-Center</span>
          </Link>
          <nav className="ml-auto flex items-center gap-4 text-sm text-slate-600">
            {contact ? (
              <Link href="/portal" className="hover:text-slate-900">
                Meine Anfragen
              </Link>
            ) : (
              <Link href="/portal/login" className="hover:text-slate-900">
                Anmelden
              </Link>
            )}
            <Link href={contact ? "/portal/new" : "/portal/login"} className="btn-primary">
              Anfrage stellen
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      {isAiEnabled() && <ChatWidget loggedIn={!!contact} />}
    </div>
  );
}
