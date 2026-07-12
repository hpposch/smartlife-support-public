// Ticket-Präsenz für die Kollisionswarnung: Agenten melden sich beim Öffnen
// eines Tickets alle ~25 s; andere aktive Betrachter kommen zurück.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queues } from "@/lib/queue";

const ACTIVE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const json = await request.json().catch(() => null);
  const ticketId = typeof json?.ticketId === "string" ? json.ticketId : null;
  if (!ticketId || !/^[0-9a-f-]{36}$/.test(ticketId)) {
    return NextResponse.json({ error: { code: "validation_error" } }, { status: 422 });
  }

  const redis = queues().connection;
  const key = `presence:${ticketId}`;
  const now = Date.now();
  await redis.hset(key, user.id, `${now}|${user.name}`);
  await redis.expire(key, 120);

  const entries = await redis.hgetall(key);
  const others: string[] = [];
  for (const [userId, value] of Object.entries(entries)) {
    if (userId === user.id) continue;
    const [ts, name] = value.split("|");
    if (now - Number(ts) < ACTIVE_WINDOW_MS) others.push(name || "Unbekannt");
    else await redis.hdel(key, userId);
  }
  return NextResponse.json({ data: { others } });
}
