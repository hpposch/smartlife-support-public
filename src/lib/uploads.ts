// Datei-Uploads von Kunden (Portal-Formulare, Chat) als Anhänge speichern.
import { db } from "./db";
import { storeFile } from "./storage";

export const UPLOAD_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024 };

// Ausführbare Dateien nicht annehmen — alles andere wird beim Download
// ohnehin nur als "attachment" ausgeliefert (kein Rendern im App-Origin)
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|vbs|jar)$/i;

/** Dateien aus formData.getAll(...) als Anhänge an eine Nachricht hängen. */
export async function attachUploads(
  formFiles: FormDataEntryValue[],
  messageId: string
): Promise<number> {
  const files = formFiles
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, UPLOAD_LIMITS.maxFiles);
  let count = 0;
  for (const file of files) {
    if (file.size > UPLOAD_LIMITS.maxBytes || BLOCKED_EXT.test(file.name)) continue;
    const storageKey = await storeFile("attachments", Buffer.from(await file.arrayBuffer()));
    await db.attachment.create({
      data: {
        messageId,
        fileName: file.name.slice(0, 255) || "datei",
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storageKey,
      },
    });
    count++;
  }
  return count;
}
