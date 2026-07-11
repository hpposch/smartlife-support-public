// Datei-Ablage für Anhänge und Roh-E-Mails.
// MVP: lokales Verzeichnis (Docker-Volume). Die Schnittstelle ist bewusst
// schmal gehalten, damit später ein S3-Treiber (MinIO) einsetzbar ist.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { env } from "./env";

function resolveKey(key: string): string {
  const base = path.resolve(env.dataDir);
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error(`Ungültiger Storage-Key: ${key}`);
  return full;
}

export async function storeFile(prefix: "attachments" | "raw-eml", data: Buffer): Promise<string> {
  const now = new Date();
  const key = path.posix.join(
    prefix,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    randomUUID()
  );
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}
