import type { PrismaClient } from "@prisma/client";

export function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Findet einen Contact per E-Mail oder legt ihn an. Neue Kontakte werden
 * anhand ihrer E-Mail-Domain automatisch einer Organisation zugeordnet.
 */
export async function findOrCreateContact(
  db: PrismaClient,
  email: string,
  name?: string | null
) {
  const normalized = email.toLowerCase().trim();
  const existing = await db.contact.findUnique({ where: { email: normalized } });
  if (existing) {
    // Namen nachtragen, wenn wir erstmals einen haben
    if (!existing.name && name) {
      return db.contact.update({ where: { id: existing.id }, data: { name } });
    }
    return existing;
  }

  const domain = extractDomain(normalized);
  const organization = domain
    ? await db.organization.findFirst({ where: { domains: { has: domain } } })
    : null;

  return db.contact.create({
    data: {
      email: normalized,
      name: name || null,
      organizationId: organization?.id ?? null,
    },
  });
}
