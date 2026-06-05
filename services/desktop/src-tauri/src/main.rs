// Convene desktop shell (Tauri 2). Wraps the web app with a native window and
// registers the `convene://` deep-link scheme for the browser -> desktop
// sign-in handoff (#90). The web URL is the bundled dist (frontendDist in
// tauri.conf.json) or ACP_DESKTOP_URL at build time (a deployed instance, #103).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            // Deep links arriving as convene://auth?token=<session> are handled by
            // the deep-link plugin; the front-end reads the token and calls /auth.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Convene desktop shell");
}
