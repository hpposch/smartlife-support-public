// Öffentlicher Endpunkt des Chat-Assistenten (Hilfe-Center + Portal).
// Stateless: der Client hält den Verlauf, hier wird nur geantwortet.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { productForHost } from "@/lib/product";
import { rateLimit } from "@/lib/ratelimit";
import { isAiEnabled } from "@/server/ai";
import { assistantReply, CHAT_LIMITS } from "@/server/chat-assistant";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().min(1).max(CHAT_LIMITS.maxChars),
      })
    )
    .min(1)
    .max(CHAT_LIMITS.maxMessages),
});

export async function POST(request: NextRequest) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: { code: "ai_disabled", message: "Chat-Assistent ist nicht konfiguriert" } },
      { status: 503 }
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { allowed } = await rateLimit("chat-ip", ip, { max: 30, windowSeconds: 900 });
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Zu viele Anfragen — bitte kurz warten" } },
      { status: 429 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Ungültige Eingabe" } },
      { status: 422 }
    );
  }
  if (parsed.data.messages[parsed.data.messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Letzte Nachricht muss vom Nutzer sein" } },
      { status: 422 }
    );
  }

  try {
    const product = await productForHost(request.headers.get("host"));
    const result = await assistantReply(parsed.data.messages, product.id);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("[chat] Antwort fehlgeschlagen:", error);
    return NextResponse.json(
      { error: { code: "assistant_error", message: "Der Assistent ist gerade nicht erreichbar" } },
      { status: 502 }
    );
  }
}
