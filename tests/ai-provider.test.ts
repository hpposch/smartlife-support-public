import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/v4";
import {
  aiModel,
  aiProvider,
  extractJsonObject,
  isAiEnabled,
  toJsonSchema,
} from "../src/server/ai-provider";

const AI_VARS = ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "ANTHROPIC_API_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(AI_VARS.map((k) => [k, process.env[k]]));
  for (const k of AI_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of AI_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("aiProvider / isAiEnabled", () => {
  it("Standard ist anthropic, aktiviert über ANTHROPIC_API_KEY", () => {
    expect(aiProvider()).toBe("anthropic");
    expect(isAiEnabled()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(isAiEnabled()).toBe(true);
    expect(aiModel()).toBe("claude-opus-4-8");
  });

  it("AI_BASE_URL wählt automatisch openai", () => {
    process.env.AI_BASE_URL = "http://localhost:11434/v1";
    expect(aiProvider()).toBe("openai");
    expect(isAiEnabled()).toBe(false); // Key + Modell fehlen noch
    process.env.AI_API_KEY = "sk-x";
    process.env.AI_MODEL = "llama3";
    expect(isAiEnabled()).toBe(true);
    expect(aiModel()).toBe("llama3");
  });

  it("AI_PROVIDER hat Vorrang vor der Auto-Erkennung", () => {
    process.env.AI_BASE_URL = "http://localhost:11434/v1";
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(aiProvider()).toBe("anthropic");
    expect(isAiEnabled()).toBe(true);
  });

  it("openai ohne AI_MODEL: nicht aktiviert, aiModel wirft", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_API_KEY = "sk-x";
    expect(isAiEnabled()).toBe(false);
    expect(() => aiModel()).toThrow(/AI_MODEL/);
  });
});

describe("extractJsonObject", () => {
  it("parst reines JSON", () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it("toleriert Markdown-Zäune und Begleittext", () => {
    const text = 'Hier ist das Ergebnis:\n```json\n{"reply": "Hallo", "ok": true}\n```\nFertig.';
    expect(extractJsonObject(text)).toEqual({ reply: "Hallo", ok: true });
  });

  it("wirft bei Antworten ohne JSON-Objekt", () => {
    expect(() => extractJsonObject("keine strukturierte Antwort")).toThrow();
  });
});

describe("toJsonSchema", () => {
  it("erzeugt striktes Schema ohne $schema-Feld", () => {
    const schema = toJsonSchema(
      z.object({ reply: z.string(), subject: z.string().nullable() })
    );
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["reply", "subject"]);
  });
});
