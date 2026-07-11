// Backup & Restore: Datenbank (pg_dump) + Datei-Ablage (Anhänge, Roh-EMLs)
// werden in EINE .tar.gz-Datei gepackt und aus genau dieser Datei wieder
// hergestellt. Läuft automatisch im Worker (BACKUP_CRON) und manuell über
// Verwaltung → Backups bzw. `npm run backup:create` / `npm run backup:restore`.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/env";

const run = promisify(execFile);

export function backupDir(): string {
  return path.resolve(process.env.BACKUP_DIR ?? "./backups");
}

export const BACKUP_PREFIX = "smartlife-backup-";

function timestamp(): string {
  // 2026-07-11_14-30-05 — dateisystemfreundlich und sortierbar
  return new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
}

export interface BackupInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  const backups: BackupInfo[] = [];
  for (const name of entries) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(".tar.gz")) continue;
    const info = await stat(path.join(dir, name));
    backups.push({ fileName: name, sizeBytes: info.size, createdAt: info.mtime });
  }
  return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Verhindert Path-Traversal bei Dateinamen aus Requests. */
export function resolveBackupFile(fileName: string): string {
  if (!/^[\w.-]+\.tar\.gz$/.test(fileName) || !fileName.startsWith(BACKUP_PREFIX)) {
    throw new Error("Ungültiger Backup-Dateiname");
  }
  return path.join(backupDir(), fileName);
}

/**
 * Erstellt ein vollständiges Backup als einzelne Datei:
 *   db.dump   — pg_dump im Custom-Format (komprimiert, für pg_restore)
 *   data/     — komplette Datei-Ablage (Anhänge, Roh-EMLs)
 *   meta.json — Zeitpunkt und Formatversion
 */
export async function createBackup(): Promise<BackupInfo> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const tmp = await mkdtemp(path.join(os.tmpdir(), "smartlife-backup-"));

  try {
    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--file",
      path.join(tmp, "db.dump"),
      env.databaseUrl,
    ]);

    await writeFile(
      path.join(tmp, "meta.json"),
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2)
    );

    // Datei-Ablage per Symlink einbinden (-h dereferenziert) — kein Kopieren nötig
    const dataDir = path.resolve(env.dataDir);
    await mkdir(dataDir, { recursive: true });
    await symlink(dataDir, path.join(tmp, "data"));

    const fileName = `${BACKUP_PREFIX}${timestamp()}.tar.gz`;
    const target = path.join(dir, fileName);
    await run("tar", ["-czhf", target, "-C", tmp, "db.dump", "meta.json", "data"]);

    await pruneBackups();
    const info = await stat(target);
    return { fileName, sizeBytes: info.size, createdAt: info.mtime };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Löscht Backups, die älter als BACKUP_KEEP_DAYS (Standard 30) sind — das jüngste bleibt immer. */
export async function pruneBackups(): Promise<number> {
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30);
  if (!Number.isFinite(keepDays) || keepDays <= 0) return 0;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const backups = await listBackups();
  let removed = 0;
  for (const backup of backups.slice(1)) {
    if (backup.createdAt.getTime() < cutoff) {
      await rm(path.join(backupDir(), backup.fileName), { force: true });
      removed++;
    }
  }
  return removed;
}

/**
 * Stellt Datenbank UND Datei-Ablage aus einer Backup-Datei wieder her.
 * ACHTUNG: überschreibt den aktuellen Stand vollständig. Web & Worker
 * vorher stoppen. Aufruf über `npm run backup:restore -- <datei>`.
 */
export async function restoreBackup(filePath: string): Promise<void> {
  const absolute = path.resolve(filePath);
  await stat(absolute); // existiert?

  const tmp = await mkdtemp(path.join(os.tmpdir(), "smartlife-restore-"));
  try {
    await run("tar", ["-xzf", absolute, "-C", tmp]);
    await stat(path.join(tmp, "db.dump")); // Plausibilitätsprüfung

    // --clean --if-exists: vorhandene Objekte werden ersetzt
    await run("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--dbname",
      env.databaseUrl,
      path.join(tmp, "db.dump"),
    ]);

    const dataDir = path.resolve(env.dataDir);
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(path.dirname(dataDir), { recursive: true });
    await run("cp", ["-a", path.join(tmp, "data"), dataDir]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
