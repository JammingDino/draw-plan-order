// Workings (formerly Draw · Plan · Order) — desktop shell.
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
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
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
    /// each board file as this window last read or wrote it (see Seen)
    seen: Mutex<HashMap<String, Seen>>,
}

/* ── changed elsewhere ────────────────────────────────────────────────
   A board kept in a synced folder can be changed on another machine (or
   by the Obsidian plugin) while it is open here. Saving over that copy
   would lose its work without a word. So the window remembers each board
   file as it last read or wrote it, and a save first checks the file is
   still that one; if it is not, the save is refused with CONFLICT and the
   page merges the two (js/merge.js) and saves again.

   Size and modified time first, so the usual save costs one stat; only
   when either moved is the file read and its content compared, because a
   sync client touches the time of files it has not changed. */
#[derive(Clone, Copy, PartialEq, Debug)]
struct Seen { len: u64, modified: Option<std::time::SystemTime>, hash: u64 }

const CONFLICT: &str = "dpo-conflict: the board was changed elsewhere";

fn hash_bytes(b: &[u8]) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    b.hash(&mut h);
    h.finish()
}

fn seen_of(path: &Path, bytes: &[u8]) -> Seen {
    let md = fs::metadata(path).ok();
    Seen { len: bytes.len() as u64, modified: md.and_then(|m| m.modified().ok()), hash: hash_bytes(bytes) }
}

/// Is the file at `path` still what `was` recorded? A file that is gone
/// counts as unchanged: writing it again loses nothing.
fn unchanged(path: &Path, was: &Seen) -> bool {
    let Ok(md) = fs::metadata(path) else { return true };
    if md.len() == was.len && md.modified().ok() == was.modified { return true; }
    match fs::read(path) { Ok(b) => hash_bytes(&b) == was.hash, Err(_) => true }
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
    /* A throwaway folder for the benchmark (test/bench-app.mjs --desktop):
       used as it is and never remembered, so a run cannot touch, or move,
       the place your real boards are kept. */
    if let Some(dir) = std::env::var_os("DPO_BOARDS_DIR") {
        return Vault { root: Some(PathBuf::from(dir)), folder: String::new() };
    }
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

/// A board's file exactly as it is on disk, for the page to parse. Going
/// through dpo_get parsed the whole file here and serialised it again for
/// the bridge, twice the work of the page parsing it once — and the wait
/// every time a board was opened or previewed. Empty when there is none.
#[tauri::command]
async fn dpo_get_board(ctx: State<'_, Ctx>, id: String) -> Result<Response, String> {
    let path = {
        let v = ctx.vault.lock().unwrap();
        let idx = v.read_index()?;
        match idx["paths"].get(&id).and_then(|p| p.as_str()) {
            Some(p) => v.abs(p)?,
            None => return Ok(Response::new(Vec::new())),
        }
    };
    let bytes = fs::read(&path).unwrap_or_default();
    if !bytes.is_empty() { ctx.seen.lock().unwrap().insert(id, seen_of(&path, &bytes)); }
    Ok(Response::new(bytes))
}

/// Has the open board's file been changed by something other than this
/// window since it last read or wrote it? Asked when the window comes
/// back to the front, so a board changed on another machine is brought
/// up to date before anything is drawn on the old one.
#[tauri::command]
async fn dpo_board_changed(ctx: State<'_, Ctx>, id: String) -> Result<bool, String> {
    let path = {
        let v = ctx.vault.lock().unwrap();
        let idx = v.read_index()?;
        match idx["paths"].get(&id).and_then(|p| p.as_str()) { Some(p) => v.abs(p)?, None => return Ok(false) }
    };
    let was = ctx.seen.lock().unwrap().get(&id).copied();
    Ok(match was { Some(w) => !unchanged(&path, &w), None => false })
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
            let body = to_json(&value)?;
            put_board(&v, &ctx.seen, &mut idx, &k[2..], value.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                value.get("file").and_then(|f| f.as_str()), body.as_bytes())?
        }
        _ => return Err(format!("cannot set {key}")),
    }
    v.write_index(&idx)
}

/// A board, sent as the raw bytes of its compact JSON, with the id, name
/// and (if it has one) file in headers. Nothing here parses the board: the
/// file is laid out exactly as to_json lays it out by reformatting the
/// text (pretty_json), which is a single pass over the bytes. Parsing it
/// into a Value and printing that back cost over a second of CPU on every
/// autosave of a large board.
#[tauri::command]
async fn dpo_put_board(ctx: State<'_, Ctx>, request: Request<'_>) -> Result<(), String> {
    let hdr = |k: &str| request.headers().get(k).and_then(|h| h.to_str().ok()).and_then(pct_decode);
    let id = hdr("dpo-id").ok_or("missing dpo-id")?;
    let name = hdr("dpo-name").unwrap_or_default();
    let file = hdr("dpo-file");
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let body = pretty_json(bytes);                    // before taking the lock
    let v = ctx.vault.lock().unwrap();
    let mut idx = v.read_index()?;
    put_board(&v, &ctx.seen, &mut idx, &id, &name, file.as_deref(), &body)?;
    v.write_index(&idx)
}

