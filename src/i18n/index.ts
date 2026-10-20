import { z } from 'zod';
import { arabicNamesFor } from '../shared/country-names-ar.js';
import type { ChartSpecInput } from '../viz/series.js';
import { markdownTable } from '../viz/table.js';
import { ar } from './messages/ar.js';
import { en } from './messages/en.js';
import type { Messages } from './messages/en.js';

/**
 * Localization layer. Tools build every human-facing string through a
 * {@link Translator}: catalog messages (`tr.m.*`) for wording, and the
 * translator's formatters for numbers, years, ranges, country names, metric
 * labels and citations. Structured output (JSON field names, ISO3 codes,
 * dataset ids, metric keys) is never localized, so machine consumers are
 * unaffected by the locale.
 *
 * Adding a locale: add `messages/<code>.ts` typed as `Messages`, register it
 * in CATALOGS and LOCALES, and (if right-to-left) in RTL_LOCALES. The
 * catalog-parity test fails until every key is present.
 */

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Digit shapes for localized numbers: Western (0-9) or Arabic-Indic (٠-٩). */
export const DIGIT_STYLES = ['latn', 'arab'] as const;
export type DigitStyle = (typeof DIGIT_STYLES)[number];

export const CATALOGS: Record<Locale, Messages> = { en, ar };
const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export type { Messages };

export const LocaleSchema = z
  .enum(LOCALES)
  .describe(
    'Language of the human-readable text output: "en" (default) or "ar" (Modern Standard Arabic, right-to-left). Structured JSON fields, ISO3 codes and dataset ids stay in English either way.',
  );

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
/** A numeral not glued to Latin letters/codes: 3, 1,000, 2.15, 60+, 12.5%. */
const NUMERAL_TOKEN = /(?<![A-Za-z0-9.,_$-])\d+(?:[.,]\d+)*%?(?![A-Za-z0-9_])/g;
/** U+200E LEFT-TO-RIGHT MARK — keeps a leading sign attached to its number in RTL text. */
const LRM = '\u200E';

/** Convert Western digits and separators in a formatted number to Arabic-Indic. */
export function toArabicIndicDigits(text: string): string {
  return text
    .replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]!)
    .replace(/,/g, '٬')
    .replace(/\./g, '٫')
    .replace(/%/g, '٪');
}

export interface Translator {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly digitStyle: DigitStyle;
  /** The message catalog for this locale. */
  readonly m: Messages;
  /** Grouped number: 12,345,678 (or ١٢٬٣٤٥٬٦٧٨). */
  num(value: number): string;
  /** Number with an explicit sign (+1,200 / −…), safe inside RTL text. */
  signed(value: number): string;
  /** Fixed-precision number without grouping (R², z-scores). */
  fixed(value: number, fractionDigits: number): string;
  /** Percentage: 12.5%. */
  pct(value: number, fractionDigits?: number): string;
  /** A year (never grouped). */
  year(value: number | string): string;
  /** Year range, e.g. "2015–2024" / "من 2015 إلى 2024". */
  range(from: number, to: number): string;
  /** Digit-shape conversion for catalog strings that embed numerals. */
  text(value: string): string;
  /** Localized country name by ISO3, falling back to the provider's name. */
  country(iso3: string | undefined, fallback: string): string;
  /** Display label for a metric key (the raw key in English, for tool-call fidelity). */
  metric(key: string): string;
  /** Human title of a dataset id. */
  dataset(id: string): string;
  region(name: string | undefined): string;
  /** Localized unit for a denominator kind (or plain people). */
  unit(kind: 'people' | 'population' | 'gdp'): string;
  /** " (asylum side)" / " (بوصفه بلد لجوء)". */
  side(role: 'asylum' | 'origin'): string;
  /** Citation footer: keeps the producer's citation, adds a localized producer label. */
  sourceLine(citation: string, providerId?: string): string;
  /** Localized producer name for a provider id (empty when unknown). */
  producer(providerId: string | undefined): string;
  /** Markdown table with locale-aware number cells. */
  table(
    headers: readonly string[],
    rows: readonly (readonly (string | number | null | undefined)[])[],
  ): string;
  /** Join list items with the locale's separator. */
  list(items: readonly string[]): string;
  /** Direction, tick and category formatting for chart renderers. */
  chartOptions(): Pick<ChartSpecInput, 'direction' | 'locale' | 'formatTick' | 'formatCategory'>;
}

