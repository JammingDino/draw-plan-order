// Draw · Plan · Order — desktop shell.
// The whole app is the web build in dist/; this opens a window for it,
// using the WebView2 runtime Windows already ships (so pen input, pressure
// and coalesced pointer events behave exactly as they do in Edge).
//
// It also gives the app the Obsidian vault as its filesystem, laid out
// exactly as the Obsidian plugin lays it out (VaultStore in the plugin's
// main.js), so the same boards open in either and sync with the vault:
//
//   <vault>/<folder>/<name>.dpo         a board, plain JSON
//   <vault>/<folder>/.dpo/index.json    board list, id → path, prefs
//   <vault>/<folder>/.dpo/<id>.bin      a dropped PDF
//
// The vault comes from --vault on the command line (the plugin passes it
// when it hands a board over), or from the folder chosen in Settings, and
// is remembered in vault.json in the app's config dir. The folder is read
// from the plugin's own settings, so there is one place to change it.
// Any folder will do, vault or not: outside a vault the boards go straight
// into it, in the same layout.
//
// The commands are async so the disk work runs on a worker thread. A
// plain #[tauri::command] fn runs on the main thread, which is the one
// pumping the window's input, so every autosave used to freeze the canvas
// for as long as the board took to write.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const PLUGIN_ID: &str = "draw-plan-order";
const DEFAULT_FOLDER: &str = "Drawings";
/// where releases, issues and the feature-request form live
const REPO_URL: &str = "https://github.com/JammingDino/draw-plan-order";

struct Vault {
    root: Option<PathBuf>,
    folder: String,
}

struct Ctx {
    vault: Mutex<Vault>,
    /// what this launch was asked to open: board, pdf, file, name, page
    launch: Mutex<Map<String, Value>>,
}

/* ── paths ────────────────────────────────────────────────────────── */

/// Obsidian's normalizePath, near enough: forward slashes, no doubles,
/// no leading or trailing slash.
fn norm(p: &str) -> String {
    p.replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect::<Vec<_>>()
        .join("/")
}

/// The plugin's safeName, so a board renamed here lands on the file name
/// the plugin would have picked.
fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|#^[]".contains(c) { '-' } else { c })
        .collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = if s.is_empty() { "Untitled board".to_string() } else { s };
    s.chars().take(80).collect()
}

fn e<T: std::fmt::Display>(x: T) -> String { x.to_string() }

impl Vault {
    fn root(&self) -> Result<&Path, String> {
        self.root.as_deref().ok_or_else(|| "no vault configured".into())
    }
    /// vault-relative path → absolute; refuses to leave the vault
    fn abs(&self, rel: &str) -> Result<PathBuf, String> {
        let rel = norm(rel);
        if rel.split('/').any(|s| s == "..") {
            return Err(format!("path escapes the vault: {rel}"));
        }
        Ok(self.root()?.join(rel))
    }
    fn meta_dir(&self) -> String { norm(&format!("{}/.dpo", self.folder)) }
    fn index_path(&self) -> String { format!("{}/index.json", self.meta_dir()) }
    fn asset_path(&self, id: &str) -> String { format!("{}/{}.bin", self.meta_dir(), id) }

    /// The index, or an error — never an empty one standing in for a file
    /// that is there but could not be read. The plugin in Obsidian writes
    /// this same file, non-atomically, and antivirus opens it after every
    /// write; treating a half-written or locked index as "no boards" and
    /// saving over it once wiped the board list. So retry briefly, then
    /// refuse, and the write that wanted it fails instead.
    fn read_index(&self) -> Result<Map<String, Value>, String> {
        let path = self.abs(&self.index_path())?;
        let mut last = String::new();
        for attempt in 0..8 {
            if attempt > 0 { std::thread::sleep(std::time::Duration::from_millis(60)); }
            if !path.exists() {
                let mut idx = Map::new();
                idx.insert("boards".into(), json!([]));
                idx.insert("paths".into(), json!({}));
                return Ok(idx);
            }
            match fs::read_to_string(&path).map_err(e)
                .and_then(|s| serde_json::from_str::<Value>(&s).map_err(e))
            {
                Ok(Value::Object(mut idx)) => {
                    idx.entry("boards").or_insert_with(|| json!([]));
                    idx.entry("paths").or_insert_with(|| json!({}));
                    return Ok(idx);
                }
                Ok(_) => last = "index is not an object".into(),
                Err(err) => last = err,
            }
        }
        Err(format!("board index unreadable, not touching it: {last}"))
    }

