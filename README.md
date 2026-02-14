# mcp-on-demand

**Lazy-loading MCP proxy for Cursor IDE. Start MCP servers on-demand, save GBs of RAM.**

> Stop running 20+ MCP servers at startup. Let them sleep until you need them.

## The Problem

Every MCP server in your Cursor config spawns multiple Node.js processes **at startup**, regardless of whether you use them. With 20 servers, that's 60-80 processes consuming **8-10 GB of RAM** doing absolutely nothing.

## The Solution

**mcp-on-demand** replaces all your MCP servers with a single lightweight proxy (~50 MB). Cursor sees all your tools normally, but the actual servers only start when you call one of their tools. After a configurable idle period, they shut down automatically.

```
Before:  22 servers → 80 processes → 9.6 GB RAM at startup
After:   1 proxy   → 1 process   → ~50 MB (servers start on-demand)
```

## How It Works

```
Cursor  ←stdio→  mcp-on-demand proxy  ←stdio→  MCP Servers (on-demand)
                       │
                  Schema Cache
                  (all tools indexed)
```

1. **Proxy starts** with cached tool schemas (all tools visible to Cursor)
2. **Cursor lists tools** → proxy returns all tools from cache (instant, no servers running)
3. **Cursor calls a tool** → proxy identifies the server, starts it on-demand, forwards the call
4. **Server goes idle** → proxy shuts it down after timeout (default: 5 min)

## Quick Start

### 1. Install

```bash
npm install -g mcp-on-demand
```

### 2. Import your existing Cursor config

```bash
mcp-on-demand migrate
```

This reads your `~/.cursor/mcp.json`, creates the proxy config, and backs up your original.

### 3. Generate tool schemas

```bash
mcp-on-demand generate
```

This briefly starts each server to discover its tools, then caches the schemas and stops them.

### 4. Update Cursor to use the proxy

Replace your `~/.cursor/mcp.json` with:

```json
{
  "mcpServers": {
    "mcp-on-demand": {
      "command": "npx",
      "args": ["-y", "mcp-on-demand"]
    }
  }
}
```

### 5. Restart Cursor

That's it. All your tools work exactly as before, but servers only run when needed.

## Commands

| Command | Description |
|---------|-------------|
| `mcp-on-demand` | Start the proxy (Cursor calls this) |
| `mcp-on-demand migrate` | Import servers from Cursor's mcp.json |
| `mcp-on-demand generate` | Generate/refresh the tool schema cache |
| `mcp-on-demand status` | Show config, servers, and estimated RAM savings |
| `mcp-on-demand init` | Create a fresh default config |
| `mcp-on-demand help` | Show help |

### Options

```
--config <path>     Config file (default: ~/.mcp-on-demand/config.json)
--log-level <level> debug | info | warn | error | silent
```

## Configuration

Config file: `~/.mcp-on-demand/config.json`

```json
{
  "settings": {
    "idleTimeout": 300,
    "cacheDir": "~/.mcp-on-demand/cache",
    "logLevel": "info",
    "startupTimeout": 30000,
    "prefixTools": false
  },
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" },
      "group": "dev"
    },
    "supabase": {
      "command": "npx",
      "args": ["supabase", "mcp"],
      "persistent": true
    }
  }
}
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `idleTimeout` | `300` | Seconds before an idle server is stopped |
| `cacheDir` | `~/.mcp-on-demand/cache` | Where tool schemas are cached |
| `logLevel` | `info` | Logging verbosity |
| `startupTimeout` | `30000` | Max ms to wait for a server to start |
| `prefixTools` | `false` | Prefix tool names with server name (avoids collisions) |

### Server Options

| Option | Type | Description |
|--------|------|-------------|
| `command` | string | Command to start the server |
| `args` | string[] | Command arguments |
| `env` | object | Environment variables |
| `group` | string | Grouping label (informational) |
| `idleTimeout` | number | Override global idle timeout for this server |
| `persistent` | boolean | Never idle-kill this server |

## When to Regenerate Schemas

Run `mcp-on-demand generate` again when you:

- Add a new MCP server to your config
- Update an MCP server package (tools may have changed)
- See "unknown tool" errors

## Architecture

The proxy is transparent to Cursor. It implements the full MCP protocol (stdio transport) and appears as a single MCP server with all tools from all your configured servers.

The schema cache stores tool definitions (name, description, input schema) in a JSON file. This allows the proxy to respond to `tools/list` instantly without starting any servers.

When Cursor calls a tool, the proxy:
1. Looks up the tool name in its routing table
2. Checks if the owning server is running
3. If not, spawns the server as a child process with stdio MCP transport
4. Waits for the server to initialize (typically 200-500ms)
5. Forwards the tool call and returns the result
6. Starts an idle timer for that server

Server lifecycle is fully automatic. No manual intervention needed.

## Compatibility

- **Cursor IDE**: Full support (stdio transport)
- **Claude Code**: Should work (uses same MCP protocol)
- **Windsurf**: Should work (stdio MCP)
- **VS Code + Copilot**: Should work (MCP support)
- **Node.js**: 18+

## Troubleshooting

**"No schema cache found"**
Run `mcp-on-demand generate` to create the cache.

**Tool call fails on first use**
The server is starting on-demand. If it takes too long, increase `startupTimeout` in settings.

**Tool name collision**
Two servers expose a tool with the same name. Enable `prefixTools: true` in settings. Tools will be named `servername__toolname`.

**Server won't stop**
Check if `persistent: true` is set for that server. Remove it to enable idle shutdown.

## Performance

| Metric | Before (22 servers) | After (mcp-on-demand) |
|--------|--------------------|-----------------------|
| Startup RAM | ~9.6 GB | ~50 MB |
| Processes at startup | ~80 | 1 |
| Tool call latency (warm) | instant | instant |
| Tool call latency (cold) | n/a | 200-800ms (first call) |
| Context tokens | ~15,000 | same (all tools listed) |

## License

MIT - SOFLUTION LTD

## Credits

Built by [SOFLUTION LTD](https://soflution.com) for the Cursor community.
