// Produkt-Auflösung für den Mehrprodukt-Betrieb: Das Portal (und Hilfe-Center)
// wählt das Produkt anhand der aufgerufenen Domain (Host-Header); ohne Treffer
// gilt das Default-Produkt. Die Agenten-Oberfläche ist produktübergreifend.
import { cache } from "react";
import type { Product } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";

/** Default-Produkt (Fallback, wenn keine Domain zugeordnet ist). */
export async function defaultProduct(): Promise<Product> {
  const product =
    (await db.product.findFirst({ where: { isDefault: true } })) ??
    (await db.product.findFirst({ orderBy: { key: "asc" } }));
  if (!product) throw new Error("Kein Produkt angelegt — Seed ausführen");
  return product;
}

/** Produkt zu einem Host-Header (ohne Port), sonst Default-Produkt. */
export async function productForHost(host: string | null | undefined): Promise<Product> {
  const domain = host?.split(":")[0].trim().toLowerCase();
  if (domain) {
    const product = await db.product.findUnique({ where: { domain } });
    if (product) return product;
  }
  return defaultProduct();
}

/** Produkt der aktuellen Anfrage (Server Components/Actions, pro Request gecacht). */
export const currentProduct = cache(async (): Promise<Product> => {
  // Lazy-Import: dieses Modul wird auch vom Worker (außerhalb Next.js) geladen
  const { headers } = await import("next/headers");
  return productForHost((await headers()).get("host"));
});

/** Basis-URL für Kunden-Links (Portal, CSAT) eines Produkts. */
export function productPortalUrl(product: Product): string {
  return (product.portalUrl ?? env.appUrl).replace(/\/$/, "");
}

/** Akzent-/Hero-Farbe des Produkts (Fallback: bisheriges Blau). */
export const DEFAULT_ACCENT = "#2563eb";

export function productAccent(product: Product): string {
  const color = product.accentColor?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
}

/** URL des hochgeladenen Produkt-Logos (oder null). */
export function productLogoUrl(product: Product): string | null {
  return product.logoKey ? `/${product.logoKey}` : null;
}

/** Browser-Titel des Produkts (Tab-Name); leer = "<Name> Support". */
export function productTitle(product: Product): string {
  return product.portalTitle?.trim() || `${product.name} Support`;
}

/** Next-Metadata (Titel + Favicon) für kundenseitige Seiten eines Produkts. */
export function productMetadata(product: Product): {
  title: string;
  icons?: { icon: string };
} {
  return {
    title: productTitle(product),
    ...(product.faviconKey ? { icons: { icon: `/${product.faviconKey}` } } : {}),
  };
}
