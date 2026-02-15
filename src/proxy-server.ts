import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ProxyConfig } from './config.js';
import { SchemaCache } from './schema-cache.js';
import { ChildManager } from './child-manager.js';
import { ToolSearchEngine } from './tool-search.js';
import { log } from './logger.js';

export class ProxyServer {
  private server: Server;
  private childManager: ChildManager;
  private schemaCache: SchemaCache;
  private config: ProxyConfig;
  private searchEngine: ToolSearchEngine | null = null;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.schemaCache = new SchemaCache(config.settings.cacheDir);
    this.childManager = new ChildManager(
      config.servers,
      this.schemaCache,
      config.settings.idleTimeout,
      config.settings.startupTimeout,
    );
    this.server = new Server(
      { name: 'mcp-on-demand', version: '1.3.1' },
      { capabilities: { tools: {} } }
    );
    this.registerHandlers();
  }

  async start(): Promise<void> {
    const cacheLoaded = this.schemaCache.load();

    if (!cacheLoaded) {
      log.info('No cache found. Auto-generating schemas (first run)...');
      log.info('This may take 30-60 seconds. Subsequent starts will be instant.');
      await this.generateAllSchemas();
    }

    if (this.config.settings.mode === 'tool-search') {
      this.searchEngine = new ToolSearchEngine(this.schemaCache);
      this.searchEngine.buildIndex();
      log.info(
        `[TOOL-SEARCH MODE] Exposing 2 meta-tools instead of ${this.schemaCache.toolCount} individual tools`
      );
    } else {
      log.info(
        `[PASSTHROUGH MODE] Exposing all ${this.schemaCache.toolCount} tools directly`
      );
    }

    log.info(
      `Proxy ready: ${this.schemaCache.toolCount} tools from ` +
      `${Object.keys(this.config.servers).length} servers`
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info('Connected to host via stdio.');

    this.preloadServers();
  }

  private async generateAllSchemas(): Promise<void> {
    const serverNames = Object.keys(this.config.servers);
    log.info(`Discovering tools from ${serverNames.length} servers...`);

    let totalTools = 0;
    let succeeded = 0;
    let failed = 0;

    for (const name of serverNames) {
      try {
        log.info(`  [${succeeded + failed + 1}/${serverNames.length}] ${name}...`);
        const tools = await this.childManager.discoverTools(name);
        this.schemaCache.updateServer(name, tools);
        totalTools += tools.length;
        succeeded++;
        log.info(`    -> ${tools.length} tools`);
        await this.childManager.stopServer(name);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`    -> failed: ${msg}`);
      }
    }

    this.schemaCache.save();
    log.info(`Schema generation complete: ${totalTools} tools from ${succeeded} servers (${failed} failed)`);
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (this.config.settings.mode === 'tool-search' && this.searchEngine) {
        return { tools: this.getMetaTools() };
      }
      const tools = this.schemaCache.getAllTools(this.config.settings.prefixTools);
      return {
        tools: tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name: toolName, arguments: args } = request.params;
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      if (this.config.settings.mode === 'tool-search' && this.searchEngine) {
        if (toolName === 'search_tools') return this.handleSearchTools(toolArgs);
        if (toolName === 'use_tool') return this.handleUseTool(toolArgs);
        return { content: [{ type: 'text', text: `Unknown meta-tool: ${toolName}` }], isError: true };
      }

      return this.callDirectTool(toolName, toolArgs);
    });
  }

  private getMetaTools() {
    const catalog = this.searchEngine!.getCatalog();
    const toolCount = this.searchEngine!.toolCount;
    return [
      {
        name: 'search_tools',
        description:
          `Search across ${toolCount} available tools from ${Object.keys(this.config.servers).length} MCP servers. ` +
          `Returns matching tools with their full schemas so you can call them via use_tool.\n\n` +
          `Available servers and capabilities:\n${catalog}`,
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query: tool name, keyword, server name, or capability' },
            max_results: { type: 'number', description: 'Maximum results (default: 10, max: 30)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'use_tool',
        description: 'Call a tool discovered via search_tools. Pass the exact tool name and its arguments.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tool_name: { type: 'string', description: 'Exact tool name from search_tools' },
            arguments: { type: 'object', description: 'Tool arguments matching the inputSchema', additionalProperties: true },
          },
          required: ['tool_name', 'arguments'],
        },
      },
    ];
  }

  private handleSearchTools(args: Record<string, unknown>) {
    const query = String(args.query || '');
    const maxResults = Math.min(Number(args.max_results) || 10, 30);
    if (!query.trim()) {
      return { content: [{ type: 'text', text: 'Provide a search query.' }] };
    }
    const results = this.searchEngine!.search(query, maxResults);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No tools found matching "${query}".` }] };
    }
    const formatted = results.map(r => ({ tool_name: r.name, server: r.server, description: r.description, parameters: r.inputSchema, relevance: r.score }));
    return { content: [{ type: 'text', text: JSON.stringify({ query, total_matches: results.length, tools: formatted, usage: 'Call use_tool with tool_name and arguments.' }, null, 2) }] };
  }

  private async handleUseTool(args: Record<string, unknown>) {
    const toolName = String(args.tool_name || '');
    const toolArgs = (args.arguments ?? {}) as Record<string, unknown>;
    if (!toolName) {
      return { content: [{ type: 'text', text: 'Error: tool_name is required.' }], isError: true };
    }
    return this.callDirectTool(toolName, toolArgs);
  }

  private async callDirectTool(toolName: string, toolArgs: Record<string, unknown>) {
    const serverName = this.schemaCache.getServerForTool(toolName);
    if (!serverName) {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
    const originalToolName = this.schemaCache.getOriginalToolName(toolName, this.config.settings.prefixTools);
    try {
      log.debug(`${toolName} -> ${serverName}/${originalToolName}`);
      return await this.childManager.callTool(serverName, originalToolName, toolArgs);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Tool call failed (${serverName}/${originalToolName}): ${errorMsg}`);
      return { content: [{ type: 'text', text: `Error: ${errorMsg}` }], isError: true };
    }
  }

  private async preloadServers(): Promise<void> {
    const preloadSetting = this.config.settings.preload;
    if (preloadSetting === 'none') {
      log.info('[PRELOAD] Disabled');
      return;
    }
    const serverNames = Object.keys(this.config.servers);
    let toPreload: string[];
    if (preloadSetting === 'all') {
      toPreload = serverNames;
    } else if (Array.isArray(preloadSetting)) {
      toPreload = preloadSetting.filter(s => serverNames.includes(s));
    } else {
      return;
    }
    log.info(`[PRELOAD] Warming up ${toPreload.length} servers in background...`);
    for (let i = 0; i < toPreload.length; i++) {
      const name = toPreload[i];
      if (i > 0) await new Promise(r => setTimeout(r, 2000));
      this.childManager.getClient(name)
        .then(() => log.info(`[PRELOAD] ${name} ready (${i + 1}/${toPreload.length})`))
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[PRELOAD] ${name} failed: ${msg}`);
        });
    }
  }

  async shutdown(): Promise<void> {
    log.info('Proxy shutting down...');
    await this.childManager.shutdownAll();
    await this.server.close();
    log.info('Proxy stopped.');
  }
}
