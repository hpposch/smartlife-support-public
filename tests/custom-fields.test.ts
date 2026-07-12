import { describe, expect, it } from "vitest";
import type { CustomField } from "@prisma/client";
import { validateCustomFieldValues } from "../src/server/custom-fields";

const field = (over: Partial<CustomField>): CustomField => ({
  id: "f1",
  productId: "p1",
  key: "version",
  label: "Version",
  type: "text",
  options: [],
  required: false,
  sortOrder: 0,
  isActive: true,
  ...over,
});

describe("validateCustomFieldValues", () => {
  it("Pflichtfeld ohne Wert schlägt fehl", () => {
    const result = validateCustomFieldValues([field({ required: true })], {});
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Pflichtfeld");
  });

  it("Auswahl akzeptiert nur definierte Optionen", () => {
    const f = field({ type: "select", options: ["Cloud", "On-Premise"] });
    expect(validateCustomFieldValues([f], { version: "Cloud" }).ok).toBe(true);
    expect(validateCustomFieldValues([f], { version: "Anders" }).ok).toBe(false);
  });

  it("Zahlfeld validiert numerisch, Werte werden übernommen", () => {
    const f = field({ key: "anzahl", label: "Anzahl", type: "number" });
    expect(validateCustomFieldValues([f], { anzahl: "abc" }).ok).toBe(false);
    const ok = validateCustomFieldValues([f], { anzahl: "42" });
    expect(ok.ok).toBe(true);
    expect(ok.values).toEqual({ anzahl: "42" });
  });

  it("unbekannte Schlüssel werden ignoriert", () => {
    const result = validateCustomFieldValues([field({})], { fremd: "x" });
    expect(result.values).toEqual({});
  });
});
