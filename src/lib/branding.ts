// Branding-Uploads (Produkt-Logos, Kategorie-Icons) aus Formularen entgegennehmen.
import { storeBrandingFile } from "./storage";

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

/** Hochgeladenes Bild ablegen; liefert den Storage-Key oder null (kein/ungültiges Bild). */
export async function saveUploadedImage(
  file: FormDataEntryValue | null,
  baseName: string
): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = IMAGE_EXT[file.type];
  if (!ext || file.size > 2 * 1024 * 1024) return null; // max 2 MB, nur Bildformate
  return storeBrandingFile(baseName, ext, Buffer.from(await file.arrayBuffer()));
}
