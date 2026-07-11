import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const { id } = await params;
  const attachment = await db.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

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
