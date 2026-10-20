/** Markdown table rendering for tool text output. */

export interface TableOptions {
  /** Number formatter for numeric cells (default: en-US grouping). */
  formatNumber?: (value: number) => string;
  /** Text returned when there are no rows. */
  empty?: string;
}

export function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
  options: TableOptions = {},
): string {
  if (rows.length === 0) return options.empty ?? '_No data._';
  const fmt = options.formatNumber ?? formatNumber;
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => formatCell(cell, fmt)).join(' | ')} |`);
  return [head, divider, ...body].join('\n');
}

export function formatCell(
  value: string | number | null | undefined,
  fmt: (value: number) => string = formatNumber,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return fmt(value);
  return value.replace(/\|/g, '\\|');
}

/** Human-readable integer formatting (12,345,678). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
