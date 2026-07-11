// Eigenständiger Claude-API-Stub für lokale UI-Tests (siehe smoke-ai.ts).
// Aufruf: npx tsx scripts/ai-stub-server.ts [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4747);

createServer(async (req, res) => {
  if (req.url?.startsWith("/v1/messages") && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);

    let text: string;
    if (request.output_config?.format) {
      text = JSON.stringify({ category: "Abrechnung", priority: "high", sentiment: "verärgert" });
    } else if (String(request.system ?? "").includes("entwirfst Antworten")) {
      text =
        "Hallo,\n\nvielen Dank für Ihre Nachricht. Wir haben Ihre Rechnung geprüft und melden uns bis morgen mit einer Korrektur.\n\n[Dieser Entwurf stammt vom lokalen Test-Stub]";
    } else {
      text =
        "Anliegen: Kunde meldet ein Problem.\nBisheriger Stand:\n- Erste Nachricht eingegangen\nOffene Punkte: Antwort des Supports steht aus.\n\n[Stub]";
    }

    res.setHeader("Content-Type", "application/json");
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
  res.statusCode = 404;
  res.end("not found");
}).listen(port, () => console.log(`Claude-API-Stub auf http://localhost:${port}`));
