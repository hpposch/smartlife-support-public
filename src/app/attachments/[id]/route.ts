import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentContact } from "@/lib/portal-session";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const attachment = await db.attachment.findUnique({
    where: { id },
    include: { message: { include: { ticket: true } } },
  });
  if (!attachment) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // Zugriff: jeder Agent — oder der Portal-Kunde, dem das Ticket gehört
  // (und nur für Nachrichten, die im Portal sichtbar sind)
  const user = await getCurrentUser();
  if (!user) {
    const contact = await getCurrentContact();
    const portalVisible =
      attachment.message.type === "customer" || attachment.message.type === "agent_reply";
    if (!contact || attachment.message.ticket.contactId !== contact.id || !portalVisible) {
      return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
    }
  }

  const data = await readStoredFile(attachment.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.sizeBytes),
      // attachment statt inline: HTML/SVG aus fremden Mails nie im App-Origin rendern
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    },
  });
}
