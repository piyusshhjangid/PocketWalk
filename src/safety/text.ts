/**
 * Text normalisation for safety matching. The goal is that trivial obfuscation does not slip a
 * hazard past a rule: zero-width characters, accents, full-width letters, odd spacing, simple
 * digit-for-letter swaps ("cl1mb") and letters spaced apart ("c l i m b").
 * It is NOT a defence against a determined adversary (see docs/checkpoints/checkpoint-4-summary.md).
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

export function tokenize(input: string): string[] {
  const base = input
    .normalize('NFKC')
    .replace(/[\t\n\r\f\v]/g, ' ') // real whitespace stays a separator
    .replace(/[\p{Cc}\p{Cf}]/gu, '') // zero-width, bidi and other invisible characters join, not split
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents
    .toLowerCase()
    .replace(/['\u2019`]/g, ''); // don't -> dont

  let tokens = base.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

  // Digit-for-letter swaps, only inside tokens that also contain letters ("r0ad", never "20").
  tokens = tokens.map((t) => (/[a-z]/.test(t) && /[0-9]/.test(t) ? t.replace(/[0-9]/g, (d) => LEET[d] ?? d) : t));

  // Letters spaced apart: a run of 4 or more single letters is one word.
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 4) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (t.length === 1 && /[a-z]/.test(t)) run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out;
}

/** Start indices of `phrase` (already tokenised) inside `tokens`. */
export function findPhrase(tokens: readonly string[], phrase: readonly string[]): number[] {
  const hits: number[] = [];
  if (phrase.length === 0) return hits;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    if (phrase.every((p, k) => tokens[i + k] === p)) hits.push(i);
  }
  return hits;
}

const CUES = new Set(['avoid', 'avoiding', 'avoids', 'away', 'off', 'clear']);
const NEGATORS = new Set(['not', 'never', 'no', 'dont', 'donot', 'cant', 'cannot', 'without']);

/**
 * A hazard word that is only MENTIONED, as in "stay away from the road", is allowed when an avoidance
 * cue sits in the three tokens right before it and that cue is not itself negated ("do not avoid").
 * The cue must come BEFORE the hazard word, so "walk along the road, avoid the shop" is not excused.
 */
export function isExcusedMention(tokens: readonly string[], index: number): boolean {
  for (let j = Math.max(0, index - 3); j < index; j++) {
    if (!CUES.has(tokens[j] ?? '')) continue;
    const negated = [j - 2, j - 1].some((k) => k >= 0 && NEGATORS.has(tokens[k] ?? ''));
    if (!negated) return true;
  }
  return false;
}

/**
 * Phrases like "put your phone away" or "keep your phone in your pocket" are exactly what PocketWalk
 * wants to hear. They are removed before device words are matched. Anything else about a phone is not.
 */
export function stripPhoneAwayPhrases(tokens: readonly string[]): string[] {
  const s = ` ${tokens.join(' ')} `;
  const phone = '(?:phone|phones|mobile|smartphone)';
  const out = s
    .replace(new RegExp(` (?:put|keep|leave|tuck|stow|slip|pocket)(?: \\w+){0,3} ${phone}(?: \\w+){0,3} (?:away|pocket|bag|silent|off|down) `, 'g'), ' ')
    .replace(new RegExp(` (?:turn|switch)(?: \\w+){0,3} (?:off|silent)(?: \\w+){0,3} ${phone} `, 'g'), ' ');
  return out.trim().split(' ').filter(Boolean);
}
