import Link from "next/link";
import { getCurrentContact } from "@/lib/portal-session";
import { currentProduct, productAccent, productLogoUrl, productMetadata, productTitle } from "@/lib/product";
import { isAiEnabled } from "@/server/ai";
import { ChatWidget } from "@/components/chat-widget";

export async function generateMetadata() {
  const product = await currentProduct();
  const meta = productMetadata(product);
  return { ...meta, title: `${productTitle(product)} — Hilfe-Center` };
}

export default async function KbLayout({ children }: { children: React.ReactNode }) {
  const contact = await getCurrentContact();
  const product = await currentProduct();
  const accent = productAccent(product);
  const logoUrl = productLogoUrl(product);
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/kb" className="flex items-center gap-2 text-sm font-semibold">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-7 w-auto" />
            )}
            <span>
              {product.name} <span style={{ color: accent }}>Hilfe-Center</span>
            </span>
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
            <Link
              href={contact ? "/portal/new" : "/portal/login"}
              className="btn-primary"
              style={{ backgroundColor: accent }}
            >
              Anfrage stellen
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      {isAiEnabled() && <ChatWidget loggedIn={!!contact} />}
    </div>
  );
}
