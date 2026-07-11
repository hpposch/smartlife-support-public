import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const SECTIONS = [
  { href: "/settings/users", title: "Benutzer & Teams", desc: "Agenten anlegen, Rollen und Team-Zugehörigkeit verwalten" },
  { href: "/settings/mailboxes", title: "Postfächer", desc: "Support-Postfächer (IMAP/SMTP) anbinden" },
  { href: "/settings/categories", title: "Kategorien", desc: "Ticket-Kategorien pflegen" },
  { href: "/settings/canned", title: "Textbausteine", desc: "Vordefinierte Antworten mit Platzhaltern" },
];

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Verwaltung</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
          >
            <h2 className="font-medium">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
