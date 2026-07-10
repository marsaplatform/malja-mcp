import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { Logger } from '../../src/logger.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { HumanitarianProvider } from '../../src/providers/types.js';
import { Analytics } from '../../src/shared/analytics.js';
import { MockProvider } from './mock-provider.js';

/** AppContext wired for tests: silent logger, memory cache, mock provider. */
export function buildTestContext(
  provider: HumanitarianProvider = new MockProvider(),
  env: NodeJS.ProcessEnv = {},
): AppContext {
  const config = loadConfig({ HMCP_PROVIDERS: provider.id, HMCP_LOG_LEVEL: 'error', ...env });
  const registry = new ProviderRegistry();
  registry.register(provider);
  return {
    config,
    logger: new Logger('error', () => {}),
    cache: new InstrumentedCache(new MemoryCache()),
    registry,
    analytics: new Analytics(true),
  };
}
