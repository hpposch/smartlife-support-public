import nodemailer, { type Transporter } from "nodemailer";
import type { Mailbox } from "@prisma/client";
import { mailboxPassword } from "@/lib/env";

const transports = new Map<string, Transporter>();

export function smtpTransport(mailbox: Mailbox): Transporter {
  const cached = transports.get(mailbox.id);
  if (cached) return cached;

  if (!mailbox.smtpHost || !mailbox.smtpPort || !mailbox.smtpUser) {
    throw new Error(`Mailbox ${mailbox.address}: SMTP nicht konfiguriert`);
  }
  const transport = nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpPort === 465,
    // Auf 587 (z. B. Gmail) TLS-Upgrade erzwingen — nie unverschlüsselt senden
    requireTLS: mailbox.smtpPort !== 465,
    auth: { user: mailbox.smtpUser, pass: mailboxPassword(mailbox.credentialsRef) },
  });
  transports.set(mailbox.id, transport);
  return transport;
}