function groupedLatn(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Build a translator. Unknown locales fall back to English. */
export function translator(locale: Locale = 'en', digitStyle: DigitStyle = 'latn'): Translator {
  const m = CATALOGS[locale] ?? en;
  const rtl = RTL_LOCALES.has(locale);
  // Arabic-Indic digits only make sense in Arabic output.
  const digits: DigitStyle = locale === 'ar' ? digitStyle : 'latn';
  const shape = (s: string): string => (digits === 'arab' ? toArabicIndicDigits(s) : s);
  // For free text: only standalone numerals (not parts of codes like ISO3,
  // SP.POP.TOTL or R²) are reshaped.
  const shapeText = (s: string): string =>
    digits === 'arab' ? s.replace(NUMERAL_TOKEN, (token) => toArabicIndicDigits(token)) : s;

  const num = (value: number): string => (Number.isFinite(value) ? shape(groupedLatn(value)) : '—');

  const tr: Translator = {
    locale,
    dir: rtl ? 'rtl' : 'ltr',
    digitStyle: digits,
    m,
    num,
    signed(value) {
      if (!Number.isFinite(value)) return '—';
      const sign = value > 0 ? '+' : value < 0 ? '-' : '';
      const body = `${sign}${num(Math.abs(value))}`;
      return rtl && sign ? `${LRM}${body}` : body;
    },
    fixed(value, fractionDigits) {
      return Number.isFinite(value) ? shape(value.toFixed(fractionDigits)) : '—';
    },
    pct(value, fractionDigits = 1) {
      if (!Number.isFinite(value)) return '—';
      const body = shape(`${value.toFixed(fractionDigits)}%`);
      return rtl && value < 0 ? `${LRM}${body}` : body;
    },
    year(value) {
      return shape(String(value));
    },
    range(from, to) {
      return m.common.range(shape(String(from)), shape(String(to)));
    },
    text(value) {
      return shapeText(value);
    },
    country(iso3, fallback) {
      if (locale === 'ar' && iso3) return arabicNamesFor(iso3)[0] ?? fallback;
      return fallback;
    },
    metric(key) {
      if (m.meta.showMetricKeys) return key;
      const label = m.metrics[key];
      if (label) return shapeText(label);
      const demographic = /^([fm])_(.+)$/.exec(key);
      if (demographic) {
        const sex = demographic[1] === 'f' ? m.demographics.female : m.demographics.male;
        const age = m.demographics.age[demographic[2]!] ?? demographic[2]!;
        return shapeText(`${sex} ${age}`);
      }
      return key;
    },
    dataset(id) {
      return m.datasets[id] ?? id;
    },
    region(name) {
      if (!name) return m.common.na;
      return m.regions[name] ?? name;
    },
    unit(kind) {
      return shapeText(m.units[kind]);
    },
    side(role) {
      return m.common.side(role);
    },
    producer(providerId) {
      if (!providerId) return '';
      return locale === 'en' ? '' : (m.producers[providerId] ?? '');
    },
    sourceLine(citation, providerId) {
      return m.common.sourceLine(citation, tr.producer(providerId));
    },
    table(headers, rows) {
      return markdownTable(headers, rows, { formatNumber: num, empty: m.common.noData });
    },
    list(items) {
      return items.join(m.meta.listSeparator);
    },
    chartOptions() {
      // English keeps the renderers' historical defaults byte-for-byte.
      if (locale === 'en') return {};
      return {
        direction: rtl ? 'rtl' : 'ltr',
        locale,
        formatTick: (value: number) => {
          if (value >= 1_000_000) return m.charts.millions(shape((value / 1_000_000).toFixed(1)));
          if (value >= 1_000) return m.charts.thousands(shape((value / 1_000).toFixed(0)));
          return shape(String(Math.round(value)));
        },
        formatCategory: (value: number | string) => shape(String(value)),
      };
    },
  };
  return tr;
}
