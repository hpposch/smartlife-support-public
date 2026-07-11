// Wiederherstellung aus einer Backup-Datei:
//   npm run backup:restore -- backups/smartlife-backup-2026-07-11_03-00-00.tar.gz
// ACHTUNG: überschreibt Datenbank UND Datei-Ablage vollständig.
// Web und Worker vorher stoppen (docker compose stop web worker).
import readline from "node:readline/promises";
import { restoreBackup } from "../src/server/backup";

const file = process.argv[2];
if (!file) {
  console.error("Aufruf: npm run backup:restore -- <backup-datei.tar.gz>");
  process.exit(1);
}

async function main() {
  if (process.stdin.isTTY && !process.argv.includes("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Datenbank und Datei-Ablage werden durch "${file}" ERSETZT. Fortfahren? (ja/nein) `
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "ja") {
      console.log("Abgebrochen.");
      return;
    }
  }
  await restoreBackup(file);
  console.log("Wiederherstellung abgeschlossen. Web und Worker jetzt wieder starten.");
}

main().catch((error) => {
  console.error("Wiederherstellung fehlgeschlagen:", error);
  process.exit(1);
});
