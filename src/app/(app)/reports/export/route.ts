import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ticketsCsv } from "@/server/reporting";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "team_lead")) {
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const to = params.get("to") ? new Date(`${params.get("to")}T23:59:59`) : new Date();
  const from = params.get("from")
    ? new Date(`${params.get("from")}T00:00:00`)
    : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

  const csv = await ticketsCsv({ from, to });
  // BOM, damit Excel UTF-8 (Umlaute) korrekt erkennt
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickets_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