/// Compact JSON → the layout to_json writes (one-space indent, one value
/// per line, `[]` and `{}` kept inline), by walking the bytes. Strings are
/// copied through untouched, escapes and all; numbers are left exactly as
/// the page wrote them.
fn pretty_json(src: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len() * 2);
    let mut depth = 0usize;
    let mut i = 0;
    let newline = |out: &mut Vec<u8>, depth: usize| { out.push(b'\n'); out.extend(std::iter::repeat(b' ').take(depth)); };
    while i < src.len() {
        let c = src[i];
        match c {
            b'"' => {
                let start = i;
                i += 1;
                while i < src.len() && src[i] != b'"' { if src[i] == b'\\' { i += 1; } i += 1; }
                out.extend_from_slice(&src[start..(i + 1).min(src.len())]);
            }
            b'{' | b'[' => {
                let close = if c == b'{' { b'}' } else { b']' };
                if src.get(i + 1) == Some(&close) { out.push(c); out.push(close); i += 1; }
                else { out.push(c); depth += 1; newline(&mut out, depth); }
            }
            b'}' | b']' => { depth = depth.saturating_sub(1); newline(&mut out, depth); out.push(c); }
            b',' => { out.push(b','); newline(&mut out, depth); }
            b':' => { out.extend_from_slice(b": "); }
            b' ' | b'\n' | b'\r' | b'\t' => {}
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

fn put_board(v: &Vault, seen: &Mutex<HashMap<String, Seen>>, idx: &mut Map<String, Value>, id: &str, name: &str, file: Option<&str>, body: &[u8]) -> Result<(), String> {
    let name = safe_name(name);
    let wanted = match file {
        Some(f) => norm(f),
        None => norm(&format!("{}/{}.dpo", v.folder, name)),
    };
    let current = idx["paths"].get(id).and_then(|p| p.as_str()).map(String::from);
    let mut path = current.clone().unwrap_or_else(|| wanted.clone());

    // written elsewhere since this window last had it: the page merges first
    if let Some(cur) = &current {
        if let Some(was) = seen.lock().unwrap().get(id) {
            if !unchanged(&v.abs(cur)?, was) { return Err(CONFLICT.into()); }
        }
    }

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
    let at = v.abs(&path)?;
    write_atomic(&at, body)?;
    seen.lock().unwrap().insert(id.into(), seen_of(&at, body));
    idx["paths"].as_object_mut().unwrap().insert(id.into(), Value::String(path));
    Ok(())
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

/// The page has saved (see onCloseRequested in app.js): close for real.
/// destroy() rather than close(), which would only ask again.
#[tauri::command]
async fn dpo_close(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(e)
}

/* Closing the window waits for the page to save. The close is held, the
   page is asked to save and answers with dpo_close; a page that never
   answers (hung, or still loading) is closed anyway after a few seconds,
   so the close button always works. Its rescue copy in localStorage is
   still written on the way out as before. */
const CLOSE_GRACE: std::time::Duration = std::time::Duration::from_secs(6);

fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    api.prevent_close();
    let Some(view) = window.app_handle().get_webview_window(window.label()) else {
        let _ = window.destroy();
        return;
    };
    if view.eval("window.DPO && DPO.app ? DPO.app.onCloseRequested() : __TAURI_INTERNALS__.invoke('dpo_close')").is_err() {
        let _ = window.destroy();
        return;
    }
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_GRACE);
        let _ = w.destroy();
    });
}

/* ── the window ───────────────────────────────────────────────────── */

/* Which graphics chip draws the board, on a laptop with two. The discrete
   one is quicker and costs the battery a great deal just by being awake;
   the integrated one is plenty for a 2D canvas. So: the discrete chip when
   plugged in, the integrated one on battery. WebView2 takes this when the
   window is made, so it is decided at launch — a laptop unplugged later
   keeps the big chip until the app is next started. A machine with one
   chip ignores the flag. */
#[cfg(windows)]
fn on_mains() -> bool {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    // ACLineStatus: 0 battery, 1 plugged in, 255 unknown (count unknown as plugged in: no battery to save)
    unsafe { GetSystemPowerStatus(&mut s) != 0 && s.ACLineStatus != 0 }
}
#[cfg(not(windows))]
fn on_mains() -> bool { true }

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    let gpu = if on_mains() { "--force_high_performance_gpu" } else { "--force_low_power_gpu" };
    // replaces Tauri's own default arguments, so they are repeated here
    let browser_args = format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {gpu}");
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Workings")
        .inner_size(1440.0, 920.0)
        .min_inner_size(640.0, 460.0)
        .resizable(true)
        .center()
        .decorations(true)
        .disable_drag_drop_handler()
        .additional_browser_args(&browser_args)
        .build()?;
    Ok(())
}

