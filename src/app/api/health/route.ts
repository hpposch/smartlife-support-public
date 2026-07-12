// Healthcheck für Monitoring und Docker: prüft DB- und Redis-Verbindung.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = { db: "error", redis: "error" };
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {}
  try {
    if ((await queues().connection.ping()) === "PONG") checks.redis = "ok";
  } catch {}

  // Heartbeats (Worker-Prozess, Postfach-Abruf) — informativ; "degraded",
  // aber HTTP 200, solange DB+Redis stehen (Uptime-Monitore prüfen den Status)
  const heartbeats: Record<string, number | null> = {};
  let degraded = false;
  try {
    const { heartbeatAge } = await import("@/server/monitoring");
    for (const name of ["worker", "mail-poll"]) {
      const age = await heartbeatAge(name);
      heartbeats[name] = age === null ? null : Math.round(age / 1000);
    }
    const workerAge = heartbeats.worker;
    if (workerAge === null || workerAge > 120) degraded = true;
  } catch {}

  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? (degraded ? "degraded" : "ok") : "error",
      checks,
      heartbeatsSeconds: heartbeats,
    },
    { status: healthy ? 200 : 503 }
  );
}