    fn write_index(&self, idx: &Map<String, Value>) -> Result<(), String> {
        let body = to_json(&Value::Object(idx.clone()))?;
        write_atomic(&self.abs(&self.index_path())?, body.as_bytes())
    }

    /// Obsidian's trashLocal: into <vault>/.trash, never gone outright.
    fn trash(&self, rel: &str) -> Result<(), String> {
        let from = self.abs(rel)?;
        if !from.exists() { return Ok(()); }
        let bin = self.root()?.join(".trash");
        fs::create_dir_all(&bin).map_err(e)?;
        let name = from.file_name().unwrap().to_string_lossy().to_string();
        let mut to = bin.join(&name);
        let mut n = 1;
        while to.exists() { to = bin.join(format!("{n} {name}")); n += 1; }
        fs::rename(&from, &to).map_err(e)
    }
}

/// JSON.stringify(v, null, 1), which is what the plugin writes, so a
/// board saved here and there does not churn the sync with whitespace.
fn to_json(v: &Value) -> Result<String, String> {
    let mut out = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(b" ");
    let mut ser = serde_json::Serializer::with_formatter(&mut out, fmt);
    serde::Serialize::serialize(v, &mut ser).map_err(e)?;
    String::from_utf8(out).map_err(e)
}

/// Write beside, then rename over: a crash, or a sync client reading
/// mid-write, sees the old file or the new one, never half of each.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(e)?; }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, bytes).map_err(e)?;
    fs::rename(&tmp, path).map_err(e)
}

/* ── configuration ────────────────────────────────────────────────── */

/// the folder the Obsidian plugin is set to, so the two always agree
fn plugin_folder(root: &Path) -> String {
    fs::read_to_string(root.join(".obsidian/plugins").join(PLUGIN_ID).join("data.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("folder").and_then(|f| f.as_str()).map(norm))
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| DEFAULT_FOLDER.into())
}

fn is_vault(dir: &Path) -> bool { dir.join(".obsidian").is_dir() }

/// The folder boards go in when there is nothing more specific to go on:
/// the plugin's in a vault, the chosen folder itself anywhere else.
fn default_folder(root: &Path) -> String {
    if is_vault(root) { plugin_folder(root) } else { String::new() }
}

/// Where boards land when someone points the app at `dir`. Inside an
/// Obsidian vault the root stays the vault and `dir` becomes the folder,
/// so the index keeps vault-relative paths the plugin can follow; `None`
/// means "whatever folder the plugin is set to".
fn locate(dir: &Path) -> (PathBuf, Option<String>) {
    if is_vault(dir) { return (dir.into(), None); }
    for up in dir.ancestors().skip(1) {
        if is_vault(up) {
            let rel = dir.strip_prefix(up).map(|r| r.to_string_lossy().to_string()).unwrap_or_default();
            return (up.into(), Some(norm(&rel)));
        }
    }
    (dir.into(), Some(String::new()))
}

fn vault_cfg(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("vault.json"))
}

fn remember_vault(app: &AppHandle, root: &Path, folder: Option<&str>) -> Result<(), String> {
    let p = vault_cfg(app).ok_or("no config dir")?;
    let mut cfg = json!({ "vault": root });
    if let Some(f) = folder { cfg["folder"] = json!(f); }
    write_atomic(&p, to_json(&cfg)?.as_bytes())
}

