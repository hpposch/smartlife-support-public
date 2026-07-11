import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Markdown → bereinigtes HTML für Wissensdatenbank-Artikel. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true });
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
      code: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

/** URL-Slug aus einem Titel: "SLA & Fristen (2026)" → "sla-fristen-2026" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artikel";
}
