// Turns model output + local signals into a readiness checklist.
// Every check is explainable: it passes because of a quoted fact or a local
// pattern match, and the UI shows which. No opaque score.

import { FACT_TYPES, type Fact, type FactType, type FactsResult, type KitResult } from './prompts';
import { hasSignal, normalise, quoteFound, type LocalAnalysis } from './rules';

export interface VerifiedFact extends Fact {
  verified: boolean;
}

export interface CheckItem {
  id: string;
  label: string;
  pass: boolean;
  evidence: string;
  fix: string;
}

export function emptyFacts(): FactsResult {
  return { name: '', category: '', facts: [], vague: [] };
}

/** Coerce whatever the model returned into a FactsResult (small models drift). */
export function coerceFacts(raw: unknown): FactsResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const facts = Array.isArray(o.facts) ? o.facts : [];
  const vague = Array.isArray(o.vague) ? o.vague : [];
  return {
    name: typeof o.name === 'string' ? o.name.trim() : '',
    category: typeof o.category === 'string' ? o.category.trim() : '',
    facts: facts
      .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
      .filter((f) => typeof f.type === 'string' && (FACT_TYPES as readonly string[]).includes(String(f.type).toLowerCase()))
      .map((f) => ({
        type: String(f.type).toLowerCase() as FactType,
        value: String(f.value ?? '').trim(),
        quote: String(f.quote ?? '').trim(),
        clear: f.clear !== false,
      }))
      .filter((f) => f.value.length > 0),
    vague: vague
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {}))
      .map((v) => ({ text: String(v.text ?? '').trim(), fix: String(v.fix ?? '').trim() }))
      .filter((v) => v.text.length > 0),
  };
}

export function coerceKit(raw: unknown): KitResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const qs = Array.isArray(o.questions) ? o.questions : [];
  return {
    summary: typeof o.summary === 'string' ? o.summary.trim() : '',
    questions: qs
      .map((q) => (q && typeof q === 'object' ? (q as Record<string, unknown>) : {}))
      .map((q) => ({
        question: String(q.question ?? '').trim(),
        answer: String(q.answer ?? '').trim(),
        missing: q.missing === true || /\[[^\]]+\]/.test(String(q.answer ?? '')),
      }))
      .filter((q) => q.question.length > 0)
      .slice(0, 5),
  };
}

