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
      { name: 'mcp-on-demand', version: '1.1.0' },
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

    log.info(
      `Proxy ready: ${this.schemaCache.toolCount} tools from ` +
      `${Object.keys(this.config.servers).length} servers (all lazy-loaded)`
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    log.info('Connected to Cursor via stdio.');
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

      const serverName = this.schemaCache.getServerForTool(toolName);

      if (!serverName) {
        return {
          content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
          isError: true,
        };
      }

      const originalToolName = this.schemaCache.getOriginalToolName(
        toolName,
        this.config.settings.prefixTools
      );

      try {
        log.debug(`${toolName} -> ${serverName}/${originalToolName}`);
        const result = await this.childManager.callTool(
          serverName,
          originalToolName,
          toolArgs
        );
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Tool call failed (${serverName}/${originalToolName}): ${errorMsg}`);
        return {
          content: [{ type: 'text', text: `Error calling ${toolName}: ${errorMsg}` }],
          isError: true,
        };
      }
    });
  }

  async shutdown(): Promise<void> {
    log.info('Proxy shutting down...');
    await this.childManager.shutdownAll();
    await this.server.close();
    log.info('Proxy stopped.');
  }
}
