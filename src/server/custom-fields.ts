// Produktspezifische Custom Fields: Definitionen laden und Eingaben validieren.
import type { CustomField } from "@prisma/client";
import { db } from "@/lib/db";

export async function fieldsForProduct(productId: string): Promise<CustomField[]> {
  return db.customField.findMany({
    where: { productId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

export interface FieldValidation {
  ok: boolean;
  values: Record<string, string>;
  errors: string[];
}

/** Eingaben gegen die Felddefinitionen prüfen (Pflicht, Auswahl, Zahl). */
export function validateCustomFieldValues(
  fields: CustomField[],
  input: Record<string, unknown>
): FieldValidation {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const field of fields) {
    const raw = String(input[field.key] ?? "").trim().slice(0, 500);
    if (!raw) {
      if (field.required) errors.push(`„${field.label}“ ist ein Pflichtfeld`);
      continue;
    }
    if (field.type === "select" && !field.options.includes(raw)) {
      errors.push(`„${field.label}“: ungültige Auswahl`);
      continue;
    }
    if (field.type === "number" && Number.isNaN(Number(raw))) {
      errors.push(`„${field.label}“ muss eine Zahl sein`);
      continue;
    }
    values[field.key] = raw;
  }
  return { ok: errors.length === 0, values, errors };
}
