import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';

const PORT = 24680;
const CONFIG_DIR = resolve(homedir(), '.mcp-on-demand');
const CONFIG_PATH = resolve(CONFIG_DIR, 'config.json');

// ─── Config helpers ──────────────────────────────────────────────────

interface ServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  preload?: boolean;
}

interface AppConfig {
  settings: Record<string, any>;
  servers: Record<string, ServerEntry>;
}

function readConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    const defaults: AppConfig = {
      settings: {
        idleTimeout: 300,
        cacheDir: resolve(CONFIG_DIR, 'cache'),
        logLevel: 'info',
        startupTimeout: 30000,
        prefixTools: false,
        mode: 'passthrough',
        preload: 'all',
      },
      servers: {},
    };
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config: AppConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── API handlers ────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function cors(res: ServerResponse) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

async function handleAPI(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (method === 'OPTIONS') { cors(res); return; }

  // GET /api/servers
  if (url === '/api/servers' && method === 'GET') {
    const config = readConfig();
    json(res, { servers: config.servers, settings: config.settings });
    return;
  }

  // POST /api/servers — add a server
  if (url === '/api/servers' && method === 'POST') {
    const body = await parseBody(req);
    const { name, command, args, env, preload } = body;
    if (!name || !command) {
      json(res, { error: 'name and command are required' }, 400);
      return;
    }
    const config = readConfig();
    if (config.servers[name]) {
      json(res, { error: `Server "${name}" already exists. Use PUT to update.` }, 409);
      return;
    }
    const entry: ServerEntry = { command };
    if (args && args.length > 0) entry.args = args;
    if (env && Object.keys(env).length > 0) entry.env = env;
    if (preload) entry.preload = true;
    config.servers[name] = entry;
    saveConfig(config);
    json(res, { ok: true, server: name, total: Object.keys(config.servers).length }, 201);
    return;
  }

  // PUT /api/servers/:name — update a server
  const putMatch = url.match(/^\/api\/servers\/([^/]+)$/);
  if (putMatch && method === 'PUT') {
    const name = decodeURIComponent(putMatch[1]);
    const config = readConfig();
    if (!config.servers[name]) {
      json(res, { error: `Server "${name}" not found` }, 404);
      return;
    }
    const body = await parseBody(req);
    if (body.command) config.servers[name].command = body.command;
    if (body.args !== undefined) config.servers[name].args = body.args;
    if (body.env !== undefined) config.servers[name].env = body.env;
    if (body.preload !== undefined) config.servers[name].preload = body.preload;
    saveConfig(config);
    json(res, { ok: true, server: name });
    return;
  }

  // DELETE /api/servers/:name — remove a server
  const delMatch = url.match(/^\/api\/servers\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    const name = decodeURIComponent(delMatch[1]);
    const config = readConfig();
    if (!config.servers[name]) {
      json(res, { error: `Server "${name}" not found` }, 404);
      return;
    }
    delete config.servers[name];
    saveConfig(config);
    json(res, { ok: true, deleted: name, remaining: Object.keys(config.servers).length });
    return;
  }

  // PUT /api/servers/:name/env/:key — update a single env var
  const envMatch = url.match(/^\/api\/servers\/([^/]+)\/env\/([^/]+)$/);
  if (envMatch && method === 'PUT') {
    const name = decodeURIComponent(envMatch[1]);
    const key = decodeURIComponent(envMatch[2]);
    const config = readConfig();
    if (!config.servers[name]) {
      json(res, { error: `Server "${name}" not found` }, 404);
      return;
    }
    const body = await parseBody(req);
    if (!config.servers[name].env) config.servers[name].env = {};
    config.servers[name].env![key] = body.value;
    saveConfig(config);
    json(res, { ok: true, server: name, env: key });
    return;
  }

  // PUT /api/settings — update proxy settings
  if (url === '/api/settings' && method === 'PUT') {
    const body = await parseBody(req);
    const config = readConfig();
    config.settings = { ...config.settings, ...body };
    saveConfig(config);
    json(res, { ok: true, settings: config.settings });
    return;
  }

  // POST /api/import — import from Cursor mcp.json
  if (url === '/api/import' && method === 'POST') {
    const body = await parseBody(req);
    const cursorConfig = body.mcpServers || body;
    const config = readConfig();
    let imported = 0;
    for (const [name, cfg] of Object.entries(cursorConfig) as [string, any][]) {
      if (name.toLowerCase().includes('mcpondemand') || name === 'mcp-on-demand') continue;
      if (cfg.url && !cfg.command) continue;
      if (!cfg.command) continue;
      if (config.servers[name]) continue; // skip existing
      config.servers[name] = {
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
      };
      imported++;
    }
    saveConfig(config);
    json(res, { ok: true, imported, total: Object.keys(config.servers).length });
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

// ─── Frontend ────────────────────────────────────────────────────────

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mcp-on-demand Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    body { background: #0f1117; color: #e2e8f0; }
    .card { background: #1a1d2e; border: 1px solid #2d3148; border-radius: 12px; }
    .card:hover { border-color: #4f46e5; }
    .btn-primary { background: #4f46e5; }
    .btn-primary:hover { background: #4338ca; }
    .btn-danger { background: #dc2626; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-secondary { background: #374151; }
    .btn-secondary:hover { background: #4b5563; }
    input, textarea, select {
      background: #0f1117; border: 1px solid #2d3148; color: #e2e8f0;
      border-radius: 8px; padding: 8px 12px; width: 100%;
    }
    input:focus, textarea:focus, select:focus {
      outline: none; border-color: #4f46e5;
    }
    .env-row { display: grid; grid-template-columns: 1fr 2fr 36px; gap: 8px; align-items: center; }
    .toast {
      position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
      border-radius: 8px; font-size: 14px; z-index: 999;
      animation: slideIn 0.3s ease-out;
    }
    .toast-success { background: #065f46; color: #d1fae5; }
    .toast-error { background: #991b1b; color: #fee2e2; }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 50;
    }
    .modal { background: #1a1d2e; border: 1px solid #2d3148; border-radius: 16px; padding: 28px; width: 560px; max-height: 80vh; overflow-y: auto; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-env { background: #1e3a5f; color: #93c5fd; }
    .badge-count { background: #312e81; color: #a5b4fc; }
    .search-input { background: #0f1117; border: 1px solid #2d3148; border-radius: 10px; padding: 10px 16px 10px 40px; }
    .header-gradient { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); }
    .server-name { font-weight: 600; font-size: 16px; color: #f1f5f9; }
    .server-cmd { font-size: 12px; color: #64748b; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .collapse-btn { cursor: pointer; user-select: none; }
    .expanded .env-section { display: block; }
    .env-section { display: none; }
    .tag { display: inline-flex; align-items: center; gap: 4px; background: #1e293b; border-radius: 6px; padding: 3px 8px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div id="app" class="max-w-4xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="header-gradient rounded-2xl p-6 mb-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-white">mcp-on-demand</h1>
          <p class="text-indigo-200 mt-1">MCP Server Manager for Cursor IDE</p>
        </div>
        <div class="flex gap-3">
          <button onclick="showImportModal()" class="btn-secondary text-white text-sm font-medium px-4 py-2 rounded-lg">Import</button>
          <button onclick="showAddModal()" class="btn-primary text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add Server</button>
        </div>
      </div>
      <div id="stats" class="flex gap-6 mt-4 text-sm text-indigo-200"></div>
    </div>

    <!-- Search -->
    <div class="relative mb-6">
      <svg class="absolute left-3 top-3 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <input type="text" id="search" class="search-input w-full" placeholder="Search servers..." oninput="filterServers()">
    </div>

    <!-- Server list -->
    <div id="servers"></div>
  </div>

  <!-- Add/Edit Modal -->
  <div id="modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2 id="modal-title" class="text-xl font-bold mb-5">Add MCP Server</h2>
      <input type="hidden" id="edit-original-name">

      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-400 mb-1">Server Name</label>
        <input type="text" id="f-name" placeholder="e.g. github, stripe, supabase">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-400 mb-1">Configuration <span class="text-gray-600">(Cursor mcp.json format)</span></label>
        <textarea id="f-json" rows="14" style="font-family: monospace; font-size: 13px; line-height: 1.5; tab-size: 2;" placeholder='{"command": "npx", "args": ["-y", "@package/name"]}'></textarea>
      </div>

      <div class="flex justify-end gap-3">
        <button onclick="closeModal()" class="btn-secondary text-white text-sm font-medium px-5 py-2 rounded-lg">Cancel</button>
        <button onclick="saveServer()" class="btn-primary text-white text-sm font-medium px-5 py-2 rounded-lg">Save</button>
      </div>
    </div>
  </div>

  <!-- Import Modal -->
  <div id="import-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeImportModal()">
    <div class="modal">
      <h2 class="text-xl font-bold mb-3">Import from Cursor</h2>
      <p class="text-sm text-gray-400 mb-4">Paste your Cursor <code>mcp.json</code> content below. Existing servers won't be overwritten.</p>
      <textarea id="import-json" rows="10" placeholder='{ "mcpServers": { ... } }'></textarea>
      <div class="flex justify-end gap-3 mt-4">
        <button onclick="closeImportModal()" class="btn-secondary text-white text-sm font-medium px-5 py-2 rounded-lg">Cancel</button>
        <button onclick="doImport()" class="btn-primary text-white text-sm font-medium px-5 py-2 rounded-lg">Import</button>
      </div>
    </div>
  </div>

<script>
const API = '';
let allServers = {};

async function loadServers() {
  const res = await fetch(API + '/api/servers');
  const data = await res.json();
  allServers = data.servers;
  renderStats(data);
  renderServers(data.servers);
}

function renderStats(data) {
  const count = Object.keys(data.servers).length;
  const envCount = Object.values(data.servers).reduce((n, s) => n + Object.keys(s.env || {}).length, 0);
  const preloadCount = Object.values(data.servers).filter(s => s.preload).length;
  document.getElementById('stats').innerHTML =
    '<span>' + count + ' servers</span>' +
    '<span>' + envCount + ' env vars</span>' +
    '<span>' + preloadCount + ' preloaded</span>' +
    '<span>Mode: ' + (data.settings?.mode || 'passthrough') + '</span>';
}

function renderServers(servers) {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const el = document.getElementById('servers');
  const entries = Object.entries(servers).filter(([name]) => !q || name.toLowerCase().includes(q));

  if (entries.length === 0) {
    el.innerHTML = '<div class="text-center text-gray-500 py-12">No servers found</div>';
    return;
  }

  el.innerHTML = entries.map(([name, srv]) => {
    const envKeys = Object.keys(srv.env || {}).filter(k => k !== 'PATH');
    const argsStr = (srv.args || []).join(' ');
    const envBadges = envKeys.map(k => {
      const val = srv.env[k];
      const masked = val.length > 12 ? val.slice(0, 4) + '...' + val.slice(-4) : val;
      return '<span class="tag" title="' + escHtml(k) + '=' + escHtml(val) + '">' + escHtml(k) + ': <span class="text-indigo-300">' + escHtml(masked) + '</span></span>';
    }).join(' ');

    return '<div class="card p-4 mb-3">' +
      '<div class="flex items-start justify-between">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2">' +
            '<span class="server-name">' + escHtml(name) + '</span>' +
            (srv.preload ? '<span class="badge badge-count">preload</span>' : '') +
          '</div>' +
          '<div class="server-cmd mt-1" title="' + escHtml(srv.command + ' ' + argsStr) + '">' + escHtml(srv.command) + ' ' + escHtml(argsStr) + '</div>' +
          (envKeys.length > 0 ? '<div class="flex flex-wrap gap-1 mt-2">' + envBadges + '</div>' : '') +
        '</div>' +
        '<div class="flex gap-2 ml-4 flex-shrink-0">' +
          '<button onclick="editServer(&#39;' + escAttr(name) + '&#39;)" class="btn-secondary text-white text-xs px-3 py-1.5 rounded-lg">Edit</button>' +
          '<button onclick="deleteServer(&#39;' + escAttr(name) + '&#39;)" class="btn-danger text-white text-xs px-3 py-1.5 rounded-lg">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filterServers() { renderServers(allServers); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/&/g,"&amp;").replace(/'/g,"&#39;").replace(/"/g,"&quot;"); }

// --- Add / Edit ------------------------------------------------------
function showAddModal() {
  document.getElementById('modal-title').textContent = 'Add MCP Server';
  document.getElementById('edit-original-name').value = '';
  document.getElementById('f-name').value = '';
  document.getElementById('f-name').disabled = false;
  const wrapper = { 'my-server': { command: 'npx', args: ['-y', '@package/server-name'], env: {} } };
  document.getElementById('f-json').value = JSON.stringify(wrapper, null, 2);
  document.getElementById('modal').style.display = 'flex';
}

function editServer(name) {
  const srv = allServers[name];
  if (!srv) return;
  document.getElementById('modal-title').textContent = 'Edit: ' + name;
  document.getElementById('edit-original-name').value = name;
  document.getElementById('f-name').value = name;
  document.getElementById('f-name').disabled = true;
  const wrapper = {}; wrapper[name] = srv;
  document.getElementById('f-json').value = JSON.stringify(wrapper, null, 2);
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

async function saveServer() {
  const originalName = document.getElementById('edit-original-name').value;
  const jsonText = document.getElementById('f-json').value.trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    toast('Invalid JSON: ' + e.message, 'error');
    return;
  }

  const keys = Object.keys(parsed);
  if (keys.length !== 1) { toast('JSON must have exactly one server key', 'error'); return; }
  const name = keys[0];
  const config = parsed[name];
  if (!config.command) { toast('Config must include a command field', 'error'); return; }

  try {
    if (originalName) {
      await fetch(API + '/api/servers/' + encodeURIComponent(originalName), { method: 'DELETE' });
    }
    const res = await fetch(API + '/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...config }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error, 'error'); return; }
    toast('Server ' + name + (originalName ? ' updated' : ' added'));
    closeModal();
    loadServers();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function deleteServer(name) {
  if (!confirm('Delete server "' + name + '"?')) return;
  await fetch(API + '/api/servers/' + encodeURIComponent(name), { method: 'DELETE' });
  toast('Server "' + name + '" deleted');
  loadServers();
}

// ─── Import ──────────────────────────────────────────────────────
function showImportModal() { document.getElementById('import-modal').style.display = 'flex'; }
function closeImportModal() { document.getElementById('import-modal').style.display = 'none'; }

async function doImport() {
  const raw = document.getElementById('import-json').value.trim();
  if (!raw) { toast('Paste your mcp.json content', 'error'); return; }
  try {
    const parsed = JSON.parse(raw);
    const res = await fetch(API + '/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    const data = await res.json();
    toast(data.imported + ' servers imported (' + data.total + ' total)');
    closeImportModal();
    loadServers();
  } catch (e) {
    toast('Invalid JSON: ' + e.message, 'error');
  }
}

// ─── Toast ───────────────────────────────────────────────────────
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-success');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Init ────────────────────────────────────────────────────────
loadServers();
</script>
</body>
</html>`;
}

// ─── HTTP Server ─────────────────────────────────────────────────────

export function startDashboard(options: { open?: boolean } = {}): void {
  const { open = true } = options;

  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith('/api/')) {
        await handleAPI(req, res);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      json(res, { error: msg }, 500);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('  mcp-on-demand dashboard');
    console.log(`  Running at ${url}`);
    console.log('  Press Ctrl+C to stop');
    console.log('');

    if (open) {
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    }
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}
