<p align="center">
  <img src="static/banner.png" alt="McpHub" width="900"/>
</p>

<p align="center">
  <strong>One proxy to rule all your MCP servers.</strong><br>
  <sub>SSE transport · Built-in web dashboard · ~99% context token savings · Zero dependencies</sub>
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/install-30s-brightgreen" alt="Install"/></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"/>
  <img src="https://img.shields.io/badge/binary-~1MB-yellow" alt="Binary size"/>
</p>

---

## What is McpHub?

McpHub is a single Rust binary that sits between your AI editor (Cursor, Claude Desktop, Windsurf) and all your MCP servers. Instead of loading 20+ servers with 200+ tool definitions into every prompt (~20,000 tokens), the editor sees only 2 tools: `discover` and `execute`. Token savings: **~99%**.

**v4.0 adds SSE transport:** McpHub runs as a persistent daemon. Your editor connects via URL instead of spawning a process. If Cursor crashes or restarts, McpHub stays alive and reconnects instantly. No manual refresh, no lost state.

## Install

### From source

```bash
git clone https://github.com/Soflution1/McpHub.git
cd McpHub
./install.sh
```

The install script builds the release binary (~1MB), installs to `~/.local/bin/McpHub`, codesigns for macOS, and generates the tool cache.

### Setup (recommended: SSE mode)

```bash
# 1. Generate tool cache (one-time, ~60s)
McpHub generate

# 2. Install as auto-start daemon
McpHub install

# 3. Configure your editor
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "McpHub": {
      "url": "http://127.0.0.1:24680/sse"
    }
  }
}
```

That's it. McpHub starts at login, survives editor restarts, and serves the dashboard on the same port.

### Setup (classic: stdio mode)

If you prefer the editor to manage the process lifecycle:

```json
{
  "mcpServers": {
    "McpHub": {
      "command": "/Users/you/.local/bin/McpHub"
    }
  }
}
```

In this mode, McpHub also starts the HTTP server on `:24680` (dashboard + SSE) in the background.

## Dashboard

Open `http://127.0.0.1:24680` or run:

```bash
McpHub dashboard
```

The dashboard lets you:
- **Add servers** by pasting JSON from any MCP server README
- **Edit servers** with syntax-highlighted JSON (tokens/secrets highlighted in red)
- **Enable/disable** servers with a toggle
- **Rebuild cache** in one click
- **Monitor** token savings, cached vs failed servers

## How It Works

```
Cursor (sees only 2 tools: discover + execute)
    ↓ SSE (http://127.0.0.1:24680/sse)
McpHub daemon (BM25 search index, <0.01ms)
    ↓ stdio
Your MCP servers (spawned on demand, killed when idle)
```

### Discover mode (default)

1. LLM calls `discover("send email")`
2. McpHub searches across all tools using BM25 ranking
3. Returns matching tools with full schemas + server list
4. LLM calls `execute("resend", "send-email", {to: "...", ...})`
5. McpHub spawns the server (if not running), calls the tool, returns result

Server names are resolved case-insensitively (e.g. `MemoryPilot`, `memory-pilot`, `memorypilot` all match).

### Passthrough mode

All tools exposed directly with `server__tool` prefix. Full visibility, higher token cost. Set `"mode": "passthrough"` in settings.

## Transport Modes

| Mode | Command | Editor config | Survives editor crash |
|---|---|---|---|
| **SSE (recommended)** | `McpHub serve` or `McpHub install` | `"url": "http://127.0.0.1:24680/sse"` | Yes |
| **stdio** | `McpHub` (default) | `"command": "/path/to/McpHub"` | No |

SSE transport uses Server-Sent Events: the editor opens a persistent HTTP connection, McpHub streams JSON-RPC responses through it. TCP keepalive detects dead connections, a session reaper cleans up stale sessions, and `try_send` prevents slow clients from blocking the server.

## CLI

```bash
McpHub                  # Start proxy (stdio + HTTP server on :24680)
McpHub serve            # Start HTTP-only server (SSE, no stdio)
McpHub install          # Register auto-start at login (macOS/Linux/Windows)
McpHub uninstall        # Remove auto-start
McpHub generate         # Rebuild tool cache
McpHub dashboard        # Open web dashboard
McpHub status           # Show detected servers and cache info
McpHub search "git"     # Test BM25 search
McpHub version          # Show version
```

## Configuration

Config lives in `~/.McpHub/config.json`:

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  },
  "settings": {
    "mode": "discover",
    "idleTimeout": 300,
    "health": {
      "checkInterval": 30,
      "autoRestart": true,
      "notifications": true
    }
  }
}
```

### Health monitoring

McpHub pings running servers periodically. If one crashes, you get a native OS notification (macOS alert, Windows toast, Linux D-Bus) and the server is auto-restarted with exponential backoff (up to 3 attempts).

## Performance

| Metric | Value |
|---|---|
| Binary size | ~1MB |
| Startup | <5ms |
| BM25 search (460 tools) | <0.01ms |
| Context token savings | ~99% |
| RAM usage | ~5MB |
| SSE keepalive overhead | ~40 bytes/15s |
| Runtime dependencies | **None** |

## Cross-platform auto-start

`McpHub install` detects your OS and creates the appropriate auto-start entry:

| OS | Method | Location |
|---|---|---|
| macOS | LaunchAgent | `~/Library/LaunchAgents/com.soflution.mcphub.plist` |
| Linux | systemd user service | `~/.config/systemd/user/mcphub.service` |
| Windows | Registry Run key | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |

`McpHub uninstall` removes it cleanly.

## Environment Variables

| Variable | Values | Default |
|---|---|---|
| `MCP_ON_DEMAND_MODE` | `discover` / `passthrough` | `discover` |
| `MCP_ON_DEMAND_PRELOAD` | `all` / `none` | `all` |

## Uninstall

```bash
McpHub uninstall
rm ~/.local/bin/McpHub
rm -rf ~/.McpHub
```

## License

MIT - [SOFLUTION LTD](https://soflution.com)
