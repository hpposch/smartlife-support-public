import { describe, expect, it } from "vitest";
import { renderMarkdown, slugify } from "../src/lib/markdown";

describe("slugify", () => {
  it("wandelt Umlaute und Sonderzeichen", () => {
    expect(slugify("SLA & Fristen (Übersicht)")).toBe("sla-fristen-uebersicht");
    expect(slugify("Größe ändern")).toBe("groesse-aendern");
  });

  it("hat einen Fallback bei leerem Ergebnis", () => {
    expect(slugify("???")).toBe("artikel");
  });

  it("begrenzt die Länge", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("renderMarkdown", () => {
  it("rendert Überschriften, Listen und Code", () => {
    const html = renderMarkdown("# Titel\n\n- eins\n- zwei\n\n`code`");
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain("<li>eins</li>");
    expect(html).toContain("<code>code</code>");
  });

  it("entfernt Skripte und Event-Handler", () => {
    const html = renderMarkdown('Hallo <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
  });

  it("blockt javascript:-Links", () => {
    const html = renderMarkdown("[klick](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});
