// Provider-Schicht für alle KI-Funktionen. Zwei Backends:
//   - "anthropic" (Standard): Claude API, aktiviert über ANTHROPIC_API_KEY
//   - "openai": beliebige OpenAI-kompatible API (OpenAI, Azure OpenAI,
//     OpenRouter, LiteLLM, Ollama, vLLM, …), konfiguriert über
//     AI_BASE_URL + AI_API_KEY + AI_MODEL (AI_PROVIDER=openai optional,
//     wird bei gesetzter AI_BASE_URL automatisch gewählt).
//
// Strukturierte Ausgaben: bei Anthropic über output_config/zodOutputFormat,
// bei OpenAI über response_format json_schema — Server, die das nicht kennen
// (HTTP 400), bekommen automatisch einen zweiten Versuch ohne response_format;
// das Schema steht dafür immer zusätzlich im Systemprompt.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import * as z from "zod/v4";

export type AiProviderName = "anthropic" | "openai";

export function aiProvider(): AiProviderName {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") return explicit;
  return process.env.AI_BASE_URL ? "openai" : "anthropic";
}

export function isAiEnabled(): boolean {
  return aiProvider() === "openai"
    ? !!(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL)
    : !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel(): string {
  const model = process.env.AI_MODEL;
  if (model) return model;
  if (aiProvider() === "openai") {
    throw new Error("AI_MODEL muss für AI_PROVIDER=openai gesetzt sein");
  }
  return "claude-opus-4-8";
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

interface CompleteOptions {
  system: string;
  messages: AiMessage[];
  maxTokens: number;
}

interface StructuredOptions<T> extends CompleteOptions {
  schema: z.ZodType<T>;
  /** Name des Schemas für response_format (nur Buchstaben/Unterstriche). */
  schemaName: string;
  /** Anthropic: reduzierter Denkaufwand für einfache Aufgaben. */
  lowEffort?: boolean;
}

// ---------------------------------------------------------------------------
// Clients (lazy, gecacht)
// ---------------------------------------------------------------------------

let anthropicInstance: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicInstance) anthropicInstance = new Anthropic(); // liest ANTHROPIC_API_KEY/BASE_URL
  return anthropicInstance;
}

let openaiInstance: OpenAI | null = null;
function openai(): OpenAI {
  if (!openaiInstance) {
    const baseURL = process.env.AI_BASE_URL;
    if (!baseURL) throw new Error("AI_BASE_URL muss für AI_PROVIDER=openai gesetzt sein");
    openaiInstance = new OpenAI({ baseURL, apiKey: process.env.AI_API_KEY ?? "" });
  }
  return openaiInstance;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen (pur, testbar)
// ---------------------------------------------------------------------------

/** JSON-Objekt aus einer Modellantwort ziehen (toleriert ```-Zäune und Begleittext). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Kein JSON-Objekt in der Modellantwort gefunden");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/** JSON-Schema für response_format erzeugen ($schema-Feld stört manche Server). */
export function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function textOfAnthropic(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Freitext-Vervollständigung
// ---------------------------------------------------------------------------

export async function aiComplete(opts: CompleteOptions): Promise<string> {
  if (aiProvider() === "openai") {
    const response = await openai().chat.completions.create({
      model: aiModel(),
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system" as const, content: opts.system },
        ...opts.messages,
      ],
    });
    return (response.choices[0]?.message?.content ?? "").trim();
  }

  const response = await anthropic().messages.create({
    model: aiModel(),
    max_tokens: opts.maxTokens,
    thinking: { type: "adaptive" },
    system: opts.system,
    messages: opts.messages,
  });
  return textOfAnthropic(response);
}

// ---------------------------------------------------------------------------
// Strukturierte Vervollständigung (validiert gegen ein zod-Schema)
// ---------------------------------------------------------------------------

export async function aiCompleteStructured<T>(opts: StructuredOptions<T>): Promise<T | null> {
  if (aiProvider() === "openai") {
    return openaiStructured(opts);
  }

  const response = await anthropic().messages.parse({
    model: aiModel(),
    max_tokens: opts.maxTokens,
    output_config: {
      ...(opts.lowEffort ? { effort: "low" as const } : {}),
      format: zodOutputFormat(opts.schema),
    },
    system: opts.system,
    messages: opts.messages,
  });
  return response.parsed_output ?? null;
}

async function openaiStructured<T>(opts: StructuredOptions<T>): Promise<T | null> {
  const jsonSchema = toJsonSchema(opts.schema);
  // Schema immer auch im Systemprompt — trägt Server ohne json_schema-Support
  const system = `${opts.system}

Antworte ausschließlich mit einem einzigen JSON-Objekt nach diesem Schema, ohne weiteren Text:
${JSON.stringify(jsonSchema)}`;

  const request = {
    model: aiModel(),
    max_tokens: opts.maxTokens,
    messages: [{ role: "system" as const, content: system }, ...opts.messages],
  };

  let content: string;
  try {
    const response = await openai().chat.completions.create({
      ...request,
      response_format: {
        type: "json_schema" as const,
        json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema },
      },
    });
    content = response.choices[0]?.message?.content ?? "";
  } catch (error) {
    // Server kennt response_format json_schema nicht → ohne erneut versuchen
    if (!(error instanceof OpenAI.APIError && error.status === 400)) throw error;
    const response = await openai().chat.completions.create(request);
    content = response.choices[0]?.message?.content ?? "";
  }

  const parsed = opts.schema.safeParse(extractJsonObject(content));
  return parsed.success ? parsed.data : null;
}
