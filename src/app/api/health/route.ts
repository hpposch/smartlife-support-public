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

  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks }, {
    status: healthy ? 200 : 503,
  });
}
