import { describe, expect, it } from "vitest";
import { clampConversation, extractKeywords } from "../src/server/ai";

describe("extractKeywords", () => {
  it("extrahiert relevante Begriffe und filtert Stoppwörter", () => {
    const kw = extractKeywords("Frage zur Rechnung für meine Lizenz");
    expect(kw).toContain("rechnung");
    expect(kw).toContain("lizenz");
    expect(kw).not.toContain("frage");
    expect(kw).not.toContain("meine");
  });

  it("dedupliziert und begrenzt", () => {
    const kw = extractKeywords("backup backup backup restore restore export import update problem", 3);
    expect(kw.length).toBeLessThanOrEqual(3);
    expect(new Set(kw).size).toBe(kw.length);
  });

  it("kommt mit Sonderzeichen klar", () => {
    expect(extractKeywords("Re: [EXTERN] Passwort-Reset!!!")).toContain("passwort-reset");
  });
});

describe("clampConversation", () => {
  it("begrenzt Anzahl und Länge", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      role: "KUNDE",
      text: "x".repeat(10_000) + i,
    }));
    const clamped = clampConversation(entries, 20, 4000);
    expect(clamped.length).toBe(20);
    expect(clamped[0].text.length).toBeLessThanOrEqual(4000 + 20);
    expect(clamped[0].text).toContain("…[gekürzt]");
  });

  it("lässt kurze Verläufe unverändert", () => {
    const entries = [{ role: "KUNDE", text: "Hallo" }];
    expect(clampConversation(entries)).toEqual(entries);
  });
});
