import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import {
  CountryNotFoundError,
  LocalizedError,
  ProviderError,
  toUserMessage,
} from '../../src/errors.js';
import { CATALOGS, LOCALES, toArabicIndicDigits, translator } from '../../src/i18n/index.js';
import { en } from '../../src/i18n/messages/en.js';

/** Flatten a catalog into "path → kind" (string / fn/arity / array/length / boolean). */
function shape(value: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'function') out.set(path, `fn/${value.length}`);
  else if (Array.isArray(value)) out.set(path, `array/${value.length}`);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value))
      shape(child, path ? `${path}.${key}` : key, out);
  } else out.set(path, typeof value);
  return out;
}

const ARABIC_LETTER = /[\u0600-\u06FF]/;

describe('message catalogs', () => {
  const reference = shape(en);

  it.each(LOCALES)('%s has exactly the keys (and signatures) of the English catalog', (locale) => {
    const catalog = shape(CATALOGS[locale]);
    const missing = [...reference.keys()].filter((k) => !catalog.has(k));
    const extra = [...catalog.keys()].filter((k) => !reference.has(k));
    expect(missing, `missing in ${locale}`).toEqual([]);
    expect(extra, `extra in ${locale}`).toEqual([]);
    for (const [key, kind] of reference) {
      expect(catalog.get(key), `${locale}: ${key}`).toBe(kind);
    }
  });

  it('every Arabic string is non-empty Arabic text (except code-like values)', () => {
    // Values that are legitimately identical across languages (codes, ranges, symbols).
    const neutral = /^(ISO3|%|[\d–+]+|, | · |\d+_\d+)$/;
    const strings: [string, string][] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') strings.push([path, value]);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(CATALOGS.ar, 'ar');
    for (const [path, value] of strings) {
      if (path === 'ar.meta.listSeparator' || path === 'ar.meta.dotSeparator') continue;
      if (path.startsWith('ar.demographics.age.') && !ARABIC_LETTER.test(value)) continue;
      if (neutral.test(value)) continue;
      expect(ARABIC_LETTER.test(value), `${path} should be Arabic: "${value}"`).toBe(true);
    }
  });

  it('every templated Arabic message renders Arabic text', () => {
    const fns: [string, (...args: string[]) => unknown][] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'function') fns.push([path, value as (...args: string[]) => unknown]);
      else if (value && typeof value === 'object' && !Array.isArray(value))
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(CATALOGS.ar, 'ar');
    expect(fns.length).toBeGreaterThan(40);
    for (const [path, fn] of fns) {
      const out = fn('X', 'Y', 'Z', 'W', 'V', 'U');
      if (typeof out !== 'string') continue;
      if (path.endsWith('.millions') || path.endsWith('.thousands')) {
        expect(out).toMatch(ARABIC_LETTER);
        continue;
      }
      if (path === 'ar.common.range' || path === 'ar.common.side') {
        expect(out).toMatch(ARABIC_LETTER);
        continue;
      }
      // Pure compositions of already-localized parts.
      if (path.endsWith('.ms') || path.endsWith('.anomaly') || path.endsWith('.demographic'))
        continue;
      expect(out, path).toMatch(ARABIC_LETTER);
    }
  });

  it('uses standard humanitarian terminology for the core metrics', () => {
    const m = CATALOGS.ar.metrics;
    expect(m['refugees']).toBe('اللاجئون');
    expect(m['asylum_seekers']).toBe('طالبو اللجوء');
    expect(m['idps']).toBe('النازحون داخلياً');
    expect(m['stateless']).toBe('عديمو الجنسية');
    expect(m['ipc_phase_5']).toContain('المجاعة');
  });
});

