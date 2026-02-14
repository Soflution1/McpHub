#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { loadConfig, migrateCursorConfig, expandPath, ProxyConfig } from './config.js';
import { ProxyServer } from './proxy-server.js';
import { setLogLevel, log } from './logger.js';

// ─── Paths ───────────────────────────────────────────────────────────

const CONFIG_DIR = resolve(homedir(), '.mcp-on-demand');
const DEFAULT_CONFIG = resolve(CONFIG_DIR, 'config.json');
const CURSOR_GLOBAL_MCP = resolve(homedir(), '.cursor', 'mcp.json');

// ─── Helpers ─────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
╔══════════════════════════════════════════════════╗
║           mcp-on-demand v1.0.0                   ║
║   Lazy-loading MCP proxy for Cursor IDE          ║
╚══════════════════════════════════════════════════╝

USAGE:
  mcp-on-demand                  Start the proxy server (Cursor calls this)
  mcp-on-demand generate         Generate/refresh tool schema cache
  mcp-on-demand migrate          Import servers from Cursor's mcp.json
  mcp-on-demand status           Show server configuration status
  mcp-on-demand init             Create default config and setup Cursor
  mcp-on-demand help             Show this help

OPTIONS:
  --config <path>    Config file path (default: ~/.mcp-on-demand/config.json)
  --log-level <lvl>  Log level: debug, info, warn, error, silent

QUICK START:
  1. mcp-on-demand migrate       # Import your existing Cursor MCP servers
  2. mcp-on-demand generate      # Cache tool schemas (starts each server briefly)
  3. Update Cursor's mcp.json    # Point Cursor to the proxy (shown after migrate)
  4. Restart Cursor               # Done! Servers now load on-demand

DOCUMENTATION:
  https://github.com/Soflution1/mcp-on-demand
`);
}

function printBanner(): void {
  console.log(`
  ┌─────────────────────────────────────┐
  │       ⚡ mcp-on-demand v1.0.0       │
  │   Lazy MCP proxy for Cursor IDE     │
  └─────────────────────────────────────┘
