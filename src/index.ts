import { loadConfig, expandPath } from './config.js';
import { ProxyServer } from './proxy-server.js';
import { setLogLevel, log } from './logger.js';
import { homedir } from 'os';
import { resolve } from 'path';

// ─── Default config path ─────────────────────────────────────────────

const DEFAULT_CONFIG = resolve(homedir(), '.mcp-on-demand', 'config.json');

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  // Parse --config flag
  const args = process.argv.slice(2);
  let configPath = DEFAULT_CONFIG;

  const configIdx = args.indexOf('--config');
  if (configIdx >= 0 && args[configIdx + 1]) {
    configPath = expandPath(args[configIdx + 1]);
  }

  // Parse --log-level flag
  const logIdx = args.indexOf('--log-level');
  if (logIdx >= 0 && args[logIdx + 1]) {
    setLogLevel(args[logIdx + 1] as any);
  }

  try {
    const config = loadConfig(configPath);
    setLogLevel(config.settings.logLevel);

    log.info(`mcp-on-demand v1.0.0`);
    log.info(`Config: ${configPath}`);
    log.info(`Servers: ${Object.keys(config.servers).length}`);
    log.info(`Idle timeout: ${config.settings.idleTimeout}s`);

    const proxy = new ProxyServer(config);

    // Graceful shutdown
    const shutdown = async () => {
      await proxy.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await proxy.start();
  } catch (err) {
    log.error('Fatal:', err);
    process.exit(1);
  }
}

main();