describe('translator', () => {
  it('formats English output exactly like the pre-i18n formatter', () => {
    const tr = translator('en');
    expect(tr.num(1234567)).toBe('1,234,567');
    expect(tr.num(2.345)).toBe('2.35');
    expect(tr.pct(12.345)).toBe('12.3%');
    expect(tr.range(2015, 2024)).toBe('2015–2024');
    expect(tr.metric('refugees')).toBe('refugees');
    expect(tr.country('EGY', 'Egypt')).toBe('Egypt');
    expect(tr.sourceLine('UNHCR Refugee Data Finder', 'unhcr')).toBe(
      '_Source: UNHCR Refugee Data Finder_',
    );
    expect(tr.chartOptions()).toEqual({});
  });

  it('Arabic defaults to Western digits with Arabic wording', () => {
    const tr = translator('ar');
    expect(tr.dir).toBe('rtl');
    expect(tr.num(1234567)).toBe('1,234,567');
    expect(tr.range(2015, 2024)).toBe('من 2015 إلى 2024');
    expect(tr.range(2023, 2023)).toBe('2023');
    expect(tr.metric('asylum_seekers')).toBe('طالبو اللجوء');
    expect(tr.metric('f_0_4')).toBe('إناث 0–4');
    expect(tr.metric('unknown_metric')).toBe('unknown_metric');
    expect(tr.dataset('food-security')).toContain('الأمن الغذائي');
    expect(tr.region('Africa')).toBe('أفريقيا');
    expect(tr.region('Atlantis')).toBe('Atlantis');
  });

  it('uses the official UN Arabic country names, falling back to the provider name', () => {
    const tr = translator('ar');
    expect(tr.country('EGY', 'Egypt')).toBe('مصر');
    expect(tr.country('SYR', 'Syrian Arab Rep.')).toBe('سوريا');
    expect(tr.country('COD', 'Dem. Rep. of the Congo')).toBe('جمهورية الكونغو الديمقراطية');
    expect(tr.country('XXX', 'Nowhere')).toBe('Nowhere');
    expect(tr.country(undefined, 'Various')).toBe('Various');
  });

  it('keeps signed numbers attached to their sign in RTL text', () => {
    const tr = translator('ar');
    expect(tr.signed(1200)).toBe('\u200E+1,200');
    expect(tr.signed(-5)).toBe('\u200E-5');
    expect(tr.signed(0)).toBe('0');
    expect(translator('en').signed(-5)).toBe('-5');
  });

  it('supports Arabic-Indic digits as an option', () => {
    const tr = translator('ar', 'arab');
    expect(tr.num(1234567)).toBe('١٬٢٣٤٬٥٦٧');
    expect(tr.pct(12.5)).toBe('١٢٫٥٪');
    expect(tr.year(2024)).toBe('٢٠٢٤');
    expect(tr.range(2015, 2024)).toBe('من ٢٠١٥ إلى ٢٠٢٤');
    // Codes and indicator ids are never reshaped.
    expect(tr.text('ISO3 · SP.POP.TOTL · R² · المرحلة 3 · 60+')).toBe(
      'ISO3 · SP.POP.TOTL · R² · المرحلة ٣ · ٦٠+',
    );
    // Arabic-Indic digits never leak into English.
    expect(translator('en', 'arab').num(1000)).toBe('1,000');
    expect(toArabicIndicDigits('1,234.5%')).toBe('١٬٢٣٤٫٥٪');
  });

  it('adds Arabic producer labels to citations while keeping the original citation', () => {
    const line = translator('ar').sourceLine('UNHCR Refugee Data Finder', 'unhcr');
    expect(line).toBe(
      '_المصدر: المفوضية السامية للأمم المتحدة لشؤون اللاجئين (UNHCR) — UNHCR Refugee Data Finder_',
    );
    expect(translator('ar').sourceLine('Mock', 'mock')).toBe('_المصدر: Mock_');
  });

  it('renders Arabic tables with the localized empty state', () => {
    expect(translator('ar').table(['أ'], [])).toBe('_لا توجد بيانات._');
    expect(translator('ar', 'arab').table(['أ', 'ب'], [['x', 1500]])).toContain('| x | ١٬٥٠٠ |');
  });
});

describe('localized errors', () => {
  const ar = translator('ar');

  it('country-not-found in Arabic keeps the query and suggestions verbatim', () => {
    const msg = toUserMessage(new CountryNotFoundError('siria', ['Syrian Arab Rep.']), ar);
    expect(msg).toContain('«siria»');
    expect(msg).toContain('Syrian Arab Rep.');
    expect(msg).toContain('search_country');
    expect(msg).toMatch(ARABIC_LETTER);
  });

  it('provider errors and catalog-backed errors are localized', () => {
    expect(toUserMessage(new ProviderError('rate_limited', 'x', 'unhcr'), ar)).toContain('unhcr');
    expect(toUserMessage(new ProviderError('rate_limited', 'x', 'unhcr'), ar)).toMatch(
      ARABIC_LETTER,
    );
    const err = new LocalizedError((tr) => tr.m.errors.yearRange(tr.year(2025), tr.year(2020)));
    expect(err.message).toBe('year_from (2025) must not be after year_to (2020)');
    expect(toUserMessage(err, ar)).toContain('year_from (2025)');
    expect(toUserMessage(err, ar)).toMatch(ARABIC_LETTER);
  });
});

describe('locale configuration', () => {
  it('defaults to English with Western digits', () => {
    const config = loadConfig({});
    expect(config.locale).toBe('en');
    expect(config.digits).toBe('latn');
  });

  it('reads MALJA_LOCALE / MALJA_DIGITS and rejects unknown values', () => {
    const config = loadConfig({ MALJA_LOCALE: 'AR', MALJA_DIGITS: 'arab' });
    expect(config.locale).toBe('ar');
    expect(config.digits).toBe('arab');
    expect(() => loadConfig({ MALJA_LOCALE: 'fr' })).toThrow(/MALJA_LOCALE/);
    expect(() => loadConfig({ MALJA_DIGITS: 'roman' })).toThrow(/MALJA_DIGITS/);
    expect(loadConfig({ HMCP_LOCALE: 'ar' }).locale).toBe('ar');
  });
});
