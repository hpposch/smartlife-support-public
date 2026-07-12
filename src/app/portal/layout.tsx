import Link from "next/link";
import { redirect } from "next/navigation";
import { b2cConfig, logoutUrl } from "@/lib/b2c";
import { getCurrentContact, getPortalSession } from "@/lib/portal-session";
import { currentProduct, productAccent, productLogoUrl } from "@/lib/product";
import { isAiEnabled } from "@/server/ai";
import { ChatWidget } from "@/components/chat-widget";

async function portalLogout() {
  "use server";
  const session = await getPortalSession();
  session.destroy();
  // Bei B2C zusätzlich die SSO-Session dort beenden
  const config = b2cConfig();
  if (config) {
    const url = await logoutUrl(config).catch(() => null);
    if (url) redirect(url);
  }
  redirect("/portal/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const contact = await getCurrentContact();
  const product = await currentProduct();
  const accent = productAccent(product);
  const logoUrl = productLogoUrl(product);
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <Link href="/portal" className="flex items-center gap-2 text-sm font-semibold">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-7 w-auto" />
            )}
            <span>
              {product.name} <span style={{ color: accent }}>Support</span>
            </span>
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
      {isAiEnabled() && <ChatWidget loggedIn={!!contact} />}
    </div>
  );
}
