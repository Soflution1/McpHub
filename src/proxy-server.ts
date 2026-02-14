import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ProxyConfig } from './config.js';
import { SchemaCache } from './schema-cache.js';
import { ChildManager } from './child-manager.js';
import { log } from './logger.js';

// ─── Proxy Server ────────────────────────────────────────────────────

export class ProxyServer {
  private server: Server;
  private childManager: ChildManager;
  private schemaCache: SchemaCache;
  private config: ProxyConfig;

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
      {
        name: 'mcp-on-demand',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  /**
   * Start the proxy server on stdio (Cursor connects here).
   */
  async start(): Promise<void> {
    // Load schema cache
    const cacheLoaded = this.schemaCache.load();

    if (!cacheLoaded) {
      log.info('No cache found. Generating schemas from all servers...');
      await this.generateAllSchemas();
    }

    log.info(
      `mcp-on-demand proxy ready: ${this.schemaCache.toolCount} tools ` +
      `from ${Object.keys(this.config.servers).length} servers (all lazy)`
    );

    // Connect to Cursor via stdio
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    log.info('Connected to Cursor via stdio. Proxy is running.');
  }

  /**
   * Generate schemas by briefly starting each server.
   */
  async generateAllSchemas(): Promise<void> {
    const serverNames = Object.keys(this.config.servers);
    log.info(`Generating schemas for ${serverNames.length} servers...`);

    for (const name of serverNames) {
      try {
        log.server(name, 'Discovering tools...');
        const tools = await this.childManager.discoverTools(name);
        this.schemaCache.updateServer(name, tools);
        log.server(name, `Cached ${tools.length} tools`);
        // Stop the server after discovery (we only needed the schemas)
        await this.childManager.stopServer(name);
      } catch (err) {
        log.error(`Failed to discover tools for ${name}:`, err);
        // Continue with other servers
      }
    }

    this.schemaCache.save();
    log.info(`Schema generation complete: ${this.schemaCache.toolCount} total tools cached`);
  }

  // ─── MCP Protocol Handlers ────────────────────────────────────────

  private registerHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.schemaCache.getAllTools(this.config.settings.prefixTools);

      log.debug(`tools/list: returning ${tools.length} tools (${this.childManager.runningCount} servers active)`);

      return {
        tools: tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
        })),
      };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name: toolName, arguments: args } = request.params;
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      // Find which server owns this tool
      const lookupName = this.config.settings.prefixTools ? toolName : toolName;
      const serverName = this.schemaCache.getServerForTool(lookupName);

      if (!serverName) {
        log.warn(`Tool not found: ${toolName}`);
        return {
          content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
          isError: true,
        };
      }

      // Get the original tool name (in case of prefixing)
      const originalToolName = this.schemaCache.getOriginalToolName(
        toolName,
        this.config.settings.prefixTools
      );

      try {
        log.debug(`Routing ${toolName} -> ${serverName}/${originalToolName}`);

        // This will auto-start the server if needed (lazy loading!)
        const result = await this.childManager.callTool(
          serverName,
          originalToolName,
          toolArgs
        );

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Tool call failed (${serverName}/${originalToolName}):`, errorMsg);

        return {
          content: [{ type: 'text', text: `Error calling ${toolName}: ${errorMsg}` }],
          isError: true,
        };
      }
    });
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    log.info('Proxy shutting down...');
    await this.childManager.shutdownAll();
    await this.server.close();
    log.info('Proxy stopped.');
  }
}
