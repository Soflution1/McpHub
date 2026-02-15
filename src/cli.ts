#!/usr/bin/env node

import { autoDetectConfig } from './config.js';
import { SchemaCache } from './schema-cache.js';
import { homedir } from 'os';
import { resolve } from 'path';
import { existsSync, rmSync } from 'fs';

const VERSION = '1.1.0';

const command = process.argv[2];

function banner() {
  console.log('');
  console.log('  ⚡ mcp-on-demand v' + VERSION);
  console.log('  Lazy MCP proxy for Cursor IDE');
  console.log('');
}

function help() {
  banner();
  console.log('  Usage:');
  console.log('');
  console.log('  Just add this to your Cursor mcp.json and restart Cursor:');
  console.log('');
  console.log('  {');
  console.log('    "mcpServers": {');
  console.log('      "mcp-on-demand": {');
  console.log('        "command": "npx",');
  console.log('        "args": ["-y", "@soflution/mcp-on-demand"]');
  console.log('      }');
  console.log('    }');
  console.log('  }');
  console.log('');
  console.log('  Everything else is automatic. No terminal commands needed.');
  console.log('');
  console.log('  Optional commands:');
  console.log('    status     Show detected servers and cache info');
  console.log('    reset      Clear cache (forces re-discovery on next start)');
  console.log('    help       Show this help');
  console.log('');
}

function status() {
  banner();

  try {
    const config = autoDetectConfig();
    const servers = Object.keys(config.servers);
    const skipped = Object.entries(config.skipped || {});

    console.log(`  Cursor config: detected`);
    console.log(`  Servers to proxy: ${servers.length}`);
    servers.forEach(s => console.log(`    ✓ ${s}`));

    if (skipped.length > 0) {
      console.log(`\n  Skipped: ${skipped.length}`);
      skipped.forEach(([name, reason]) => console.log(`    ✗ ${name} (${reason})`));
    }

    const cacheDir = resolve(homedir(), '.mcp-on-demand', 'cache');
    const cacheFile = resolve(cacheDir, 'schemas.json');

    if (existsSync(cacheFile)) {
      const cache = new SchemaCache(cacheDir);
      cache.load();
      console.log(`\n  Cache: ${cache.toolCount} tools cached`);
    } else {
      console.log(`\n  Cache: not generated yet (will auto-generate on first start)`);
    }

    const estimatedSavings = servers.length * 400;
    console.log(`\n  Estimated RAM savings: ~${(estimatedSavings / 1024).toFixed(1)} GB at startup`);
  } catch (err) {
    console.log(`  Error: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
}

function reset() {
  banner();
  const cacheDir = resolve(homedir(), '.mcp-on-demand');

  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true });
    console.log('  Cache cleared. Will re-discover tools on next Cursor start.');
  } else {
    console.log('  No cache to clear.');
  }
  console.log('');
}

switch (command) {
  case 'status':
    status();
    break;
  case 'reset':
    reset();
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    import('./index.js');
    break;
}
