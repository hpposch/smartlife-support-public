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

/**
 * Kontakt für ein Azure-AD-B2C-Konto auflösen:
 * 1. bereits verknüpft (azure_b2c_id) → dieser Kontakt
 * 2. E-Mail bekannt (z. B. aus früheren E-Mail-Tickets) → Konto verknüpfen
 * 3. sonst neuen Kontakt anlegen (inkl. Organisations-Zuordnung per Domain)
 */
export async function findOrCreateB2cContact(
  db: PrismaClient,
  profile: { objectId: string; email: string; name: string | null }
) {
  const linked = await db.contact.findUnique({ where: { azureB2cId: profile.objectId } });
  if (linked) {
    // E-Mail-Änderung in B2C nachziehen, sofern die neue Adresse frei ist
    if (linked.email !== profile.email) {
      const emailTaken = await db.contact.findUnique({ where: { email: profile.email } });
      if (!emailTaken) {
        return db.contact.update({
          where: { id: linked.id },
          data: { email: profile.email, name: linked.name ?? profile.name },
        });
      }
    }
    return linked;
  }

  const contact = await findOrCreateContact(db, profile.email, profile.name);
  return db.contact.update({
    where: { id: contact.id },
    data: { azureB2cId: profile.objectId },
  });
}
