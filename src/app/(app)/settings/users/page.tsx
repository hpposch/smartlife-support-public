import { hash } from "@node-rs/argon2";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, "Mindestens 8 Zeichen"),
  role: z.enum(["agent", "team_lead", "admin"]),
});

async function createUser(formData: FormData) {
  "use server";
  await requireAdmin();
  const input = createSchema.parse({
    email: formData.get("email"),
    name: formData.get("name"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  const team = await db.team.findFirst();
  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase().trim(),
      name: input.name,
      role: input.role,
      passwordHash: await hash(input.password),
    },
  });
  if (team) {
    await db.teamMember.create({ data: { teamId: team.id, userId: user.id } });
  }
  revalidatePath("/settings/users");
}

async function toggleActive(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  if (id === admin.id) return; // sich selbst nicht aussperren
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  await db.user.update({ where: { id }, data: { isActive: !user.isActive } });
  revalidatePath("/settings/users");
}

export default async function UsersPage() {
  await requireAdmin();
  const users = await db.user.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Benutzer</h1>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">E-Mail</th>
              <th className="px-4 py-2">Rolle</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium">{user.name}</td>
                <td className="px-4 py-2 text-slate-600">{user.email}</td>
                <td className="px-4 py-2">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-2">
                  {user.isActive ? (
                    <span className="text-emerald-600">aktiv</span>
                  ) : (
                    <span className="text-slate-400">deaktiviert</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={user.id} />
                    <button type="submit" className="text-xs text-blue-700 hover:underline">
                      {user.isActive ? "Deaktivieren" : "Aktivieren"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        action={createUser}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Neuen Benutzer anlegen</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="name" required placeholder="Name" className="input" />
          <input name="email" type="email" required placeholder="E-Mail" className="input" />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Passwort (min. 8 Zeichen)"
            className="input"
          />
          <select name="role" defaultValue="agent" className="input">
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Anlegen
        </button>
      </form>
    </div>
  );
}