/** Merge per-chunk results of a long draft. */
export function mergeFacts(parts: FactsResult[]): FactsResult {
  const out = emptyFacts();
  const seen = new Set<string>();
  const seenVague = new Set<string>();
  for (const p of parts) {
    if (!out.name && p.name) out.name = p.name;
    if (!out.category && p.category) out.category = p.category;
    for (const f of p.facts) {
      const k = `${f.type}:${normalise(f.value)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.facts.push(f);
    }
    for (const v of p.vague) {
      const k = normalise(v.text);
      if (seenVague.has(k)) continue;
      seenVague.add(k);
      out.vague.push(v);
    }
  }
  return out;
}

/** Mark facts whose quote cannot be found in the source as unverified. */
export function verifyFacts(source: string, f: FactsResult): VerifiedFact[] {
  return f.facts.map((x) => ({
    ...x,
    verified: quoteFound(source, x.quote) || quoteFound(source, x.value),
  }));
}

/** A fact counts only if it is in the text AND specific. Vague facts don't. */
export function counts(f: VerifiedFact): boolean {
  return f.verified && f.clear;
}

export function missingTypes(facts: VerifiedFact[], local: LocalAnalysis): FactType[] {
  const has = (t: FactType) => facts.some((f) => f.type === t && counts(f));
  const core: FactType[] = ['who', 'what', 'where', 'price', 'hours', 'proof', 'contact'];
  return core.filter((t) => {
    if (has(t)) return false;
    if (t === 'price' && hasSignal(local, 'price')) return false;
    if (t === 'hours' && hasSignal(local, 'hours')) return false;
    if (t === 'where' && hasSignal(local, 'address')) return false;
    if (t === 'proof' && hasSignal(local, 'proof')) return false;
    if (t === 'contact' && (hasSignal(local, 'phone') || hasSignal(local, 'email') || hasSignal(local, 'url'))) return false;
    return true;
  });
}

function firstVerified(facts: VerifiedFact[], t: FactType): VerifiedFact | undefined {
  return facts.find((f) => f.type === t && counts(f));
}

function firstVague(facts: VerifiedFact[], t: FactType): VerifiedFact | undefined {
  return facts.find((f) => f.type === t && f.verified && !f.clear);
}

export function buildChecklist(
  source: string,
  name: string,
  facts: VerifiedFact[],
  local: LocalAnalysis,
  vagueCount: number,
  kit: KitResult | null,
): CheckItem[] {
  const ev = (t: FactType) => {
    const f = firstVerified(facts, t);
    if (f) return `"${f.quote || f.value}"`;
    const v = firstVague(facts, t);
    return v ? `Only vague: "${v.quote || v.value}"` : '';
  };
  const signal = (t: Parameters<typeof hasSignal>[1]) => local.signals.find((s) => s.type === t)?.match ?? '';
  const early = name ? normalise(source.slice(0, 240)).includes(normalise(name)) : false;

  const items: CheckItem[] = [
    {
      id: 'who',
      label: 'Name appears in the opening lines',
      pass: early,
      evidence: early ? `"${name}" is in the first 240 characters` : name ? `"${name}" only appears later` : 'No business or product name found',
      fix: 'Open with the name and what it is, e.g. "Name is a [category] in [area]."',
    },
    {
      id: 'what',
      label: 'Says what it is or sells',
      pass: !!firstVerified(facts, 'what'),
      evidence: ev('what') || 'No clear description found',
      fix: 'Add one sentence stating the category and main offer.',
    },
    {
      id: 'where',
      label: 'Location or service area',
      pass: !!firstVerified(facts, 'where') || hasSignal(local, 'address'),
      evidence: ev('where') || signal('address') || 'No address or area found',
      fix: 'Add the full address, or say "online only" / the areas you serve.',
    },
    {
      id: 'price',
      label: 'Price or starting price',
      pass: !!firstVerified(facts, 'price') || hasSignal(local, 'price'),
      evidence: ev('price') || signal('price') || 'No price found',
      fix: 'Add a price, range or "from" price. Assistants answer "how much" questions first.',
    },
    {
      id: 'hours',
      label: 'Opening hours or availability',
      pass: !!firstVerified(facts, 'hours') || hasSignal(local, 'hours'),
      evidence: ev('hours') || signal('hours') || 'No hours found',
      fix: 'List the days and hours, or how fast you respond / deliver.',
    },
    {
      id: 'proof',
      label: 'Checkable proof',
      pass: !!firstVerified(facts, 'proof') || hasSignal(local, 'proof'),
      evidence: ev('proof') || signal('proof') || 'No numbers, awards or credentials found',
      fix: 'Add something checkable: years operating, a licence, an award, a review rating with its source.',
    },
    {
      id: 'contact',
      label: 'A way to contact or book',
      pass: !!firstVerified(facts, 'contact') || hasSignal(local, 'phone') || hasSignal(local, 'email') || hasSignal(local, 'url'),
      evidence: ev('contact') || signal('phone') || signal('email') || signal('url') || 'No phone, email or booking link found',
      fix: 'Add a phone number, email or booking link in plain text.',
    },
    {
      id: 'specific',
      label: 'Specific, not vague',
      pass: vagueCount <= 1,
      evidence: vagueCount === 0 ? 'No vague claims flagged' : `${vagueCount} vague claim${vagueCount === 1 ? '' : 's'} flagged`,
      fix: 'Replace the flagged phrases with facts (see "Vague claims").',
    },
  ];
  if (kit) {
    const words = kit.summary.split(/\s+/).filter(Boolean).length;
    items.push({
      id: 'summary',
      label: 'Answer-first summary under 60 words',
      pass: words > 0 && words <= 60 && !/\[[^\]]+\]/.test(kit.summary),
      evidence: words ? `${words} words${/\[[^\]]+\]/.test(kit.summary) ? ', has blanks to fill' : ''}` : 'No summary',
      fix: 'Fill in the blanks in the suggested summary and put it at the top of the page.',
    });
  }
  return items;
}

/** FAQPage JSON-LD from the Q&A, skipping answers that still have blanks. */
export function faqJsonLd(kit: KitResult): string {
  const ready = kit.questions.filter((q) => !q.missing && !/\[[^\]]+\]/.test(q.answer));
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ready.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(doc, null, 2)}\n</script>`;
}

/** Parse JSON from a model reply that may be wrapped in a code fence. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('The model did not return JSON.');
  }
}
