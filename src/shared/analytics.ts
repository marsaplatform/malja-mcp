/**
 * In-memory usage analytics. Powers the demo dashboard's statistics panel.
 * Never persisted, never sent anywhere; disable with MALJA_ANALYTICS=0.
 */

export interface ToolCallStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
}

export class Analytics {
  private readonly byTool = new Map<string, ToolCallStat>();
  private readonly startedAt = Date.now();

  constructor(private readonly enabled: boolean) {}

  recordToolCall(tool: string, durationMs: number, isError: boolean): void {
    if (!this.enabled) return;
    const stat = this.byTool.get(tool) ?? { tool, calls: 0, errors: 0, totalMs: 0 };
    stat.calls += 1;
    stat.totalMs += durationMs;
    if (isError) stat.errors += 1;
    this.byTool.set(tool, stat);
  }

  snapshot(): {
    uptimeSeconds: number;
    totalCalls: number;
    totalErrors: number;
    tools: ToolCallStat[];
  } {
    const tools = [...this.byTool.values()].sort((a, b) => b.calls - a.calls);
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      totalCalls: tools.reduce((s, t) => s + t.calls, 0),
      totalErrors: tools.reduce((s, t) => s + t.errors, 0),
      tools,
    };
  }
}
