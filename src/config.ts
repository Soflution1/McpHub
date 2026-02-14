import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';

// ─── Types ───────────────────────────────────────────────────────────

export interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Group name for categorization (optional) */
  group?: string;
  /** Override idle timeout for this specific server (seconds) */
  idleTimeout?: number;
  /** Always keep this server running (never idle-kill) */
  persistent?: boolean;
}

export interface ProxySettings {
  /** Seconds before an idle server is stopped (default: 300 = 5 min) */
  idleTimeout: number;
  /** Directory for schema cache files */
  cacheDir: string;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Max time (ms) to wait for a child server to start */
  startupTimeout: number;
  /** Prefix tool names with server name to avoid collisions */
  prefixTools: boolean;
}

export interface ProxyConfig {
  settings: ProxySettings;
  servers: Record<string, ServerConfig>;
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: ProxySettings = {
  idleTimeout: 300,
  cacheDir: resolve(homedir(), '.mcp-on-demand', 'cache'),
  logLevel: 'info',
  startupTimeout: 30000,
  prefixTools: false,
};

// ─── Loader ──────────────────────────────────────────────────────────

export function expandPath(p: string): string {
  if (p.startsWith('~')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function loadConfig(configPath: string): ProxyConfig {
  const fullPath = expandPath(configPath);

  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  const raw = JSON.parse(readFileSync(fullPath, 'utf-8'));

  const settings: ProxySettings = {
    ...DEFAULT_SETTINGS,
    ...raw.settings,
  };

  settings.cacheDir = expandPath(settings.cacheDir);

  if (!raw.servers || Object.keys(raw.servers).length === 0) {
    throw new Error('Config must contain at least one server in "servers"');
  }

  return { settings, servers: raw.servers };
}

// ─── Migrate from Cursor mcp.json ───────────────────────────────────

export interface CursorMcpJson {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
  }>;
}

export function migrateCursorConfig(cursorConfigPath: string): ProxyConfig {
  const fullPath = expandPath(cursorConfigPath);
  const raw: CursorMcpJson = JSON.parse(readFileSync(fullPath, 'utf-8'));

  const servers: Record<string, ServerConfig> = {};

  if (raw.mcpServers) {
    for (const [name, cfg] of Object.entries(raw.mcpServers)) {
      servers[name] = {
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
      };
    }
  }

  return {
    settings: { ...DEFAULT_SETTINGS },
    servers,
  };
}
