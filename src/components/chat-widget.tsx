"use client";

// Schwebender KI-Chat-Assistent (Hilfe-Center + Kundenportal).
// Stateless gegenüber dem Server: der Verlauf lebt im Client.
import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
  html?: string;
  offerTicket?: boolean;
  suggestedSubject?: string | null;
}

const GREETING: Message = {
  role: "assistant",
  text: "Hallo! Ich bin der smartlife-Assistent. Fragen Sie mich zu smartlife BI — ich durchsuche die Wissensdatenbank. Wenn ich nicht weiterhelfen kann, erstelle ich gern ein Support-Ticket für Sie.",
};

export function ChatWidget({ loggedIn }: { loggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketForm, setTicketForm] = useState<{ subject: string } | null>(null);
  const [email, setEmail] = useState("");
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, ticketForm, ticketNumber, busy]);

  const history = messages
    .filter((m) => m !== GREETING)
    .map((m) => ({ role: m.role, text: m.text }));

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", text }].slice(-16),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Fehler");
      setMessages([
        ...next,
        {
          role: "assistant",
          text: json.data.reply,
          html: json.data.replyHtml,
          offerTicket: json.data.offerTicket,
          suggestedSubject: json.data.suggestedSubject,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Der Assistent ist gerade nicht erreichbar");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  function openTicketForm(suggested?: string | null) {
    const firstUser = messages.find((m) => m.role === "user");
    setTicketForm({
      subject: (suggested ?? firstUser?.text ?? "Anfrage aus dem Chat").slice(0, 200),
    });
  }

  async function createTicket() {
    if (!ticketForm || busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/chat/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-16),
          subject: ticketForm.subject,
          ...(loggedIn ? {} : { email }),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Fehler");
      setTicketNumber(json.data.number);
      setTicketForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticket konnte nicht erstellt werden");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
      >
        💬 Fragen? Chat-Hilfe
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">smartlife-Assistent</p>
          <p className="text-xs text-blue-100">KI-gestützt · Antworten ohne Gewähr</p>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-blue-100 hover:bg-blue-500">
          ✕
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message, index) => (
          <div key={index}>
            <div
              className={
                message.role === "user"
                  ? "ml-8 rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-sm text-white"
                  : "mr-8 rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800"
              }
            >
              {message.html ? (
                <div
                  className="chat-message [&_a]:text-blue-700 [&_a]:underline [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                  dangerouslySetInnerHTML={{ __html: message.html }}
                />
              ) : (
                <p className="whitespace-pre-wrap">{message.text}</p>
              )}
            </div>
            {message.offerTicket && !ticketNumber && !ticketForm && (
              <button
                onClick={() => openTicketForm(message.suggestedSubject)}
                className="mt-2 mr-8 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm text-blue-800 hover:bg-blue-100"
              >
                🎫 Support-Ticket mit diesem Chatverlauf erstellen
              </button>
            )}
          </div>
        ))}

        {busy && !ticketForm && (
          <p className="mr-8 w-fit rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-400">…</p>
        )}

        {ticketForm && (
          <div className="mr-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Support-Ticket erstellen</p>
            <label className="block text-xs text-slate-500">
              Betreff
              <input
                value={ticketForm.subject}
                onChange={(e) => setTicketForm({ subject: e.target.value })}
                className="input mt-1"
              />
            </label>
            {!loggedIn && (
              <label className="block text-xs text-slate-500">
                Ihre E-Mail-Adresse (für Rückmeldungen)
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ihre@email.de"
                  className="input mt-1"
                />
              </label>
            )}
            <p className="text-xs text-slate-400">Der komplette Chatverlauf wird dem Ticket beigefügt.</p>
            <div className="flex gap-2">
              <button
                onClick={createTicket}
                disabled={busy || (!loggedIn && !email.includes("@")) || ticketForm.subject.trim().length < 3}
                className="btn-primary"
              >
                {busy ? "Wird erstellt …" : "Ticket erstellen"}
              </button>
              <button onClick={() => setTicketForm(null)} className="btn-secondary">
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {ticketNumber && (
          <div className="mr-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            ✅ Ticket <strong>#{ticketNumber}</strong> wurde erstellt — der Chatverlauf ist enthalten.
            {loggedIn ? " Sie finden es unter „Meine Anfragen“." : " Sie erhalten eine Bestätigung per E-Mail."}
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ihre Frage …"
            maxLength={3000}
            className="input"
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()} className="btn-primary shrink-0">
            Senden
          </button>
        </div>
        {!ticketNumber && !ticketForm && history.length > 0 && (
          <button
            onClick={() => openTicketForm()}
            className="mt-2 text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Nicht weitergekommen? Ticket mit Chatverlauf erstellen
          </button>
        )}
      </div>
    </div>
  );
}
