import sanitizeHtml from "sanitize-html";

// HTML aus E-Mails wird vor dem Speichern bereinigt: keine Skripte, keine
// Formulare, kein externes Nachladen außer Bildern (die das UI zusätzlich
// erst nach Klick lädt — Tracking-Pixel-Schutz).
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "i", "u", "em", "strong", "s", "p", "br", "hr", "div", "span",
      "blockquote", "pre", "code", "ul", "ol", "li", "table", "thead", "tbody",
      "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "img",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        color: [/^.+$/],
        "background-color": [/^.+$/],
        "text-align": [/^.+$/],
        "font-weight": [/^.+$/],
        "font-style": [/^.+$/],
        "text-decoration": [/^.+$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}

/** Für Agentenantworten aus dem Editor (schmalere Whitelist). */
export function sanitizeAgentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["a", "b", "i", "u", "em", "strong", "p", "br", "blockquote", "pre", "code", "ul", "ol", "li"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`;
}
