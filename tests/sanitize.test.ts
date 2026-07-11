import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeEmailHtml, textToHtml } from "../src/lib/sanitize";

describe("sanitizeEmailHtml", () => {
  it("entfernt Skripte und Event-Handler", () => {
    const dirty = `<p onclick="x()">Hi</p><script>alert(1)</script><img src="x" onerror="y()">`;
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("Hi");
  });

  it("erlaubt übliche Formatierung und erzwingt sichere Links", () => {
    const clean = sanitizeEmailHtml(`<a href="https://example.com">Link</a><b>fett</b>`);
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain("<b>fett</b>");
  });

  it("blockt javascript:-URLs", () => {
    expect(sanitizeEmailHtml(`<a href="javascript:alert(1)">x</a>`)).not.toContain("javascript:");
  });
});

describe("textToHtml / htmlToText", () => {
  it("escaped HTML in Klartext", () => {
    expect(textToHtml("<b>hi</b>")).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("wandelt Absätze und Umbrüche", () => {
    expect(textToHtml("a\n\nb\nc")).toBe("<p>a</p><p>b<br/>c</p>");
  });

  it("extrahiert Text aus HTML", () => {
    expect(htmlToText("<p>Hallo <b>Welt</b></p>")).toBe("Hallo Welt");
  });
});
