// Legt Grunddaten an: Admin-Benutzer, Standard-Team, Kategorien, Textbaustein.
// Idempotent — kann beliebig oft laufen.
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const db = new PrismaClient();

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@smartlife.software").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin1234";

  // Default-Produkt (Mehrprodukt-Betrieb: weitere unter Verwaltung → Produkte)
  await db.product.upsert({
    where: { key: "smartlifebi" },
    update: {},
    create: { key: "smartlifebi", name: "smartlife BI", isDefault: true },
  });

  const team = await db.team.upsert({
    where: { name: "Support" },
    update: {},
    create: { name: "Support" },
  });

  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin",
      role: "admin",
      passwordHash: await hash(adminPassword),
    },
  });

  await db.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: admin.id } },
    update: {},
    create: { teamId: team.id, userId: admin.id },
  });

  for (const [i, name] of ["Frage", "Bug", "Abrechnung", "Sonstiges"].entries()) {
    await db.ticketCategory.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
    });
  }

  const cannedCount = await db.cannedResponse.count();
  if (cannedCount === 0) {
    await db.cannedResponse.create({
      data: {
        title: "Begrüßung",
        body: "Hallo {{contact.name}},\n\nvielen Dank für Ihre Anfrage (Ticket #{{ticket.number}}).\n\n",
        createdBy: admin.id,
      },
    });
  }

  console.log(`Seed fertig. Login: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
