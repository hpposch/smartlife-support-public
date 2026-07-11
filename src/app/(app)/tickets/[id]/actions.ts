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
