// Prompts and JSON schemas. The same schema is used two ways:
//   - on-device: Chrome Prompt API `responseConstraint` (plain JSON Schema)
//   - cloud: Gemini `responseSchema` (OpenAPI-style subset; enums need format "enum")
// Prompts are short and the schemas small on purpose: Gemini Nano has a
// 9,216-token request limit and is a small model.

export const FACT_TYPES = ['who', 'what', 'where', 'price', 'hours', 'date', 'proof', 'contact'] as const;
export type FactType = (typeof FACT_TYPES)[number];

export interface Fact {
  type: FactType;
  value: string;
  quote: string;
  clear: boolean;
}

export interface VagueClaim {
  text: string;
  fix: string;
}

export interface FactsResult {
  name: string;
  category: string;
  facts: Fact[];
  vague: VagueClaim[];
}

export interface QA {
  question: string;
  answer: string;
  missing: boolean;
}

export interface KitResult {
  summary: string;
  questions: QA[];
}

type JsonSchema = Record<string, unknown>;

export const FACTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...FACT_TYPES] },
          value: { type: 'string' },
          quote: { type: 'string' },
          clear: { type: 'boolean' },
        },
        required: ['type', 'value', 'quote', 'clear'],
      },
    },
    vague: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, fix: { type: 'string' } },
        required: ['text', 'fix'],
      },
    },
  },
  required: ['name', 'category', 'facts', 'vague'],
};

export const KIT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          missing: { type: 'boolean' },
        },
        required: ['question', 'answer', 'missing'],
      },
    },
  },
  required: ['summary', 'questions'],
};

/** Gemini cloud schemas want `format: "enum"` next to `enum`. */
export function toCloudSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toCloudSchema);
  if (s && typeof s === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) o[k] = toCloudSchema(v);
    if (Array.isArray(o.enum) && o.type === 'string' && !o.format) o.format = 'enum';
    return o;
  }
  return s;
}

export const FACTS_SYSTEM = `You audit web page text for how easily an AI assistant could quote it.
Extract only facts that are written in the text. Never invent facts.
Fact types: who (business or person name), what (what it is or sells), where (address, area, online-only), price, hours (opening hours or availability), date (events, offers, deadlines), proof (numbers, awards, credentials, reviews), contact (phone, email, booking link).
For each fact give: type, a short value, the exact quote copied from the text, and clear=false if it is vague.
clear=true only for specifics a customer could act on: an exact price or range, named days with times, a street address or named area, a date, a number or named credential, a phone/email/link. Things like "affordable", "soon", "every morning", "near the park", "flexible hours" are clear=false.
Also list vague marketing claims an assistant could not repeat as fact, each with a one-line fix.
Placeholders like [email] or [phone] mean the original text contained that item.
Reply with JSON only.`;

export function factsPrompt(text: string, part?: { index: number; total: number }): string {
  const header = part ? `This is part ${part.index} of ${part.total} of one page.\n` : '';
  return `${header}PAGE TEXT:\n"""\n${text}\n"""\nReturn JSON with name, category, facts, vague.`;
}

export const KIT_SYSTEM = `You write the "answer kit" a business should publish so AI assistants can answer questions about it.
Use ONLY the facts provided. Facts marked VAGUE are not good enough to state; treat them like missing facts.
If a fact is missing or vague, do not guess: write the answer as a fill-in template in square brackets, for example "[add opening hours, e.g. Mon-Sat 8am-6pm]", and set missing=true.
summary: 2 or 3 sentences, answer-first, starting with the name and what it is, under 60 words.
questions: exactly 5 questions real customers would ask an AI assistant about this business, each with a short answer.
Reply with JSON only.`;

export function kitPrompt(f: FactsResult, missingTypes: string[]): string {
  const facts = f.facts.map((x) => `- ${x.type}: ${x.value}${x.clear ? '' : ' (VAGUE)'}`).join('\n');
  return `NAME: ${f.name || '(not found)'}
CATEGORY: ${f.category || '(not found)'}
FACTS:
${facts || '- (none found)'}
MISSING: ${missingTypes.length ? missingTypes.join(', ') : 'none'}
Return JSON with summary and questions.`;
}
