import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { log } from './logger.js';

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ServerSchemaCache {
  serverName: string;
  tools: ToolSchema[];
  cachedAt: string;
}

export interface FullCache {
  version: number;
  generatedAt: string;
  servers: Record<string, ServerSchemaCache>;
}

export class SchemaCache {
  private cacheDir: string;
  private cacheFile: string;
  private cache: FullCache | null = null;
  private toolRouting: Map<string, string> = new Map();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.cacheFile = resolve(cacheDir, 'schemas.json');
  }

  load(): boolean {
    if (!existsSync(this.cacheFile)) {
      log.warn('No schema cache found.');
      return false;
    }
    try {
      this.cache = JSON.parse(readFileSync(this.cacheFile, 'utf-8'));
      this.rebuildRouting();
      log.info(`Schema cache loaded: ${this.toolRouting.size} tools from ${Object.keys(this.cache!.servers).length} servers`);
      return true;
    } catch (e) {
      log.error('Failed to load schema cache:', e);
      return false;
    }
  }

  save(): void {
    if (!this.cache) return;
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    log.info(`Schema cache saved to ${this.cacheFile}`);
  }

  updateServer(serverName: string, tools: ToolSchema[]): void {
    if (!this.cache) {
      this.cache = { version: 1, generatedAt: new Date().toISOString(), servers: {} };
    }
    this.cache.servers[serverName] = { serverName, tools, cachedAt: new Date().toISOString() };
    this.rebuildRouting();
  }

  getAllTools(prefixWithServer: boolean = false): ToolSchema[] {
    if (!this.cache) return [];
    const allTools: ToolSchema[] = [];
    for (const [serverName, serverCache] of Object.entries(this.cache.servers)) {
      for (const tool of serverCache.tools) {
        const toolName = prefixWithServer ? `${serverName}__${tool.name}` : tool.name;
        allTools.push({ ...tool, name: toolName });
      }
    }
    return allTools;
  }

  getServerForTool(toolName: string): string | undefined {
    return this.toolRouting.get(toolName);
  }

  getOriginalToolName(toolName: string, prefixWithServer: boolean): string {
    if (!prefixWithServer) return toolName;
    const idx = toolName.indexOf('__');
    return idx >= 0 ? toolName.slice(idx + 2) : toolName;
  }

  hasServer(serverName: string): boolean {
    return !!this.cache?.servers[serverName];
  }

  get toolCount(): number { return this.toolRouting.size; }
  get serverNames(): string[] { return this.cache ? Object.keys(this.cache.servers) : []; }

  getServerToolSummary(): Array<{ server: string; toolCount: number; tools: string[] }> {
    if (!this.cache) return [];
    return Object.entries(this.cache.servers).map(([name, sc]) => ({
      server: name,
      toolCount: sc.tools.length,
      tools: sc.tools.map(t => t.name),
    }));
  }

  private rebuildRouting(): void {
    this.toolRouting.clear();
    if (!this.cache) return;
    for (const [serverName, serverCache] of Object.entries(this.cache.servers)) {
      for (const tool of serverCache.tools) {
        if (this.toolRouting.has(tool.name)) {
          log.warn(`Tool name collision: "${tool.name}" in both "${this.toolRouting.get(tool.name)}" and "${serverName}". Using first.`);
          continue;
        }
        this.toolRouting.set(tool.name, serverName);
      }
    }
  }
}