fn load_vault(app: &AppHandle, args: &Map<String, Value>) -> Vault {
    let saved: Map<String, Value> = vault_cfg(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let handed = args.get("vault").and_then(|v| v.as_str()).map(PathBuf::from).filter(|p| is_vault(p));
    let root = handed.clone().or_else(|| {
        saved.get("vault").and_then(|v| v.as_str()).map(PathBuf::from).filter(|p| p.is_dir())
    });

    // remember a vault we were handed, so a plain launch finds it too
    if let Some(r) = &handed { let _ = remember_vault(app, r, None); }

    let folder = args.get("folder").and_then(|v| v.as_str()).map(norm)
        .or_else(|| if handed.is_some() { None } else { saved.get("folder").and_then(|f| f.as_str()).map(norm) })
        .or_else(|| root.as_deref().map(default_folder))
        .unwrap_or_else(|| DEFAULT_FOLDER.into());
    Vault { root, folder }
}

/// --key value pairs off the command line
fn parse_args() -> Map<String, Value> {
    let mut m = Map::new();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        if let Some(k) = a.strip_prefix("--") {
            if let Some(v) = it.next() { m.insert(k.into(), Value::String(v)); }
        }
    }
    m
}

fn pct_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            out.push(u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/* ── commands: the store.js KV contract ───────────────────────────── */

fn config(app: &AppHandle, ctx: &Ctx) -> Value {
    let v = ctx.vault.lock().unwrap();
    let dir = v.root.as_ref().map(|r| if v.folder.is_empty() { r.clone() } else { r.join(&v.folder) });
    json!({
        "vault": v.root, "folder": v.folder, "dir": dir,
        "obsidian": v.root.as_deref().is_some_and(is_vault),
        "launch": *ctx.launch.lock().unwrap(),
        "version": app.package_info().version.to_string(),
        "repo": REPO_URL
    })
}

#[tauri::command]
async fn dpo_config(app: AppHandle, ctx: State<'_, Ctx>) -> Result<Value, String> {
    Ok(config(&app, &ctx))
}

#[tauri::command]
async fn dpo_get(ctx: State<'_, Ctx>, key: String) -> Result<Value, String> {
    let v = ctx.vault.lock().unwrap();
    let idx = v.read_index()?;
    Ok(match key.as_str() {
        "index" => idx["boards"].clone(),
        "last" => idx.get("last").cloned().unwrap_or(Value::Null),
        "prefs" => idx.get("prefs").cloned().unwrap_or(Value::Null),
        k if k.starts_with("b:") => {
            match idx["paths"].get(&k[2..]).and_then(|p| p.as_str()) {
                Some(p) => fs::read_to_string(v.abs(p)?).ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(Value::Null),
                None => Value::Null,
            }
        }
        // metadata only; the bytes come separately, raw, from dpo_asset
        k if k.starts_with("a:") => {
            let id = &k[2..];
            if let Some(p) = id.strip_prefix("vault:") {
                let p = norm(p);
                if !v.abs(&p)?.is_file() { return Ok(Value::Null); }
                json!({ "name": p.rsplit('/').next(), "type": "application/pdf" })
            } else if v.abs(&v.asset_path(id))?.is_file() {
                idx.get("assets").and_then(|a| a.get(id)).cloned().unwrap_or(json!({}))
            } else {
                Value::Null
            }
        }
        _ => Value::Null,
    })
}

/// An asset's bytes as a raw ArrayBuffer: no JSON array of numbers and no
/// base64, which for a 15MB PDF is most of the point of leaving Obsidian.
#[tauri::command]
async fn dpo_asset(ctx: State<'_, Ctx>, id: String) -> Result<Response, String> {
    let path = {
        let v = ctx.vault.lock().unwrap();
        let rel = match id.strip_prefix("vault:") { Some(p) => norm(p), None => v.asset_path(&id) };
        v.abs(&rel)?
    };
    fs::read(path).map(Response::new).map_err(e)
}

#[tauri::command]
async fn dpo_set(ctx: State<'_, Ctx>, key: String, value: Value) -> Result<(), String> {
    let v = ctx.vault.lock().unwrap();
    let mut idx = v.read_index()?;
    match key.as_str() {
        "index" => { idx.insert("boards".into(), value); }
        "last" => { idx.insert("last".into(), value); }
        "prefs" => { idx.insert("prefs".into(), value); }
        k if k.starts_with("b:") => {
            let id = &k[2..];
            let name = safe_name(value.get("name").and_then(|n| n.as_str()).unwrap_or(""));
            let wanted = match value.get("file").and_then(|f| f.as_str()) {
                Some(f) => norm(f),
                None => norm(&format!("{}/{}.dpo", v.folder, name)),
            };
            let current = idx["paths"].get(id).and_then(|p| p.as_str()).map(String::from);
            let mut path = current.clone().unwrap_or_else(|| wanted.clone());

            match &current {
                // renaming the board renames the file, never onto another board
                Some(cur) if *cur != wanted && !v.abs(&wanted)?.exists() => {
                    if fs::rename(v.abs(cur)?, v.abs(&wanted)?).is_ok() { path = wanted; }
                }
                // a new board whose file name is taken gets a suffixed one
                None if v.abs(&wanted)?.exists() => {
                    let short: String = id.chars().take(4).collect();
                    path = norm(&format!("{}/{} {}.dpo", v.folder, name, short));
                }
                _ => {}
            }
            write_atomic(&v.abs(&path)?, to_json(&value)?.as_bytes())?;
            idx["paths"].as_object_mut().unwrap().insert(id.into(), Value::String(path));
        }
        _ => return Err(format!("cannot set {key}")),
    }
    v.write_index(&idx)
}

/// Store a dropped PDF. The bytes are the raw request body; the id and
/// metadata ride in headers so nothing has to be JSON-encoded.
#[tauri::command]
async fn dpo_put_asset(ctx: State<'_, Ctx>, request: Request<'_>) -> Result<(), String> {
    let hdr = |k: &str| request.headers().get(k).and_then(|h| h.to_str().ok()).map(String::from);
    let id = hdr("dpo-id").ok_or("missing dpo-id")?;
    if id.contains(['/', '\\']) || id.contains("..") || id.starts_with("vault:") {
        return Err("bad asset id".into());
    }
    let meta: Value = hdr("dpo-meta")
        .and_then(|m| pct_decode(&m))
        .and_then(|m| serde_json::from_str(&m).ok())
        .unwrap_or(json!({}));
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };

    let v = ctx.vault.lock().unwrap();
    write_atomic(&v.abs(&v.asset_path(&id))?, bytes)?;
    let mut idx = v.read_index()?;
    idx.entry("assets").or_insert_with(|| json!({}))
        .as_object_mut().unwrap().insert(id, meta);
    v.write_index(&idx)
}

