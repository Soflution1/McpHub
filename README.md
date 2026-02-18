# MCP on Demand

**One proxy to rule all your MCP servers.**

Replace 20+ MCP server entries in Cursor with a single intelligent proxy.
Built-in web dashboard. ~99% context token savings. Zero dependencies.

## Install (30 seconds)

```bash
curl -fsSL https://raw.githubusercontent.com/Soflution1/mcp-on-demand/main/install.sh | bash
```

That's it. The installer will:
1. Download a single binary (~800KB)
2. Auto-detect your Cursor MCP servers
3. Import them all into mcp-on-demand
4. Replace your Cursor config with one entry
5. Generate the tool cache
6. Open the dashboard

**Restart Cursor** and you're done.

### From source

```bash
git clone https://github.com/Soflution1/mcp-on-demand.git
cd mcp-on-demand && cargo build --release
cp target/release/mcp-on-demand ~/.local/bin/
mcp-on-demand dashboard
```

## Dashboard

Open `http://127.0.0.1:24680` or run:

```bash
mcp-on-demand dashboard
```

The dashboard lets you:
- **Add servers** by pasting JSON from any MCP server README
- **Edit servers** with syntax-highlighted JSON (tokens/secrets highlighted in red)
- **Enable/disable** servers with a toggle (like Cursor's native UI)
- **Rebuild cache** in one click
- **Monitor** token savings, cached vs failed servers

Supports Cursor JSON format, `mcpServers` wrapper, and bulk import.

> **Bookmark `http://127.0.0.1:24680`** for quick access.

## How It Works

**Before:** Cursor loads 20+ MCP servers = 200+ tool definitions = ~20,000 tokens per request.

**After:** Cursor loads 1 proxy = 2 tools = ~160 tokens. Savings: **99%**.

```
Cursor (sees only 2 tools: discover + execute)
    |
mcp-on-demand (BM25 search index, <0.01ms)
    |
Your MCP servers (spawned on demand, killed when idle)
```

### Discover mode (default)

1. LLM calls `discover("send email")` 
2. Proxy searches across all 200+ tools using BM25
3. Returns matching tools with full schemas + complete server list
4. LLM calls `execute("resend", "send-email", {to: "...", ...})`
5. Proxy spawns the server (if not running), calls the tool, returns result

### Passthrough mode

All tools exposed directly with `server__tool` prefix. Full visibility, higher token cost.

## CLI

```bash
mcp-on-demand                  # Start proxy (stdio, used by Cursor)
mcp-on-demand dashboard        # Open web dashboard
mcp-on-demand generate         # Rebuild tool cache
mcp-on-demand status           # Show detected servers
mcp-on-demand search "git"     # Test BM25 search
mcp-on-demand version          # Show version
```

## Configuration

Config lives in `~/.mcp-on-demand/config.json`:

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
    "idleTimeout": 300
  }
}
```

Cursor config (`~/.cursor/mcp.json`) just needs:

```json
{
  "mcpServers": {
    "on-demand": {
      "command": "/path/to/mcp-on-demand"
    }
  }
}
```

## Performance

| Metric | Value |
|---|---|
| Binary size | ~800KB |
| Startup | <5ms |
| BM25 search (300 tools) | <0.01ms |
| Context token savings | ~99% |
| RAM usage | ~5MB |
| Runtime dependencies | **None** |

## Environment Variables

| Variable | Values | Default |
|---|---|---|
| `MCP_ON_DEMAND_MODE` | `discover` / `passthrough` | `discover` |
| `MCP_ON_DEMAND_PRELOAD` | `all` / `none` | `all` |
| `MCP_ON_DEMAND_DEBUG` | `1` | - |

## Always-on Dashboard (macOS)

Run the web dashboard 24/7 as a background service, independent of Cursor:

```bash
# Create LaunchAgent
cat > ~/Library/LaunchAgents/com.soflution.mcp-on-demand-dashboard.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.soflution.mcp-on-demand-dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/mcp-on-demand</string>
        <string>dashboard</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

# Activate
launchctl load ~/Library/LaunchAgents/com.soflution.mcp-on-demand-dashboard.plist
```

Dashboard available at http://127.0.0.1:24680 — starts at login, auto-restarts on crash, uses 0% CPU / 3MB RAM.

## Uninstall

```bash
rm ~/.local/bin/mcp-on-demand
rm -rf ~/.mcp-on-demand
launchctl unload ~/Library/LaunchAgents/com.soflution.mcp-on-demand-dashboard.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.soflution.mcp-on-demand-dashboard.plist
# Restore Cursor config from backup:
cp ~/.mcp-on-demand/cursor-backup.json ~/.cursor/mcp.json
```

## License

MIT - [SOFLUTION LTD](https://soflution.com)
