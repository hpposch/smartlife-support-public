import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";

const submitSchema = z.object({
  token: z.string().min(10),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000),
});

async function submitRating(formData: FormData) {
  "use server";
  const input = submitSchema.parse({
    token: formData.get("token"),
    rating: formData.get("rating"),
    comment: formData.get("comment") ?? "",
  });
  const survey = await db.csatSurvey.findUnique({ where: { token: input.token } });
  if (!survey || survey.answeredAt) return;
  await db.csatSurvey.update({
    where: { id: survey.id },
    data: { rating: input.rating, comment: input.comment.trim() || null, answeredAt: new Date() },
  });
  revalidatePath(`/csat/${input.token}`);
}

export default async function CsatPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ rating?: string }>;
}) {
  const { token } = await params;
  const { rating } = await searchParams;
  const survey = await db.csatSurvey.findUnique({
    where: { token },
    include: { ticket: true },
  });
  if (!survey) notFound();

  const preselected = Math.min(5, Math.max(0, Number(rating) || 0));

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">SmartLife Support</h1>

        {survey.answeredAt ? (
          <p className="mt-4 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
            Vielen Dank für Ihre Bewertung!
          </p>
        ) : (
          <>
            <p className="mb-6 text-sm text-slate-500">
              Wie zufrieden waren Sie mit der Bearbeitung Ihrer Anfrage
              „{survey.ticket.subject}“ (#{survey.ticket.number})?
            </p>
            <form action={submitRating} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input
                      type="radio"
                      name="rating"
                      value={n}
                      defaultChecked={n === preselected}
                      required
                      className="peer sr-only"
                    />
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-lg font-medium peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:text-blue-700">
                      {n}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-center text-xs text-slate-400">1 = unzufrieden · 5 = sehr zufrieden</p>
              <textarea
                name="comment"
                rows={3}
                placeholder="Möchten Sie uns noch etwas mitteilen? (optional)"
                className="input"
              />
              <button type="submit" className="btn-primary w-full justify-center">
                Bewertung absenden
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
