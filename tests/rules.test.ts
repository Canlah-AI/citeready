import { describe, expect, it } from 'vitest';
import { analyzeLocally, chunkText, findSignals, maskContacts, quoteFound } from '../src/rules';

describe('local rules', () => {
  it('finds prices, hours, phone, email, address and proof', () => {
    const t = 'Open Monday to Friday 9am to 6pm. Check-ups from S$85. Call +65 6000 1234 or email a@b.example. 88 Example Road, Singapore 000000. Practising for 30 years.';
    const types = new Set(findSignals(t).map((s) => s.type));
    for (const k of ['hours', 'price', 'phone', 'email', 'address', 'proof']) expect(types.has(k as never)).toBe(true);
  });

  it('does not treat years or prices as phone numbers', () => {
    const phones = findSignals('Since 2019, from S$1,250. Founded 2026-01-05.').filter((s) => s.type === 'phone');
    expect(phones).toHaveLength(0);
  });

  it('flags vague marketing claims with a fix', () => {
    const a = analyzeLocally('The best bakery in town, opening soon, at affordable prices.');
    expect(a.vague.map((v) => v.phrase.toLowerCase())).toEqual(expect.arrayContaining(['best', 'affordable', 'soon']));
    expect(a.vague.every((v) => v.suggestion.length > 10)).toBe(true);
  });

  it('masks contacts but keeps placeholders', () => {
    const m = maskContacts('Call +65 6000 1234 or mail hello@x.example. Price S$45.');
    expect(m.text).toContain('[phone]');
    expect(m.text).toContain('[email]');
    expect(m.text).toContain('S$45');
    expect(m.masked).toBe(2);
  });

  it('chunks long text under the limit', () => {
    const para = 'Sentence one is here. '.repeat(40);
    const text = Array.from({ length: 10 }, () => para).join('\n\n');
    const parts = chunkText(text, 2000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
  });

  it('verifies quotes ignoring case, spacing and smart quotes', () => {
    expect(quoteFound('We open at 9am  daily.', 'we open at 9am daily')).toBe(true);
    expect(quoteFound('It’s great.', "It's great")).toBe(true);
    expect(quoteFound('We open at 9am.', 'We open at 8am')).toBe(false);
  });
});
