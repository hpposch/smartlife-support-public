import { describe, expect, it } from "vitest";
import {
  categoryName,
  extractTitle,
  rebrand,
  rewriteExternalUrls,
  rewriteLinks,
  slugForPath,
  splitFrontMatter,
} from "../scripts/import-boldbi-docs";

describe("splitFrontMatter", () => {
  it("trennt Frontmatter und Body", () => {
    const { meta, body } = splitFrontMatter(`---\ntitle: Test | Bold BI Docs\ncanonical: "/a/b/"\n---\n# Hi\nText`);
    expect(meta.title).toBe("Test | Bold BI Docs");
    expect(meta.canonical).toBe("/a/b/");
    expect(body).toBe("# Hi\nText");
  });

  it("kommt ohne Frontmatter klar", () => {
    expect(splitFrontMatter("# Nur Text").body).toBe("# Nur Text");
  });
});

describe("extractTitle", () => {
  it("bevorzugt die erste H1", () => {
    expect(extractTitle({ title: "SEO | Bold BI" }, "Intro\n# Echter Titel\n")).toBe("Echter Titel");
  });

  it("nimmt sonst den Frontmatter-Titel ohne SEO-Suffix", () => {
    expect(extractTitle({ title: "Editing – Embedded BI | Bold BI Documentation" }, "kein h1")).toBe(
      "Editing – Embedded BI"
    );
  });
});

describe("rebrand", () => {
  it("ersetzt Bold BI und Syncfusion in allen Schreibweisen", () => {
    expect(rebrand("Bold BI und BOLD BI und bold bi")).toBe(
      "smartlife BI und smartlife BI und smartlife BI"
    );
    expect(rebrand("Syncfusion bietet SYNCFUSION-Support")).toBe("smartlife bietet smartlife-Support");
  });

  it("lässt technische Bezeichner unangetastet", () => {
    expect(rebrand("https://cdn.boldbi.com/embedded-sdk/boldbi-embed.js")).toBe(
      "https://cdn.boldbi.com/embedded-sdk/boldbi-embed.js"
    );
  });
});

describe("slugForPath / categoryName", () => {
  it("erzeugt stabile, eindeutige Slugs", () => {
    const a = slugForPath("docs/working-with-dashboards/edit.md");
    expect(a).toMatch(/^working-with-dashboards-edit-[0-9a-f]{6}$/);
    expect(slugForPath("docs/working-with-dashboards/edit.md")).toBe(a);
    expect(slugForPath("docs/other/edit.md")).not.toBe(a);
  });

  it("leitet die Kategorie aus dem obersten Ordner ab", () => {
    expect(categoryName("docs/working-with-data-sources/x/y.md")).toBe("Working With Data Sources");
    expect(categoryName("api/server-api-reference/v4.md")).toBe("Server Api Reference");
  });

  it("rebrandet Kategorienamen und fängt Root-Dateien ab", () => {
    expect(categoryName("docs/deploying-bold-bi/x.md")).toBe("Deploying smartlife BI");
    expect(categoryName("docs/white-labeling-in-bold-bi.md")).toBe("Allgemein");
  });
});

describe("rewriteLinks", () => {
  const linkMap = new Map([["/getting-started/creating-dashboard", "getting-started-creating-dashboard-abc123"]]);

  it("schreibt Bilder auf /kb-assets um und sammelt sie", () => {
    const assets: string[] = [];
    const out = rewriteLinks(
      "![Bild](/static/assets/foo/images/a.png#width=60%) und <img src=\"/static/assets/b.png\">",
      linkMap,
      (a) => assets.push(a)
    );
    expect(out).toContain("](/kb-assets/foo/images/a.png)");
    expect(out).not.toContain("#width");
    expect(out).toContain('src="/kb-assets/b.png"');
    expect(assets).toEqual(["/static/assets/foo/images/a.png", "/static/assets/b.png"]);
  });

  it("schreibt bekannte interne Links auf KB-Artikel um, unbekannte bleiben", () => {
    const out = rewriteLinks(
      "[a](/getting-started/creating-dashboard/) [b](/getting-started/creating-dashboard/#anker) [c](/unbekannt/pfad/)",
      linkMap,
      () => {}
    );
    expect(out).toContain("](/kb/getting-started-creating-dashboard-abc123)");
    expect(out).toContain("](/kb/getting-started-creating-dashboard-abc123#anker)");
    expect(out).toContain("](/unbekannt/pfad/)");
  });
});

describe("rewriteExternalUrls", () => {
  const linkMap = new Map([["/working-with-dashboards/edit", "working-with-dashboards-edit-abc123"]]);

  it("mappt help.boldbi.com auf KB-Artikel", () => {
    expect(
      rewriteExternalUrls("[a](https://help.boldbi.com/working-with-dashboards/edit/)", linkMap)
    ).toBe("[a](/kb/working-with-dashboards-edit-abc123)");
  });

  it("lässt unbekannte help-Pfade stehen, mappt support/www/syncfusion", () => {
    const out = rewriteExternalUrls(
      "[a](https://help.boldbi.com/unbekannt/) [b](https://support.boldbi.com/kb/article/123/x) [c](https://www.boldbi.com/pricing) [d](https://help.syncfusion.com/lizenz)",
      linkMap
    );
    expect(out).toContain("https://help.boldbi.com/unbekannt/");
    expect(out).toContain("](/kb)");
    expect(out).toContain("](https://www.smartlifebi.com)");
    expect(out).not.toContain("syncfusion");
  });

  it("lässt cdn.boldbi.com unangetastet", () => {
    expect(
      rewriteExternalUrls("https://cdn.boldbi.com/embedded-sdk/v10/boldbi-embed.js", linkMap)
    ).toContain("cdn.boldbi.com");
  });
});
