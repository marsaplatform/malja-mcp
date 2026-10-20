/**
 * Demo dashboard, served at GET / in --http mode.
 *
 * Self-contained single page: Tailwind + Alpine from CDN, no build step.
 * Brutalist terminal aesthetic — monospace, sharp corners, 1px borders,
 * status communicated through color (green = healthy, red = error).
 * Demonstration only; the MCP surface itself lives at POST /mcp.
 */
export const DASHBOARD_HTML = /* html */ String.raw`<!doctype html>
<html lang="en" class="bg-neutral-950">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>malja-mcp — dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js" defer></script>
</head>
<body class="bg-neutral-950 text-neutral-300 font-mono text-sm min-h-screen" x-data="dashboard()" x-init="init()">

<header class="border-b border-neutral-800 px-6 py-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
  <h1 class="text-neutral-100 text-base font-bold tracking-widest uppercase">malja-mcp</h1>
  <span class="text-neutral-500" x-text="status.server ? 'v' + status.server.version : '…'"></span>
  <span class="text-neutral-500">MCP endpoint: <span class="text-blue-400" x-text="status.endpoint || '…'"></span></span>
  <span class="ml-auto" :class="connected ? 'text-green-500' : 'text-red-500'"
        x-text="connected ? '● LIVE' : '○ DISCONNECTED'"></span>
</header>

<main class="grid grid-cols-1 lg:grid-cols-3 gap-px bg-neutral-800 border-b border-neutral-800">

  <!-- Providers -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3">Providers</h2>
    <template x-for="p in status.providers || []" :key="p.metadata.id">
      <div class="border border-neutral-800 p-3 mb-2">
        <div class="flex items-center gap-2">
          <span :class="p.health.ok ? 'text-green-500' : 'text-red-500'" x-text="p.health.ok ? '●' : '●'"></span>
          <span class="text-neutral-100 font-bold" x-text="p.metadata.name"></span>
          <span class="text-neutral-600" x-text="'[' + p.metadata.id + ']'"></span>
          <span class="ml-auto text-neutral-500"
                x-text="p.health.latencyMs !== undefined ? p.health.latencyMs + 'ms' : ''"></span>
        </div>
        <div class="text-neutral-500 mt-1" x-text="p.metadata.datasets.length + ' datasets: ' + p.metadata.datasets.map(d => d.id).join(', ')"></div>
        <div class="text-neutral-600 mt-1 text-xs" x-text="p.health.detail"></div>
      </div>
    </template>
  </section>

  <!-- Statistics -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3">Statistics</h2>
    <div class="grid grid-cols-2 gap-px bg-neutral-800">
      <div class="bg-neutral-950 p-3">
        <div class="text-2xl text-neutral-100" x-text="status.analytics ? status.analytics.totalCalls : '—'"></div>
        <div class="text-neutral-500 text-xs uppercase">tool calls</div>
      </div>
      <div class="bg-neutral-950 p-3">
        <div class="text-2xl" :class="status.analytics && status.analytics.totalErrors > 0 ? 'text-red-500' : 'text-neutral-100'"
             x-text="status.analytics ? status.analytics.totalErrors : '—'"></div>
        <div class="text-neutral-500 text-xs uppercase">errors</div>
      </div>
      <div class="bg-neutral-950 p-3">
        <div class="text-2xl text-green-500" x-text="cacheHitRate()"></div>
        <div class="text-neutral-500 text-xs uppercase">cache hit rate</div>
      </div>
      <div class="bg-neutral-950 p-3">
        <div class="text-2xl text-neutral-100" x-text="status.cache ? status.cache.entries : '—'"></div>
        <div class="text-neutral-500 text-xs uppercase" x-text="'cache entries (' + (status.cache ? status.cache.backend : '…') + ')'"></div>
      </div>
    </div>
    <div class="mt-3 text-neutral-500 text-xs">
      <div x-text="'uptime: ' + (status.analytics ? status.analytics.uptimeSeconds + 's' : '—')"></div>
      <div x-text="status.config ? 'offline: ' + status.config.offline + ' · rate limit: ' + status.config.rateLimitRps + ' rps · ttl: ' + status.config.cacheTtlSeconds + 's' : ''"></div>
    </div>
    <h3 class="text-neutral-500 uppercase tracking-widest text-xs mt-4 mb-2">Per tool</h3>
    <div class="max-h-40 overflow-y-auto">
      <template x-for="t in (status.analytics ? status.analytics.tools : [])" :key="t.tool">
        <div class="flex justify-between border-b border-neutral-900 py-1">
          <span x-text="t.tool"></span>
          <span class="text-neutral-500" x-text="t.calls + ' calls · ' + Math.round(t.totalMs / t.calls) + 'ms avg'"></span>
        </div>
      </template>
    </div>
  </section>

  <!-- Try it -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3">Try a query</h2>
    <select x-model="selectedSample" @change="applySample()"
            class="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 p-2 mb-2">
      <template x-for="(s, i) in samples" :key="i">
        <option :value="i" x-text="s.label"></option>
      </template>
    </select>
    <div class="text-neutral-500 text-xs mb-1" x-text="'tool: ' + currentTool()"></div>
    <textarea x-model="callArgs" rows="4" spellcheck="false"
              class="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 p-2 text-xs"></textarea>
    <button @click="run()" :disabled="running"
            class="mt-2 px-4 py-2 bg-green-600 text-neutral-950 font-bold uppercase tracking-widest text-xs disabled:opacity-50"
            x-text="running ? 'running…' : 'run'"></button>
    <pre class="mt-3 bg-neutral-900 border border-neutral-800 p-3 text-xs whitespace-pre-wrap max-h-64 overflow-y-auto"
         :class="callError ? 'text-red-400' : 'text-neutral-300'"
         x-text="callResult || 'output appears here'"></pre>
  </section>

  <!-- Tools -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3"
        x-text="'Tools (' + (status.tools ? status.tools.length : 0) + ')'"></h2>
    <div class="max-h-72 overflow-y-auto">
      <template x-for="t in status.tools || []" :key="t.name">
        <div class="border-b border-neutral-900 py-2">
          <span class="text-blue-400" x-text="t.name"></span>
          <div class="text-neutral-600 text-xs" x-text="t.title"></div>
        </div>
      </template>
    </div>
  </section>

  <!-- Resources & prompts -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3"
        x-text="'Resources (' + (status.resources ? status.resources.length : 0) + ')'"></h2>
    <div class="max-h-32 overflow-y-auto mb-4">
      <template x-for="r in status.resources || []" :key="r.uri">
        <div class="border-b border-neutral-900 py-1">
          <span class="text-amber-400" x-text="r.uri"></span>
          <span class="text-neutral-600 text-xs ml-2" x-text="r.name"></span>
        </div>
      </template>
    </div>
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3"
        x-text="'Prompts (' + (status.prompts ? status.prompts.length : 0) + ')'"></h2>
    <div class="max-h-32 overflow-y-auto">
      <template x-for="p in status.prompts || []" :key="p.name">
        <div class="border-b border-neutral-900 py-1">
          <span class="text-violet-400" x-text="p.name"></span>
          <span class="text-neutral-600 text-xs ml-2" x-text="p.title"></span>
        </div>
      </template>
    </div>
  </section>

  <!-- Live logs -->
  <section class="bg-neutral-950 p-5">
    <h2 class="text-neutral-500 uppercase tracking-widest text-xs mb-3">Live logs</h2>
    <div class="bg-neutral-900 border border-neutral-800 p-3 text-xs max-h-80 overflow-y-auto" id="logbox">
      <template x-for="(l, i) in logs" :key="i">
        <div class="whitespace-pre-wrap break-all border-b border-neutral-950 py-0.5">
          <span class="text-neutral-600" x-text="l.ts.slice(11, 19)"></span>
          <span :class="{'text-red-400': l.level === 'error', 'text-amber-400': l.level === 'warn', 'text-neutral-400': l.level === 'info', 'text-neutral-600': l.level === 'debug'}"
                x-text="' [' + l.level + '] '"></span>
          <span x-text="l.msg + (l.data ? ' ' + JSON.stringify(l.data) : '')"></span>
        </div>
      </template>
      <div x-show="logs.length === 0" class="text-neutral-600">no log entries yet — run a query</div>
    </div>
  </section>
</main>

<footer class="px-6 py-4 text-neutral-600 text-xs">
  malja-mcp demo dashboard — data © UNHCR Refugee Data Finder. This page is for demonstration;
  connect an MCP client to the endpoint above for real use.
</footer>

<script>
function dashboard() {
  return {
    status: {},
    logs: [],
    connected: false,
    samples: [
      { label: 'search_country — "egypt"', tool: 'search_country', args: { query: 'egypt' } },
      { label: 'latest_statistics — global', tool: 'latest_statistics', args: {} },
      { label: 'top_host_countries — top 10', tool: 'top_host_countries', args: { limit: 10 } },
      { label: 'compare_countries — Egypt vs Jordan', tool: 'compare_countries', args: { countries: ['Egypt', 'Jordan'] } },
      { label: 'trend_analysis — Sudan (origin)', tool: 'trend_analysis', args: { country: 'Sudan', role: 'origin' } },
      { label: 'generate_chart — Syria, mermaid', tool: 'generate_chart', args: { countries: ['Syria'], format: 'mermaid' } },
      { label: 'provider_health', tool: 'provider_health', args: {} }
    ],
    selectedSample: 0,
    callArgs: '',
    callResult: '',
    callError: false,
    running: false,
    init() {
      this.applySample();
      this.poll();
      this.pollLogs();
      setInterval(() => this.poll(), 5000);
      setInterval(() => this.pollLogs(), 3000);
    },
    currentTool() {
      var s = this.samples[this.selectedSample];
      return s ? s.tool : '';
    },
    applySample() {
      var s = this.samples[this.selectedSample];
      if (s) this.callArgs = JSON.stringify(s.args, null, 2);
    },
    cacheHitRate() {
      var c = this.status.cache;
      if (!c) return '—';
      var total = c.hits + c.misses;
      if (total === 0) return '0%';
      return Math.round((c.hits / total) * 100) + '%';
    },
    poll() {
      fetch('/api/status')
        .then((r) => r.json())
        .then((s) => { this.status = s; this.connected = true; })
        .catch(() => { this.connected = false; });
    },
    pollLogs() {
      fetch('/api/logs')
        .then((r) => r.json())
        .then((d) => {
          this.logs = d.logs.slice(-100).reverse();
        })
        .catch(() => {});
    },
    run() {
      var args;
      try {
        args = this.callArgs.trim() === '' ? {} : JSON.parse(this.callArgs);
      } catch (e) {
        this.callError = true;
        this.callResult = 'invalid JSON arguments: ' + e.message;
        return;
      }
      this.running = true;
      this.callError = false;
      this.callResult = '';
      fetch('/api/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: this.currentTool(), arguments: args })
      })
        .then((r) => r.json())
        .then((result) => {
          this.callError = result.isError === true;
          var texts = (result.content || [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text);
          this.callResult = texts.join('\n\n') || JSON.stringify(result, null, 2);
        })
        .catch((e) => {
          this.callError = true;
          this.callResult = String(e);
        })
        .finally(() => { this.running = false; });
    }
  };
}
</script>
</body>
</html>`;
