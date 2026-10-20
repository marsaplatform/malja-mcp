/**
 * Error taxonomy shared across providers and tools.
 *
 * Providers throw typed errors; the tool layer converts them into MCP tool
 * results with `isError: true` and a message an LLM can act on (never a stack
 * trace, never provider internals).
 */

import { translator } from './i18n/index.js';
import type { Translator } from './i18n/index.js';

export type ProviderErrorKind =
  'not_found' | 'bad_request' | 'rate_limited' | 'upstream_error' | 'network' | 'offline_miss';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Raised when a country query cannot be resolved to a known country. */
export class CountryNotFoundError extends Error {
  constructor(
    readonly query: string,
    readonly suggestions: readonly string[] = [],
  ) {
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    super(`No country matched "${query}".${hint} Try the search_country tool first.`);
    this.name = 'CountryNotFoundError';
  }
}

/**
 * An error whose user-facing text comes from the message catalog, so it can
 * be rendered in the caller's locale. `message` holds the English rendering
 * (for logs and non-tool callers).
 */
export class LocalizedError extends Error {
  constructor(readonly render: (tr: Translator) => string) {
    super(render(translator('en')));
    this.name = 'LocalizedError';
  }
}

/** A user-facing message for any error thrown inside a tool handler. */
export function toUserMessage(err: unknown, tr: Translator = translator('en')): string {
  const e = tr.m.errors;
  if (err instanceof CountryNotFoundError) {
    return e.countryNotFound(
      err.query,
      err.suggestions.length > 0 ? tr.list(err.suggestions) : undefined,
    );
  }
  if (err instanceof LocalizedError) return err.render(tr);
  if (err instanceof ProviderError) {
    const provider = err.provider ?? e.defaultProvider;
    switch (err.kind) {
      case 'offline_miss':
        return e.offlineMiss(err.message);
      case 'rate_limited':
        return e.rateLimited(provider);
      case 'network':
        return e.network(provider, err.message);
      case 'not_found':
        return err.message;
      default:
        return e.upstream(provider, err.message);
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
