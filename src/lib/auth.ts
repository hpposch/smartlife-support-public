import "server-only";
import { verify } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { getSession } from "./session";

export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.isActive) return null;
  return user;
});

/** Für Seiten/Aktionen, die einen eingeloggten Agenten voraussetzen. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/tickets");
  return user;
}

/** Für Berichte: Teamleitung oder Admin. */
export async function requireLead() {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "team_lead") redirect("/tickets");
  return user;
}

export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive || !user.passwordHash) return null;
  const ok = await verify(user.passwordHash, password);
  return ok ? user : null;
}
