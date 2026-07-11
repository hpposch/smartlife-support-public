// Manuelles Backup: npm run backup:create
// Ergebnis: eine .tar.gz-Datei in BACKUP_DIR (Standard ./backups)
import { createBackup, backupDir } from "../src/server/backup";

createBackup()
  .then((info) => {
    console.log(`Backup erstellt: ${backupDir()}/${info.fileName}`);
    console.log(`Größe: ${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
  })
  .catch((error) => {
    console.error("Backup fehlgeschlagen:", error);
    process.exit(1);
  });
