# ⚡ mcp-on-demand

**Lazy-loading MCP proxy for Cursor IDE** — save GBs of RAM by starting MCP servers only when needed.

## The Problem

Every MCP server in your Cursor config starts immediately and stays running forever. With 10+ servers, that's **5-10 GB of RAM** wasted on servers you're not even using.

## The Solution

`mcp-on-demand` sits between Cursor and your MCP servers. It exposes all tools to Cursor but only starts a server when you actually call one of its tools. Idle servers are automatically stopped after 5 minutes.

**Before:** 22 servers, 80 processes, 9.6 GB RAM at startup
**After:** 1 proxy, 1 process, ~50 MB RAM (servers start on-demand in 200-500ms)

## Installation (30 seconds)

**Step 1:** Add this to your `~/.cursor/mcp.json` alongside your existing servers:

```json
{
  "mcpServers": {
    "mcp-on-demand": {
      "command": "npx",
      "args": ["-y", "@soflution/mcp-on-demand"]
    }
  }
}
```

**Step 2:** Restart Cursor. Done.

On first launch, the proxy automatically reads your other MCP servers from the same config file, briefly starts each one to discover its tools, caches the schemas, and then shuts them all down. Subsequent starts are instant.

## How It Works

```
Cursor ←stdio→ mcp-on-demand proxy ←stdio→ MCP Servers (spawned on-demand)
                     ↓
              Schema Cache (~50 MB)
              (all tools indexed)
```

1. Proxy starts with cached tool schemas (~50 MB RAM)
2. Cursor lists tools → proxy returns all from cache (no servers running)
3. Cursor calls a tool → proxy identifies owner server, spawns it on-demand
4. Server idles for 5 min → proxy kills it automatically

## What Gets Proxied

- **Proxied:** All stdio-based MCP servers (npx, node, python, etc.)
- **Skipped:** URL-based servers (like Vercel MCP), disabled servers, and the proxy itself
- Skipped servers continue working normally through Cursor's native handling

## Optional CLI Commands

These are optional — everything works automatically without them:

```bash
npx @soflution/mcp-on-demand status   # Show detected servers & cache info
npx @soflution/mcp-on-demand reset    # Clear cache (forces re-discovery)
npx @soflution/mcp-on-demand help     # Show help
```

## Configuration

The proxy works with zero configuration. For advanced users, you can create `~/.mcp-on-demand/config.json`:

```json
{
  "settings": {
    "idleTimeout": 300,
    "logLevel": "info",
    "startupTimeout": 30000,
    "prefixTools": false
  }
}
```

- `idleTimeout`: Seconds before stopping an idle server (default: 300)
- `logLevel`: debug, info, warn, error, silent
- `startupTimeout`: Max milliseconds to wait for a server to start
- `prefixTools`: Prefix tool names with server name to avoid collisions

## Requirements

- Node.js 18+
- Cursor IDE with MCP servers configured

## License

MIT — SOFLUTION LTD
