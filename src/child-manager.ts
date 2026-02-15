import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ServerConfig } from './config.js';
import { ToolSchema, SchemaCache } from './schema-cache.js';
import { log } from './logger.js';

interface ManagedServer {
  name: string;
  config: ServerConfig;
  client: Client | null;
  transport: StdioClientTransport | null;
  status: 'stopped' | 'starting' | 'running' | 'error';
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  startPromise: Promise<Client> | null;
}

export class ChildManager {
  private servers: Map<string, ManagedServer> = new Map();
  private defaultIdleTimeout: number;
  private startupTimeout: number;
  private schemaCache: SchemaCache;

  constructor(
    serverConfigs: Record<string, ServerConfig>,
    schemaCache: SchemaCache,
    defaultIdleTimeout: number = 300,
    startupTimeout: number = 30000,
  ) {
    this.defaultIdleTimeout = defaultIdleTimeout;
    this.startupTimeout = startupTimeout;
    this.schemaCache = schemaCache;

    for (const [name, config] of Object.entries(serverConfigs)) {
      this.servers.set(name, {
        name,
        config,
        client: null,
        transport: null,
        status: 'stopped',
        lastActivity: 0,
        idleTimer: null,
        startPromise: null,
      });
    }

    log.info(`Child manager initialized with ${this.servers.size} servers (all sleeping)`);
  }

  async getClient(serverName: string): Promise<Client> {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`Unknown server: ${serverName}`);

    if (server.status === 'running' && server.client) {
      this.resetIdleTimer(server);
      return server.client;
    }

    if (server.status === 'starting' && server.startPromise) {
      return server.startPromise;
    }

    server.startPromise = this.startServer(server);
    return server.startPromise;
  }

  private async startServer(server: ManagedServer): Promise<Client> {
    server.status = 'starting';
    const startTime = Date.now();
    log.server(server.name, 'Starting on-demand...');

    try {
      const transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args ?? [],
        env: {
          ...process.env as Record<string, string>,
          ...server.config.env,
        },
      });

      const client = new Client(
        { name: `mcp-on-demand/${server.name}`, version: '1.0.0' },
        { capabilities: {} }
      );

      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Startup timeout (${this.startupTimeout}ms)`)), this.startupTimeout)
        ),
      ]);

      server.client = client;
      server.transport = transport;
      server.status = 'running';
      server.lastActivity = Date.now();
      server.startPromise = null;

      const elapsed = Date.now() - startTime;
      log.server(server.name, `Ready in ${elapsed}ms`);

      this.resetIdleTimer(server);

      transport.onclose = () => {
        if (server.status === 'running') {
          log.server(server.name, 'Disconnected unexpectedly');
          this.cleanupServer(server);
        }
      };

      return client;
    } catch (err) {
      server.status = 'error';
      server.startPromise = null;
      log.error(`Failed to start ${server.name}:`, err);
      throw err;
    }
  }

  async stopServer(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server || server.status === 'stopped') return;

    log.server(serverName, 'Stopping (idle timeout)');

    try {
      if (server.client) {
        await server.client.close();
      }
    } catch {}

    this.cleanupServer(server);
  }

  async discoverTools(serverName: string): Promise<ToolSchema[]> {
    const client = await this.getClient(serverName);
    const result = await client.listTools();

    const tools: ToolSchema[] = (result.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));

    log.server(serverName, `Discovered ${tools.length} tools`);
    return tools;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<any> {
    const client = await this.getClient(serverName);
    const server = this.servers.get(serverName)!;
    server.lastActivity = Date.now();
    this.resetIdleTimer(server);

    log.debug(`Calling ${serverName}/${toolName}`);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  getStatus(): Array<{ name: string; status: string; uptime: number }> {
    return Array.from(this.servers.values()).map(s => ({
      name: s.name,
      status: s.status,
      uptime: s.status === 'running' ? Math.floor((Date.now() - s.lastActivity) / 1000) : 0,
    }));
  }

  get runningCount(): number {
    return Array.from(this.servers.values()).filter(s => s.status === 'running').length;
  }

  async shutdownAll(): Promise<void> {
    log.info('Shutting down all child servers...');
    const promises = Array.from(this.servers.keys()).map(name => this.stopServer(name));
    await Promise.allSettled(promises);
    log.info('All child servers stopped.');
  }

  private resetIdleTimer(server: ManagedServer): void {
    if (server.config.persistent) return;
    if (server.idleTimer) clearTimeout(server.idleTimer);
    const timeout = (server.config.idleTimeout ?? this.defaultIdleTimeout) * 1000;
    server.idleTimer = setTimeout(() => {
      this.stopServer(server.name);
    }, timeout);
  }

  private cleanupServer(server: ManagedServer): void {
    if (server.idleTimer) {
      clearTimeout(server.idleTimer);
      server.idleTimer = null;
    }
    server.client = null;
    server.transport = null;
    server.status = 'stopped';
    server.startPromise = null;
  }
}