`);
}

// ─── Commands ────────────────────────────────────────────────────────

async function cmdInit(): Promise<void> {
  printBanner();
  console.log('Setting up mcp-on-demand...\n');

  mkdirSync(CONFIG_DIR, { recursive: true });

  if (existsSync(DEFAULT_CONFIG)) {
    console.log(`Config already exists: ${DEFAULT_CONFIG}`);
    console.log('Use "mcp-on-demand migrate" to update from Cursor.\n');
    return;
  }

  // Create example config
  const exampleConfig = {
    settings: {
      idleTimeout: 300,
      cacheDir: resolve(CONFIG_DIR, 'cache'),
      logLevel: 'info',
      startupTimeout: 30000,
      prefixTools: false,
    },
    servers: {
      'example-server': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-example'],
        env: {},
      },
    },
  };

  writeFileSync(DEFAULT_CONFIG, JSON.stringify(exampleConfig, null, 2));
  console.log(`Created config: ${DEFAULT_CONFIG}`);
  console.log('\nNext steps:');
  console.log('  1. Edit the config to add your MCP servers');
  console.log('     OR run: mcp-on-demand migrate');
  console.log('  2. Run: mcp-on-demand generate');
  console.log('  3. Update Cursor mcp.json (see below)\n');

  printCursorConfig();
}

async function cmdMigrate(configPath: string): Promise<void> {
  printBanner();

  // Find Cursor config
  let cursorPath = CURSOR_GLOBAL_MCP;
  if (!existsSync(cursorPath)) {
    console.log(`Cursor config not found at: ${cursorPath}`);
    console.log('Specify with: mcp-on-demand migrate --cursor-config <path>');
    process.exit(1);
  }

  console.log(`Reading Cursor config: ${cursorPath}`);
  const proxyConfig = migrateCursorConfig(cursorPath);

  const serverCount = Object.keys(proxyConfig.servers).length;
  console.log(`Found ${serverCount} MCP servers:\n`);

  for (const [name, cfg] of Object.entries(proxyConfig.servers)) {
    console.log(`  ${name}`);
    console.log(`    command: ${cfg.command} ${(cfg.args ?? []).join(' ')}`);
  }

  // Save proxy config
  mkdirSync(CONFIG_DIR, { recursive: true });
  proxyConfig.settings.cacheDir = resolve(CONFIG_DIR, 'cache');
  writeFileSync(configPath, JSON.stringify(proxyConfig, null, 2));

  console.log(`\nProxy config saved: ${configPath}`);
  console.log('\nNext steps:');
  console.log('  1. Run: mcp-on-demand generate');
  console.log('  2. Replace your Cursor mcp.json with:\n');

  printCursorConfig();

  // Backup original Cursor config
  const backupPath = cursorPath + '.backup';
  if (!existsSync(backupPath)) {
    const original = readFileSync(cursorPath, 'utf-8');
    writeFileSync(backupPath, original);
    console.log(`\nOriginal Cursor config backed up to: ${backupPath}`);
  }
}

async function cmdGenerate(configPath: string): Promise<void> {
  printBanner();
  setLogLevel('info');

  console.log('Generating tool schemas (briefly starting each server)...\n');

  const config = loadConfig(configPath);
  const proxy = new ProxyServer(config);
  await proxy.generateAllSchemas();

  console.log('\nSchema cache is ready! You can now start the proxy.');
  console.log('Cursor will see all tools without all servers running.\n');

  // Shutdown
  await proxy.shutdown();
}

async function cmdStatus(configPath: string): Promise<void> {
  printBanner();

  if (!existsSync(expandPath(configPath))) {
    console.log('No config found. Run: mcp-on-demand init');
    return;
  }

  const config = loadConfig(configPath);
  const serverCount = Object.keys(config.servers).length;

  console.log(`Config: ${configPath}`);
  console.log(`Servers: ${serverCount}`);
  console.log(`Idle timeout: ${config.settings.idleTimeout}s`);
  console.log(`Cache dir: ${config.settings.cacheDir}`);
  console.log(`Prefix tools: ${config.settings.prefixTools}`);
  console.log(`\nConfigured servers:\n`);

  for (const [name, cfg] of Object.entries(config.servers)) {
    const persistent = cfg.persistent ? ' [persistent]' : '';
    const group = cfg.group ? ` (${cfg.group})` : '';
    console.log(`  ${name}${group}${persistent}`);
    console.log(`    ${cfg.command} ${(cfg.args ?? []).join(' ')}`);
  }

  // Check cache
  const cacheFile = resolve(config.settings.cacheDir, 'schemas.json');
  if (existsSync(cacheFile)) {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
    const totalTools = Object.values(cache.servers as Record<string, any>)
      .reduce((sum: number, s: any) => sum + s.tools.length, 0);
    console.log(`\nSchema cache: ${totalTools} tools cached`);
    console.log(`  Generated: ${cache.generatedAt}`);
  } else {
    console.log('\nSchema cache: NOT GENERATED');
    console.log('  Run: mcp-on-demand generate');
  }

  // Estimate RAM savings
  const estimatedRamPerServer = 120; // MB average per MCP server
  const savedRam = serverCount * estimatedRamPerServer;
  console.log(`\nEstimated RAM savings: ~${(savedRam / 1024).toFixed(1)} GB`);
  console.log(`  (${serverCount} servers x ~${estimatedRamPerServer} MB average)`);
  console.log(`  Instead of all running, only active servers use RAM.\n`);
}

function printCursorConfig(): void {
  const nodeExec = process.execPath;
  console.log('  ~/.cursor/mcp.json:');
  console.log('  {');
  console.log('    "mcpServers": {');
  console.log('      "mcp-on-demand": {');
  console.log('        "command": "npx",');
  console.log('        "args": ["-y", "mcp-on-demand"]');
  console.log('      }');
  console.log('    }');
  console.log('  }');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args.find(a => !a.startsWith('--'));

  // Parse --config
  let configPath = DEFAULT_CONFIG;
  const configIdx = args.indexOf('--config');
  if (configIdx >= 0 && args[configIdx + 1]) {
    configPath = expandPath(args[configIdx + 1]);
  }

  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'migrate':
      await cmdMigrate(configPath);
      break;
    case 'generate':
      await cmdGenerate(configPath);
      break;
    case 'status':
      await cmdStatus(configPath);
      break;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      break;
    case undefined:
      // No command = start proxy (default, for Cursor to call)
      // Import and run the main index
      const { loadConfig: lc } = await import('./config.js');
      const { ProxyServer: PS } = await import('./proxy-server.js');

      const logIdx = args.indexOf('--log-level');
      if (logIdx >= 0 && args[logIdx + 1]) {
        setLogLevel(args[logIdx + 1] as any);
      }

      const config = lc(configPath);
      setLogLevel(config.settings.logLevel);

      log.info(`mcp-on-demand v1.0.0`);
      log.info(`Config: ${configPath}`);
      log.info(`Servers: ${Object.keys(config.servers).length}`);

      const proxy = new PS(config);

      const shutdown = async () => {
        await proxy.shutdown();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await proxy.start();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
