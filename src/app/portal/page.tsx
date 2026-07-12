import Link from "next/link";
import { db } from "@/lib/db";
import { requireContact } from "@/lib/portal-session";
import { currentProduct } from "@/lib/product";
import { STATUS_COLORS, STATUS_LABELS, formatRelative } from "@/lib/labels";

export default async function PortalTicketsPage() {
  const contact = await requireContact();
  const product = await currentProduct();

  // Nur Anfragen des Produkts der aufgerufenen Domain
  const tickets = await db.ticket.findMany({
    where: { contactId: contact.id, productId: product.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meine Anfragen</h1>
        <Link href="/portal/new" className="btn-primary">
          Neue Anfrage
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-slate-500">Sie haben noch keine Anfragen.</p>
          <p className="mt-2 text-sm text-slate-400">
            Vielleicht hilft Ihnen auch unser <Link href="/kb" className="text-blue-700 underline">Hilfe-Center</Link>.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Betreff</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{ticket.number}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/portal/tickets/${ticket.id}`}
                      className="font-medium hover:text-blue-700"
                    >
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatRelative(ticket.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
