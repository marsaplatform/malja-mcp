/**
 * Fuzzy country-name matching, shared by any provider that resolves
 * human-entered country queries ("egypt", "DRC", "Syrian Arab Rep.") to codes.
 */

export interface MatchCandidate<T> {
  value: T;
  /** All names/aliases/codes this candidate answers to. */
  names: readonly string[];
}

export interface ScoredMatch<T> {
  value: T;
  score: number;
}

/**
 * Arabic-specific folding so spelling variants compare equal: strips harakat
 * and tatweel, unifies hamza/alef forms, taa marbuta and alef maqsura, and
 * drops the definite article "ال" at the start of each token ("الأردن",
 * "الاردن" and "اردن" all become "اردن"). Applied to names and queries alike,
 * so the folding stays consistent on both sides of the comparison.
 */
function foldArabic(input: string): string {
  return input
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/(^|\s)ال(?=\S)/g, '$1');
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeName(input: string): string {
  return foldArabic(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreOne(query: string, name: string): number {
  if (name === query) return 1;
  if (name.startsWith(query)) return 0.85;
  if (name.includes(query)) return 0.7;
  const queryTokens = query.split(' ');
  const nameTokens = new Set(name.split(' '));
  const overlap = queryTokens.filter((t) => nameTokens.has(t)).length;
  if (overlap > 0 && overlap === queryTokens.length) return 0.6;
  if (overlap > 0) return 0.4 * (overlap / queryTokens.length);
  return 0;
}

/** Rank candidates against a query; only matches with score > 0 are returned. */
export function matchCountries<T>(
  query: string,
  candidates: readonly MatchCandidate<T>[],
  limit = 5,
): ScoredMatch<T>[] {
  const normalized = normalizeName(query);
  if (normalized.length === 0) return [];

  const scored: ScoredMatch<T>[] = [];
  for (const candidate of candidates) {
    let best = 0;
    for (const name of candidate.names) {
      best = Math.max(best, scoreOne(normalized, normalizeName(name)));
      if (best === 1) break;
    }
    if (best > 0) scored.push({ value: candidate.value, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
