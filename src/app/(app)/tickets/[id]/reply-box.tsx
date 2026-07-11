"use client";

import { useRef, useState, useTransition } from "react";
import { submitMessage } from "./actions";

interface CannedResponse {
  id: string;
  title: string;
  body: string;
}

export function ReplyBox({
  ticketId,
  canned,
  placeholders,
}: {
  ticketId: string;
  canned: CannedResponse[];
  placeholders: Record<string, string>;
}) {
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function insertCanned(body: string) {
    let text = body;
    for (const [key, value] of Object.entries(placeholders)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
    const el = textareaRef.current;
    if (el) {
      el.value = el.value ? `${el.value}\n${text}` : text;
      el.focus();
    }
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await submitMessage(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="kind" value={kind} />

      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setKind("reply")}
          className={`rounded-md px-3 py-1 text-sm font-medium ${
            kind === "reply" ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Antwort an Kunde
        </button>
        <button
          type="button"
          onClick={() => setKind("note")}
          className={`rounded-md px-3 py-1 text-sm font-medium ${
            kind === "note" ? "bg-amber-50 text-amber-700" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Interne Notiz
        </button>

        {canned.length > 0 && (
          <select
            className="input ml-auto w-auto"
            defaultValue=""
            onChange={(e) => {
              const item = canned.find((c) => c.id === e.target.value);
              if (item) insertCanned(item.body);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Textbaustein einfügen …
            </option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={6}
        placeholder={kind === "reply" ? "Antwort an den Kunden …" : "Interne Notiz (Kunde sieht das nicht) …"}
        className={`input font-normal ${kind === "note" ? "bg-amber-50/50" : ""}`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input type="file" name="files" multiple className="text-sm text-slate-500" />
        {kind === "reply" && (
          <select name="setStatus" defaultValue="pending_customer" className="input ml-auto w-auto">
            <option value="pending_customer">Senden → Wartet auf Kunde</option>
            <option value="resolved">Senden → Gelöst</option>
            <option value="open">Senden → Offen lassen</option>
          </select>
        )}
        <button
          type="submit"
          disabled={isPending}
          className={kind === "reply" ? "btn-primary" : "btn-secondary"}
        >
          {isPending ? "Wird gespeichert …" : kind === "reply" ? "Antwort senden" : "Notiz speichern"}
        </button>
      </div>
    </form>
  );
}
