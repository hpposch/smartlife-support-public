// DSGVO-Datenauskunft: alle Daten eines Kontakts als JSON-Download (nur Admin).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportContactData } from "@/server/privacy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { id } = await params;
  const data = await exportContactData(id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="datenauskunft-${id.slice(0, 8)}.json"`,
    },
  });
}
