// Eigenständiger KI-API-Stub für lokale UI-Tests (siehe smoke-ai.ts).
// Bedient beide Provider-Formate:
//   POST /v1/messages          — Claude API (Anthropic)
//   POST /v1/chat/completions  — OpenAI-kompatible API
// Aufruf: npx tsx scripts/ai-stub-server.ts [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4747);

/** Gemeinsame Antwortlogik beider Endpunkte. */
function decideText(system: string, lastUserText: string, structured: boolean): string {
  if (system.includes("Chat-Assistent")) {
    const wantsHelp = /problem|fehler|funktioniert nicht|hilfe/.test(lastUserText.toLowerCase());
    return JSON.stringify(
      wantsHelp
        ? {
            reply:
              "Das klingt nach einem Problem in Ihrer Umgebung — das prüft am besten unser Support-Team. Soll ich ein Ticket mit unserem Chatverlauf erstellen? [Stub]",
            offer_ticket: true,
            suggested_subject: "Problem mit Dashboard-Anzeige",
          }
        : {
            reply:
              "Ein Dashboard erstellen Sie über den Designer — die Schritte stehen im Artikel [Create Dashboard](/kb/getting-started-creating-dashboard-000000). [Stub]",
            offer_ticket: false,
            suggested_subject: null,
          }
    );
  }
  if (system.includes("destillierst")) {
    return JSON.stringify({
      title: "Rechnungskorrektur anfordern",
      body_markdown: "## Problem\n\nEine Rechnung ist fehlerhaft.\n\n## Lösung\n\n1. Support kontaktieren\n2. Korrektur abwarten\n\n[Stub]",
    });
  }
  if (structured) {
    return JSON.stringify({ category: "Abrechnung", priority: "high", sentiment: "verärgert" });
  }
  if (system.includes("entwirfst Antworten")) {
    return "Hallo,\n\nvielen Dank für Ihre Nachricht. Wir haben Ihre Rechnung geprüft und melden uns bis morgen mit einer Korrektur.\n\n[Dieser Entwurf stammt vom lokalen Test-Stub]";
  }
  return "Anliegen: Kunde meldet ein Problem.\nBisheriger Stand:\n- Erste Nachricht eingegangen\nOffene Punkte: Antwort des Supports steht aus.\n\n[Stub]";
}

createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  res.setHeader("Content-Type", "application/json");

  if (req.url?.startsWith("/v1/messages")) {
    // Claude-API-Format
    const lastUser = [...(request.messages ?? [])]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
    const text = decideText(
      String(request.system ?? ""),
      JSON.stringify(lastUser?.content ?? ""),
      !!request.output_config?.format
    );
    res.end(
      JSON.stringify({
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: request.model,
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    );
    return;
  }

  if (req.url?.startsWith("/v1/embeddings")) {
    // Deterministische Bag-of-Words-Vektoren (32 Dimensionen): Texte mit
    // gemeinsamen Wörtern bekommen ähnliche Vektoren — genug, um die
    // semantische Such-Pipeline realistisch zu testen.
    const inputs: string[] = Array.isArray(request.input) ? request.input : [request.input];
    const data = inputs.map((text, index) => {
      const vector = new Array(32).fill(0);
      for (const word of String(text).toLowerCase().split(/\W+/)) {
        if (word.length < 3) continue;
        let hash = 0;
        for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) % 32;
        vector[hash] += 1;
      }
      return { object: "embedding", index, embedding: vector };
    });
    res.end(
      JSON.stringify({
        object: "list",
        data,
        model: request.model,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      })
    );
    return;
  }

  if (req.url?.startsWith("/v1/chat/completions")) {
    // OpenAI-kompatibles Format
    const messages: { role: string; content: string }[] = request.messages ?? [];
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = decideText(system, String(lastUser?.content ?? ""), !!request.response_format);
    res.end(
      JSON.stringify({
        id: "chatcmpl-stub",
        object: "chat.completion",
        created: 0,
        model: request.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      })
    );
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "not found" } }));
}).listen(port, () => console.log(`KI-API-Stub (Claude + OpenAI-Format) auf http://localhost:${port}`));
