// Verbindungstest für ein angebundenes Postfach: prüft IMAP-Login,
// INBOX-Zugriff und SMTP-Login, ohne etwas zu versenden oder zu verändern.
//
//   npm run mailbox:check -- support@smartlifebi.com
//
// Das Postfach muss unter Verwaltung → Postfächer angelegt sein und die
// ENV-Variable aus `credentialsRef` (z. B. MAILBOX_SUPPORT_PASSWORD) muss
// gesetzt sein.
import { ImapFlow } from "imapflow";
import { db } from "../src/lib/db";
import { mailboxPassword } from "../src/lib/env";
import { smtpTransport } from "../src/mail/mailer";

async function main() {
  const address = process.argv[2]?.toLowerCase();
  if (!address) {
    console.error("Aufruf: npm run mailbox:check -- <postfach-adresse>");
    process.exit(1);
  }

  const mailbox = await db.mailbox.findUnique({ where: { address } });
  if (!mailbox) {
    console.error(`Kein Postfach "${address}" angelegt (Verwaltung → Postfächer).`);
    process.exit(1);
  }

  let password: string;
  try {
    password = mailboxPassword(mailbox.credentialsRef);
  } catch {
    console.error(`✗ ENV-Variable ${mailbox.credentialsRef} ist nicht gesetzt.`);
    process.exit(1);
  }
  if (/\s/.test(password)) {
    console.warn(
      "⚠ Das Passwort enthält Leerzeichen — Gmail-App-Passwörter bitte OHNE die angezeigten Leerzeichen eintragen."
    );
  }

  // --- IMAP ---
  try {
    const client = new ImapFlow({
      host: mailbox.imapHost!,
      port: mailbox.imapPort!,
      secure: mailbox.imapPort === 993,
      auth: { user: mailbox.imapUser!, pass: password },
      logger: false,
    });
    await client.connect();
    const status = await client.status("INBOX", { messages: true, uidValidity: true });
    await client.logout();
    console.log(
      `✓ IMAP ok (${mailbox.imapHost}:${mailbox.imapPort}) — INBOX: ${status.messages} Nachricht(en)`
    );
  } catch (error) {
    console.error(`✗ IMAP fehlgeschlagen: ${String(error)}`);
    console.error(
      "  Gmail-Checkliste: IMAP in den Gmail-Einstellungen aktiviert? 2-Faktor-Auth an?\n" +
        "  App-Passwort (nicht das Konto-Passwort) verwendet? Host imap.gmail.com, Port 993?"
    );
    process.exitCode = 1;
  }

  // --- SMTP ---
  try {
    await smtpTransport(mailbox).verify();
    console.log(`✓ SMTP ok (${mailbox.smtpHost}:${mailbox.smtpPort}) — Login akzeptiert`);
  } catch (error) {
    console.error(`✗ SMTP fehlgeschlagen: ${String(error)}`);
    console.error("  Gmail: Host smtp.gmail.com, Port 587, gleiches App-Passwort wie IMAP.");
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    console.log("\nPostfach ist korrekt angebunden. Der Worker ruft es automatisch ab.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