#[tauri::command]
async fn dpo_del(ctx: State<'_, Ctx>, key: String) -> Result<(), String> {
    let v = ctx.vault.lock().unwrap();
    let mut idx = v.read_index()?;
    if let Some(id) = key.strip_prefix("b:") {
        if let Some(p) = idx["paths"].get(id).and_then(|p| p.as_str()) { v.trash(p)?; }
        idx["paths"].as_object_mut().unwrap().remove(id);
        if let Some(b) = idx["boards"].as_array_mut() {
            b.retain(|x| x.get("id").and_then(|i| i.as_str()) != Some(id));
        }
    } else if let Some(id) = key.strip_prefix("a:") {
        if id.starts_with("vault:") { return Ok(()); }   // never trash the user's own PDF
        v.trash(&v.asset_path(id))?;
        if let Some(a) = idx.get_mut("assets").and_then(|a| a.as_object_mut()) { a.remove(id); }
    } else {
        return Ok(());
    }
    v.write_index(&idx)
}

#[tauri::command]
async fn dpo_keys(ctx: State<'_, Ctx>) -> Result<Vec<String>, String> {
    let v = ctx.vault.lock().unwrap();
    let idx = v.read_index()?;
    let mut k: Vec<String> = vec!["index".into(), "last".into(), "prefs".into()];
    if let Some(p) = idx["paths"].as_object() { k.extend(p.keys().map(|id| format!("b:{id}"))); }
    if let Some(a) = idx.get("assets").and_then(|a| a.as_object()) {
        k.extend(a.keys().map(|id| format!("a:{id}")));
    }
    Ok(k)
}

