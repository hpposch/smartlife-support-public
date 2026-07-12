import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const GROUPS: { title: string; sections: { href: string; title: string; desc: string }[] }[] = [
  {
    title: "Verwalten",
    sections: [
      { href: "/settings/products", title: "Produkte", desc: "Mehrere Produkte über ein Portal — Domains, Branding, eigene Felder, Login" },
      { href: "/settings/mailboxes", title: "Postfächer", desc: "Support-Postfächer (IMAP/SMTP) anbinden" },
      { href: "/settings/categories", title: "Ticket-Typen", desc: "Kategorien für Anfragen pflegen" },
      { href: "/settings/canned", title: "Textbausteine", desc: "Vordefinierte Antworten mit Platzhaltern" },
      { href: "/settings/macros", title: "Makros", desc: "Antwort + Status/Priorität/Tags mit einem Klick" },
    ],
  },
  {
    title: "Wissensdatenbank",
    sections: [
      { href: "/settings/kb", title: "Artikel & Kategorien", desc: "Inhalte fürs Hilfe-Center, Icons, Sichtbarkeit" },
    ],
  },
  {
    title: "Automatisierung",
    sections: [
      { href: "/settings/automation", title: "Regeln", desc: "Erstellungs- und Zeitregeln, Auto-Zuweisung (Round-Robin)" },
      { href: "/settings/sla", title: "SLA & Geschäftszeiten", desc: "Reaktions-/Lösungsfristen, Feiertage, Eskalation" },
      { href: "/settings/webhooks", title: "Webhooks", desc: "Ticket-Ereignisse an externe Systeme senden" },
    ],
  },
  {
    title: "Benutzer & Sicherheit",
    sections: [
      { href: "/settings/users", title: "Benutzer & Teams", desc: "Agenten, Rollen, Team-Zugehörigkeit" },
      { href: "/settings/security", title: "Sicherheit (2FA)", desc: "Zwei-Faktor-Authentifizierung für das eigene Konto" },
      { href: "/settings/backups", title: "Backups", desc: "Sicherung als eine Datei, Download & Wiederherstellung, S3-Upload" },
    ],
  },
];

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-lg font-semibold">Verwaltung</h1>
      {GROUPS.map((group) => (
        <div key={group.title}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            {group.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.sections.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
              >
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
