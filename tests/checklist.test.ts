import { describe, expect, it } from 'vitest';
import { buildChecklist, coerceFacts, coerceKit, faqJsonLd, mergeFacts, missingTypes, parseJsonLoose, verifyFacts } from '../src/checklist';
import { analyzeLocally } from '../src/rules';
import { toCloudSchema, FACTS_SCHEMA } from '../src/prompts';

const text = 'Harbourline Dental is a family dental clinic in Example Road. Check-ups from S$85. Open Monday to Friday 9am to 6pm.';

describe('checklist', () => {
  it('rejects facts that are not in the source text', () => {
    const f = coerceFacts({
      name: 'Harbourline Dental',
      category: 'dental clinic',
      facts: [
        { type: 'price', value: 'S$85', quote: 'Check-ups from S$85', clear: true },
        { type: 'proof', value: 'award', quote: 'Best clinic award 2025', clear: true },
      ],
      vague: [],
    });
    const v = verifyFacts(text, f);
    expect(v.find((x) => x.type === 'price')!.verified).toBe(true);
    expect(v.find((x) => x.type === 'proof')!.verified).toBe(false);
  });

  it('builds an explainable checklist', () => {
    const local = analyzeLocally(text);
    const f = coerceFacts({ name: 'Harbourline Dental', category: 'dental clinic', facts: [{ type: 'what', value: 'family dental clinic', quote: 'a family dental clinic', clear: true }], vague: [] });
    const v = verifyFacts(text, f);
    const items = buildChecklist(text, f.name, v, local, 0, null);
    const byId = Object.fromEntries(items.map((i) => [i.id, i.pass]));
    expect(byId.who).toBe(true);
    expect(byId.price).toBe(true);
    expect(byId.hours).toBe(true);
    expect(byId.contact).toBe(false);
    expect(missingTypes(v, local)).toContain('contact');
  });

  it('coerces sloppy model output', () => {
    const f = coerceFacts({ facts: [{ type: 'PRICE', value: ' $5 ', quote: '$5' }, { type: 'nonsense', value: 'x' }, null] });
    expect(f.facts).toHaveLength(1);
    expect(f.facts[0].type).toBe('price');
    const k = coerceKit({ summary: 'Hi', questions: [{ question: 'Q?', answer: '[add price]' }] });
    expect(k.questions[0].missing).toBe(true);
  });

  it('merges chunk results without duplicates', () => {
    const a = coerceFacts({ name: 'A', facts: [{ type: 'price', value: 'S$5', quote: 'S$5', clear: true }], vague: [{ text: 'best', fix: 'x' }] });
    const b = coerceFacts({ name: '', facts: [{ type: 'price', value: 's$5', quote: 'S$5', clear: true }, { type: 'hours', value: '9-5', quote: '9-5', clear: true }], vague: [{ text: 'Best', fix: 'y' }] });
    const m = mergeFacts([a, b]);
    expect(m.name).toBe('A');
    expect(m.facts).toHaveLength(2);
    expect(m.vague).toHaveLength(1);
  });

  it('only puts complete answers into FAQ JSON-LD', () => {
    const k = coerceKit({ summary: 's', questions: [{ question: 'Price?', answer: 'From S$85.', missing: false }, { question: 'Hours?', answer: '[add hours]', missing: true }] });
    const out = faqJsonLd(k);
    expect(out).toContain('Price?');
    expect(out).not.toContain('Hours?');
  });

  it('parses fenced JSON and adds enum format for the cloud schema', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    const s = JSON.stringify(toCloudSchema(FACTS_SCHEMA));
    expect(s).toContain('"format":"enum"');
  });
});

describe('vague facts', () => {
  it('do not satisfy a check or remove a missing item', () => {
    const t = 'Crumb & Kettle is a bakery near the park, baked fresh every morning.';
    const local = analyzeLocally(t);
    const f = coerceFacts({
      name: 'Crumb & Kettle',
      category: 'bakery',
      facts: [
        { type: 'where', value: 'near the park', quote: 'near the park', clear: false },
        { type: 'hours', value: 'every morning', quote: 'baked fresh every morning', clear: false },
      ],
      vague: [],
    });
    const v = verifyFacts(t, f);
    const items = Object.fromEntries(buildChecklist(t, f.name, v, local, 0, null).map((i) => [i.id, i]));
    expect(items.where.pass).toBe(false);
    expect(items.where.evidence).toContain('Only vague');
    expect(items.hours.pass).toBe(false);
    expect(missingTypes(v, local)).toEqual(expect.arrayContaining(['where', 'hours']));
  });
});
