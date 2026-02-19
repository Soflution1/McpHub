use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use crate::protocol::ToolDef;

#[derive(Serialize, Deserialize)]
pub struct SchemaCache {
    pub version: String,
    pub servers: HashMap<String, Vec<ToolDef>>,
    #[serde(default)]
    pub errors: HashMap<String, String>,
}

pub fn cache_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".McpHub").join("schema-cache.json"))
}

pub fn load_cache() -> Option<SchemaCache> {
    let path = cache_path()?;
    if !path.exists() { return None; }
    let content = fs::read_to_string(&path).ok()?;
    let cache: SchemaCache = serde_json::from_str(&content).ok()?;
    let total_tools: usize = cache.servers.values().map(|v| v.len()).sum();
    eprintln!("[McpHub][INFO] Loaded cache: {} servers, {} tools", cache.servers.len(), total_tools);
    Some(cache)
}

pub fn save_cache(servers: &HashMap<String, Vec<ToolDef>>) {
    save_cache_with_errors(servers, &HashMap::new());
}

pub fn save_cache_with_errors(servers: &HashMap<String, Vec<ToolDef>>, errors: &HashMap<String, String>) {
    let cache = SchemaCache {
        version: env!("CARGO_PKG_VERSION").to_string(),
        servers: servers.clone(),
        errors: errors.clone(),
    };
    if let Some(path) = cache_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&cache) {
            let _ = fs::write(&path, json);
            let total_tools: usize = servers.values().map(|v| v.len()).sum();
            eprintln!("[McpHub][INFO] Saved cache: {} servers, {} tools, {} errors", servers.len(), total_tools, errors.len());
        }
    }
}

/// Update cache for a single server (repair). Merges into existing cache.
pub fn repair_server_cache(name: &str, tools: Vec<ToolDef>) {
    let mut cache = load_cache().unwrap_or_else(|| SchemaCache {
        version: env!("CARGO_PKG_VERSION").to_string(),
        servers: HashMap::new(),
        errors: HashMap::new(),
    });
    cache.servers.insert(name.to_string(), tools);
    cache.errors.remove(name);
    if let Some(path) = cache_path() {
        if let Ok(json) = serde_json::to_string_pretty(&cache) {
            let _ = fs::write(&path, json);
        }
    }
}

/// Store an error for a server in cache
pub fn set_server_error(name: &str, error: &str) {
    let mut cache = load_cache().unwrap_or_else(|| SchemaCache {
        version: env!("CARGO_PKG_VERSION").to_string(),
        servers: HashMap::new(),
        errors: HashMap::new(),
    });
    cache.errors.insert(name.to_string(), error.to_string());
    cache.servers.remove(name);
    if let Some(path) = cache_path() {
        if let Ok(json) = serde_json::to_string_pretty(&cache) {
            let _ = fs::write(&path, json);
        }
    }
}
