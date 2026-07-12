"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { addAgentReply, addInternalNote, type UploadedFile } from "@/server/messages";
import { setTicketTags, updateTicket } from "@/server/tickets";

async function filesFromForm(formData: FormData): Promise<UploadedFile[]> {
  const files: UploadedFile[] = [];
  for (const entry of formData.getAll("files")) {
    if (entry instanceof File && entry.size > 0) {
      files.push({
        name: entry.name,
        type: entry.type,
        data: Buffer.from(await entry.arrayBuffer()),
      });
    }
  }
  return files;
}

const replySchema = z.object({
  ticketId: z.string().uuid(),
  kind: z.enum(["reply", "note"]),
  body: z.string().min(1, "Text fehlt"),
  setStatus: z.enum(["pending_customer", "resolved", "open"]).optional(),
});

export async function submitMessage(formData: FormData) {
  const user = await requireUser();
  const input = replySchema.parse({
    ticketId: formData.get("ticketId"),
    kind: formData.get("kind"),
    body: formData.get("body"),
    setStatus: formData.get("setStatus") || undefined,
  });
  const files = await filesFromForm(formData);

  if (input.kind === "reply") {
    await addAgentReply({
      ticketId: input.ticketId,
      userId: user.id,
      bodyText: input.body,
      files,
      setStatus: input.setStatus,
    });
  } else {
    await addInternalNote({
      ticketId: input.ticketId,
      userId: user.id,
      bodyText: input.body,
      files,
    });
  }
  revalidatePath(`/tickets/${input.ticketId}`);
}

/** KI-Antwortentwurf erzeugen — Rückgabe wird clientseitig ins Textfeld übernommen. */
export async function generateAiDraft(ticketId: string): Promise<
  { ok: true; draft: string } | { ok: false; error: string }
> {
  await requireUser();
  const { isAiEnabled, draftReply } = await import("@/server/ai");
  if (!isAiEnabled()) return { ok: false, error: "KI ist nicht konfiguriert" };
  try {
    return { ok: true, draft: await draftReply(z.string().uuid().parse(ticketId)) };
  } catch (error) {
    console.error("[ai] Entwurf fehlgeschlagen:", error);
    return { ok: false, error: "Entwurf konnte nicht erstellt werden" };
  }
}

/** KI-Zusammenfassung als interne Notiz anhängen. */
export async function generateAiSummary(formData: FormData) {
  const user = await requireUser();
  const ticketId = z.string().uuid().parse(formData.get("ticketId"));
  const { isAiEnabled, summarizeTicket } = await import("@/server/ai");
  if (!isAiEnabled()) return;
  try {
    await summarizeTicket(ticketId, user.id);
  } catch (error) {
    console.error("[ai] Zusammenfassung fehlgeschlagen:", error);
  }
  revalidatePath(`/tickets/${ticketId}`);
}

/** KI-KB-Artikel-Entwurf aus dem Ticket erzeugen → öffnet den Artikel-Editor. */
export async function generateKbDraft(formData: FormData) {
  const user = await requireUser();
  const ticketId = z.string().uuid().parse(formData.get("ticketId"));
  const { isAiEnabled, draftKbArticleFromTicket } = await import("@/server/ai");
  if (!isAiEnabled()) return;
  let articleId: string;
  try {
    articleId = await draftKbArticleFromTicket(ticketId, user.id);
  } catch (error) {
    console.error("[ai] KB-Entwurf fehlgeschlagen:", error);
    return;
  }
  const { redirect } = await import("next/navigation");
  redirect(`/settings/kb/${articleId}`);
}

const updateSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["new", "open", "pending_customer", "pending_internal", "resolved", "closed"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  assigneeId: z.string(),
  teamId: z.string(),
  categoryId: z.string(),
  tags: z.string(),
});

export async function updateTicketProperties(formData: FormData) {
  const user = await requireUser();
  const input = updateSchema.parse({
    ticketId: formData.get("ticketId"),
    status: formData.get("status"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId") ?? "",
    teamId: formData.get("teamId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    tags: formData.get("tags") ?? "",
  });

  await updateTicket(
    input.ticketId,
    {
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId || null,
      teamId: input.teamId || null,
      categoryId: input.categoryId || null,
    },
    { userId: user.id }
  );
  await setTicketTags(input.ticketId, input.tags.split(","), { userId: user.id });

  revalidatePath(`/tickets/${input.ticketId}`);
  revalidatePath("/tickets");
}

/** Makro anwenden: optionale Antwort + Status/Priorität/Tags in einem Schritt. */
export async function applyMacro(formData: FormData) {
  const user = await requireUser();
  const ticketId = z.string().uuid().parse(formData.get("ticketId"));
  const macroId = String(formData.get("macroId") ?? "");
  if (!macroId) return;
  const { db } = await import("@/lib/db");
  const macro = await db.macro.findUniqueOrThrow({ where: { id: macroId } });
  if (!macro.isActive) return;

  if (macro.body?.trim()) {
    const ticket = await db.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { contact: true },
    });
    const body = macro.body
      .replaceAll("{{ticket.number}}", String(ticket.number))
      .replaceAll("{{contact.name}}", ticket.contact.name ?? "")
      .replaceAll("{{agent.name}}", user.name);
    const { addAgentReply } = await import("@/server/messages");
    await addAgentReply({ ticketId, userId: user.id, bodyText: body });
  }
  const update: Parameters<typeof updateTicket>[1] = {};
  if (macro.setStatus) {
    update.status = z
      .enum(["new", "open", "pending_customer", "pending_internal", "resolved", "closed"])
      .parse(macro.setStatus);
  }
  if (macro.setPriority) {
    update.priority = z.enum(["low", "normal", "high", "urgent"]).parse(macro.setPriority);
  }
  if (Object.keys(update).length > 0) {
    await updateTicket(ticketId, update, { userId: user.id });
  }
  if (macro.addTags.length > 0) {
    const existing = await db.ticketTag.findMany({
      where: { ticketId },
      include: { tag: true },
    });
    const { setTicketTags } = await import("@/server/tickets");
    await setTicketTags(
      ticketId,
      [...existing.map((t) => t.tag.name), ...macro.addTags],
      { userId: user.id }
    );
  }
  revalidatePath(`/tickets/${ticketId}`);
}

/** Ticket in ein anderes (gleicher Kunde) zusammenführen. */
export async function mergeTicketAction(formData: FormData) {
  const user = await requireUser();
  const ticketId = z.string().uuid().parse(formData.get("ticketId"));
  const targetNumber = Number(String(formData.get("targetNumber")).replace(/^#/, ""));
  if (!Number.isInteger(targetNumber) || targetNumber <= 0) return;
  const { mergeTickets } = await import("@/server/tickets");
  const result = await mergeTickets(ticketId, targetNumber, { userId: user.id });
  const { redirect } = await import("next/navigation");
  if (result.ok) {
    redirect(`/tickets/${result.targetId}`);
  } else {
    redirect(`/tickets/${ticketId}?fehler=${encodeURIComponent(result.error)}`);
  }
}
