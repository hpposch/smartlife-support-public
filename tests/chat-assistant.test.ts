import { describe, expect, it } from "vitest";
import { clampChat, formatTranscript, CHAT_LIMITS } from "../src/server/chat-assistant";

describe("clampChat", () => {
  it("begrenzt Anzahl und Länge", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: "x".repeat(10_000),
    }));
    const clamped = clampChat(history);
    expect(clamped.length).toBe(CHAT_LIMITS.maxMessages);
    expect(clamped[0].text.length).toBe(CHAT_LIMITS.maxChars);
  });
});

describe("formatTranscript", () => {
  it("formatiert den Verlauf mit Rollen", () => {
    const transcript = formatTranscript([
      { role: "user", text: "Wie exportiere ich ein Dashboard?" },
      { role: "assistant", text: "Über das Export-Menü …" },
      { role: "user", text: "Der Export bricht ab." },
    ]);
    expect(transcript).toContain("Chatverlauf");
    expect(transcript).toContain("Kunde: Wie exportiere ich ein Dashboard?");
    expect(transcript).toContain("Assistent: Über das Export-Menü …");
    expect(transcript.indexOf("Kunde:")).toBeLessThan(transcript.indexOf("Assistent:"));
  });
});
