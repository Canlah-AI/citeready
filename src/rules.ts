// Local, deterministic checks. No model, no network: these run before any AI
// call so the user sees instant results and we have ground truth to check the
// model's output against.

export type SignalType =
  | 'price'
  | 'hours'
  | 'date'
  | 'phone'
  | 'email'
  | 'url'
  | 'address'
  | 'proof';

export interface Signal {
  type: SignalType;
  match: string;
}

export interface VaguePhrase {
  phrase: string;
  suggestion: string;
}

export interface LocalAnalysis {
  chars: number;
  words: number;
  approxTokens: number;
  signals: Signal[];
  vague: VaguePhrase[];
  firstSentence: string;
}

const PATTERNS: Record<SignalType, RegExp> = {
  price:
    /(?:S\$|US\$|A\$|RM|€|£|¥|\$)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:-|–|to)\s?(?:S\$|US\$|\$)?\d[\d,]*(?:\.\d{1,2})?)?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:SGD|USD|MYR|EUR|GBP|dollars)\b|\bfree of charge\b|\bfree (?:entry|admission|consultation|trial)\b/gi,
  hours:
    /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?s?\b[^.\n]{0,40}?\d{1,2}(?::\d{2})?\s?(?:am|pm)|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\s?(?:-|–|to)\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\s?(?:-|–|to)\s?\d{1,2}:\d{2}\b|\b24\/7\b|\bopen daily\b|\bopen 24 hours\b/gi,
  date:
    /\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s\d{4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s\d{1,2}(?:st|nd|rd|th)?(?:,?\s\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi,
  phone: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{3,4})?/g,
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  url: /\bhttps?:\/\/[^\s)]+|\bwww\.[a-z0-9-]+\.[a-z.]{2,}[^\s)]*/gi,
  address:
    /\b\d{1,5}[A-Z]?\s+(?:[A-Z][a-z]+\s){1,4}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|walk|boulevard|blvd|way|crescent|cres|close|place|pl)\b\.?|\b(?:singapore|S)\s?\(?\d{6}\)?|\b#\d{1,3}-\d{1,4}\b|\bpostal code\b/gi,
  proof:
    /\b\d[\d,.]*\+?\s?(?:years?|yrs|customers|clients|patients|students|reviews|projects|locations|outlets|stars?|members)\b|\b\d(?:\.\d)?\s?(?:\/\s?5|out of 5)\b|\b(?:award(?:ed)?|winner|certified|accredited|licensed|registered with|ISO\s?\d+|founded in \d{4}|since \d{4})\b/gi,
};

// Phrases an assistant cannot quote as a fact. Each comes with a concrete fix.
const VAGUE: Array<[RegExp, string]> = [
  [/\bbest\b/i, 'Replace "best" with a checkable fact (an award, a rating, a count).'],
  [/\bworld[- ]class\b/i, 'Say what makes it world-class: a certification, a ranking, a named client.'],
  [/\bleading\b/i, '"Leading" needs a basis: market share, years, number of customers.'],
  [/\baffordable\b/i, 'Give the price or a price range instead of "affordable".'],
  [/\bcompetitive pric(?:es|ing)\b/i, 'State the actual price or starting price.'],
  [/\bcontact us for (?:pricing|prices|a quote)\b/i, 'Add at least a starting price; assistants skip pages with no price.'],
  [/\bpremium\b/i, 'Explain what "premium" means here (materials, service level, warranty).'],
  [/\bhigh[- ]quality\b/i, 'Name the evidence of quality (standard, warranty, test, review score).'],
  [/\btop[- ]notch\b/i, 'Swap "top-notch" for a specific credential or result.'],
  [/\bcutting[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b/i, 'Name the actual technology or equipment.'],
  [/\bcoming soon\b|\bsoon\b/i, 'Give a date or month instead of "soon".'],
  [/\bvarious\b|\band (?:much )?more\b/i, 'List the items instead of "various" or "and more".'],
  [/\bconveniently located\b/i, 'Give the address and nearest landmark or station.'],
  [/\bflexible hours\b|\bextended hours\b/i, 'List the actual opening hours.'],
];

const DIGITS = /\d/g;

function uniq(list: Signal[]): Signal[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = `${s.type}:${s.match.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function findSignals(text: string): Signal[] {
  const out: Signal[] = [];
  for (const type of Object.keys(PATTERNS) as SignalType[]) {
    const re = new RegExp(PATTERNS[type].source, PATTERNS[type].flags);
    for (const m of text.matchAll(re)) {
      const match = m[0].trim();
      if (type === 'phone') {
        const digits = (match.match(DIGITS) || []).length;
        // Phone numbers have 8-15 digits; skip years, prices, postcodes.
        if (digits < 8 || digits > 15) continue;
        if (/^\d{4}-\d{2}-\d{2}$/.test(match)) continue;
      }
      out.push({ type, match });
    }
  }
  return uniq(out);
}

export function findVague(text: string): VaguePhrase[] {
  const out: VaguePhrase[] = [];
  for (const [re, suggestion] of VAGUE) {
    const m = text.match(re);
    if (m) out.push({ phrase: m[0], suggestion });
  }
  return out;
}

export function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.{1,280}?[.!?])(?:\s|$)/);
  return (m ? m[1] : t.slice(0, 280)).trim();
}

export function analyzeLocally(text: string): LocalAnalysis {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    chars: text.length,
    words,
    // Rough English estimate (about 4 characters per token). Only used for
    // routing and labelled as approximate in the UI.
    approxTokens: Math.ceil(text.length / 4),
    signals: findSignals(text),
    vague: findVague(text),
    firstSentence: firstSentence(text),
  };
}

export function hasSignal(a: LocalAnalysis, type: SignalType): boolean {
  return a.signals.some((s) => s.type === type);
}

/**
 * Replace emails and phone numbers with placeholders before text leaves the
 * device. The placeholders keep the meaning ("a phone number is listed") so the
 * cloud model can still judge completeness.
 */
export function maskContacts(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text.replace(new RegExp(PATTERNS.email.source, PATTERNS.email.flags), () => {
    masked++;
    return '[email]';
  });
  out = out.replace(new RegExp(PATTERNS.phone.source, PATTERNS.phone.flags), (m) => {
    const digits = (m.match(DIGITS) || []).length;
    if (digits < 8 || digits > 15 || /^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return m;
    masked++;
    return '[phone]';
  });
  return { text: out, masked };
}

/** Split text into chunks no longer than maxChars, preferring paragraph breaks. */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const p of paras) {
    if (p.length > maxChars) {
      push();
      // Hard-split very long paragraphs at sentence boundaries.
      let rest = p;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf('. ', maxChars);
        if (cut < maxChars * 0.5) cut = maxChars;
        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      cur = rest;
      continue;
    }
    if ((cur + '\n\n' + p).length > maxChars) push();
    cur = cur ? cur + '\n\n' + p : p;
  }
  push();
  return chunks;
}

/** Normalise for quote verification (whitespace, quotes, case). */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if the model's quote really appears in the source text. */
export function quoteFound(source: string, quote: string): boolean {
  const q = normalise(quote).replace(/^["'.\s]+|["'.\s]+$/g, '');
  if (q.length < 3) return false;
  const src = normalise(source);
  if (src.includes(q)) return true;
  // Masked copies: allow placeholders to stand in for contacts.
  return src.includes(q.replace(/\[(email|phone)\]/g, '').trim()) && /\[(email|phone)\]/.test(q);
}
