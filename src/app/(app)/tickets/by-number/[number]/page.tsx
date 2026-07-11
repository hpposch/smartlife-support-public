import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Stabile Links in Benachrichtigungs-Mails: /tickets/by-number/1042
export default async function TicketByNumberPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requireUser();
  const { number } = await params;
  const ticket = await db.ticket.findUnique({ where: { number: Number(number) || 0 } });
  if (!ticket) notFound();
  redirect(`/tickets/${ticket.id}`);
}