fn main() {
    let args = parse_args();
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event { on_close_requested(window, api); }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let vault = load_vault(app.handle(), &args);
            let launch = ["board", "pdf", "file", "name", "page"].iter()
                .filter_map(|k| args.get(*k).map(|v| ((*k).to_string(), v.clone())))
                .collect();
            app.manage(Ctx { vault: Mutex::new(vault), launch: Mutex::new(launch), seen: Mutex::new(HashMap::new()) });
            open_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dpo_config, dpo_get, dpo_get_board, dpo_board_changed, dpo_asset, dpo_set, dpo_put_board, dpo_put_asset, dpo_del, dpo_keys,
            dpo_choose_folder, dpo_reveal_folder, dpo_open_url, dpo_check_update, dpo_install_update,
            dpo_close
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Workings");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reformatter lays a file out exactly as to_json does, and keeps
    /// what it says. (Key order is the page's own; to_json, through a
    /// Value, sorted them — so the layout is compared on the same order.)
    #[test]
    fn pretty_json_matches_to_json() {
        let compact = r#"{"id":"a1","name":"Q3 [draft], {x}","created":1760000000000,"camera":{"x":-12.5,"y":0,"zoom":1.25},"assets":[],"meta":{},"thumb":"data:image/webp;base64,AAA=","doc":{"v":1,"items":[{"id":"s","type":"stroke","pts":[0.35,1.2,0.5,-3,4.75,1],"color":"ink","label":"say \"hi\": a\b, [c]"},{"id":"n","type":"node","text":"line\nbreak","from":{"id":"s"},"tags":[[],{}]}]}}"#;
        let value: Value = serde_json::from_str(compact).unwrap();

        let got = pretty_json(compact.as_bytes());
        assert_eq!(serde_json::from_slice::<Value>(&got).unwrap(), value, "same content");

        let sorted = serde_json::to_string(&value).unwrap();
        assert_eq!(String::from_utf8(pretty_json(sorted.as_bytes())).unwrap(), to_json(&value).unwrap(), "same layout");
    }

    fn scratch_vault(tag: &str) -> Vault {
        let dir = std::env::temp_dir().join(format!("dpo-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Vault { root: Some(dir), folder: "Drawings".into() }
    }

    /// A board changed on disk by something else is not written over; one
    /// whose file was only touched, or is gone, is.
    #[test]
    fn a_board_changed_elsewhere_is_not_written_over() {
        let v = scratch_vault("conflict");
        let seen = Mutex::new(HashMap::new());
        let mut idx = v.read_index().unwrap();
        put_board(&v, &seen, &mut idx, "b1", "Beam", None, b"{\"v\":1}").unwrap();
        put_board(&v, &seen, &mut idx, "b1", "Beam", None, b"{\"v\":1,\"x\":1}").unwrap();   // our own write: fine

        let file = v.abs(idx["paths"]["b1"].as_str().unwrap()).unwrap();
        fs::write(&file, b"{\"v\":1,\"from\":\"laptop\"}").unwrap();                      // the other machine
        let err = put_board(&v, &seen, &mut idx, "b1", "Beam", None, b"{\"v\":1,\"x\":2}").unwrap_err();
        assert_eq!(err, CONFLICT);
        assert_eq!(fs::read(&file).unwrap(), b"{\"v\":1,\"from\":\"laptop\"}", "left as it was");

        // read again (as the page does to merge), and the next save goes through
        let bytes = fs::read(&file).unwrap();
        seen.lock().unwrap().insert("b1".into(), seen_of(&file, &bytes));
        put_board(&v, &seen, &mut idx, "b1", "Beam", None, b"{\"v\":1,\"merged\":true}").unwrap();

        // the same bytes rewritten (a sync client touching it) is no change
        let was = *seen.lock().unwrap().get("b1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&file, fs::read(&file).unwrap()).unwrap();
        assert!(unchanged(&file, &was));

        // and a file that has gone is written again
        fs::remove_file(&file).unwrap();
        put_board(&v, &seen, &mut idx, "b1", "Beam", None, b"{\"v\":1}").unwrap();
        let _ = fs::remove_dir_all(v.root.as_ref().unwrap());
    }

    /// A board never read in this window is written as before.
    #[test]
    fn a_board_not_yet_seen_is_written() {
        let v = scratch_vault("unseen");
        let seen = Mutex::new(HashMap::new());
        let mut idx = v.read_index().unwrap();
        put_board(&v, &seen, &mut idx, "b2", "Notes", None, b"{}").unwrap();
        seen.lock().unwrap().clear();
        let file = v.abs(idx["paths"]["b2"].as_str().unwrap()).unwrap();
        fs::write(&file, b"{\"other\":1}").unwrap();
        put_board(&v, &seen, &mut idx, "b2", "Notes", None, b"{}").unwrap();
        let _ = fs::remove_dir_all(v.root.as_ref().unwrap());
    }
}