/* ── commands: settings ───────────────────────────────────────────── */

/// Ask where boards should be kept from now on. Nothing is moved: boards
/// already saved stay where they were, and the page reloads onto the new
/// place. Whatever this launch was asked to open belonged to the old one.
#[tauri::command]
async fn dpo_choose_folder(app: AppHandle, ctx: State<'_, Ctx>) -> Result<Option<Value>, String> {
    let start = ctx.vault.lock().unwrap().root.clone();
    let mut pick = app.dialog().file().set_title("Where should boards be saved?");
    if let Some(r) = start { pick = pick.set_directory(r); }
    let Some(dir) = pick.blocking_pick_folder() else { return Ok(None) };
    let (root, folder) = locate(&dir.into_path().map_err(e)?);
    remember_vault(&app, &root, folder.as_deref())?;
    {
        let mut v = ctx.vault.lock().unwrap();
        v.folder = folder.unwrap_or_else(|| default_folder(&root));
        v.root = Some(root);
    }
    ctx.launch.lock().unwrap().clear();
    Ok(Some(config(&app, &ctx)))
}

#[tauri::command]
async fn dpo_reveal_folder(app: AppHandle, ctx: State<'_, Ctx>) -> Result<(), String> {
    let dir = { let v = ctx.vault.lock().unwrap(); v.abs(&v.folder)? };
    fs::create_dir_all(&dir).map_err(e)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(e)
}

/// Only ever this project's own pages, so the page cannot be talked into
/// opening anything else on the machine.
#[tauri::command]
async fn dpo_open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with(&format!("{REPO_URL}/")) { return Err("not a link this app opens".into()); }
    app.opener().open_url(url, None::<&str>).map_err(e)
}

/// The newest release on GitHub, if it is newer than this one. The
/// manifest is signed, and the updater refuses one that fails the check.
#[tauri::command]
async fn dpo_check_update(app: AppHandle) -> Result<Option<Value>, String> {
    let update = app.updater().map_err(e)?.check().await.map_err(e)?;
    Ok(update.map(|u| json!({ "version": u.version, "current": u.current_version, "notes": u.body })))
}

/// Download, install and restart. On Windows the installer takes over and
/// the app exits underneath it, so the page saves before asking for this.
#[tauri::command]
async fn dpo_install_update(app: AppHandle) -> Result<(), String> {
    let update = app.updater().map_err(e)?.check().await.map_err(e)?.ok_or("already up to date")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(e)?;
    app.restart();
}

fn main() {
    let args = parse_args();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let vault = load_vault(app.handle(), &args);
            let launch = ["board", "pdf", "file", "name", "page"].iter()
                .filter_map(|k| args.get(*k).map(|v| ((*k).to_string(), v.clone())))
                .collect();
            app.manage(Ctx { vault: Mutex::new(vault), launch: Mutex::new(launch) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dpo_config, dpo_get, dpo_asset, dpo_set, dpo_put_asset, dpo_del, dpo_keys,
            dpo_choose_folder, dpo_reveal_folder, dpo_open_url, dpo_check_update, dpo_install_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Draw · Plan · Order");
}
