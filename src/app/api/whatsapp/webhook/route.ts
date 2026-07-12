// WhatsApp-Cloud-API-Webhook: GET = Verifizierung (Meta-Setup),
// POST = eingehende Nachrichten. Statuse (delivered/read) werden ignoriert.
import { NextRequest, NextResponse } from "next/server";
import { extractIncomingMessages, ingestWhatsappMessage, isWhatsappEnabled } from "@/server/whatsapp";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN &&
    process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: { code: "verification_failed" } }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!isWhatsappEnabled()) {
    return NextResponse.json({ error: { code: "not_configured" } }, { status: 503 });
  }
  const payload = await request.json().catch(() => null);
  for (const incoming of extractIncomingMessages(payload)) {
    try {
      await ingestWhatsappMessage(incoming);
    } catch (error) {
      console.error("[whatsapp] Verarbeitung fehlgeschlagen:", error);
    }
  }
  // Meta erwartet schnelle 200-Antworten, sonst wird erneut zugestellt
  return NextResponse.json({ ok: true });
}
