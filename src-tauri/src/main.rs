// Draw · Plan · Order — desktop shell.
// The whole app is the web build in dist/; this only opens a window for it,
// using the WebView2 runtime Windows already ships (so pen input, pressure
// and coalesced pointer events behave exactly as they do in Edge).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start Draw · Plan · Order");
}
