// 体感游戏工坊 desktop shell: one window showing the bundled web app (Game Hub → games).
//
// Camera permission: the web app only opens the camera after the player clicks 打开摄像头 on the
// positioning step, so that click is the consent. The WebView2 permission prompt (a browser-style
// dialog naming "tauri.localhost") is therefore answered here: the camera is allowed for the app's
// own pages only; the microphone and every other permission are refused. The Windows camera privacy
// setting still applies on top (the app shows its own guidance when Windows blocks the camera).
use tauri::webview::{PermissionKind, PermissionResponse};

/// The bundled app (release: http://tauri.localhost) or the lab dev server (debug builds only).
fn is_app_origin(url: &tauri::Url) -> bool {
    match url.host_str() {
        Some("tauri.localhost") => true,
        Some("127.0.0.1") => cfg!(debug_assertions) && url.port() == Some(5180),
        _ => false,
    }
}

pub fn run() {
    tauri::Builder::default()
        .on_permission_request(|webview, kind| match kind {
            PermissionKind::Camera if webview.url().map(|u| is_app_origin(&u)).unwrap_or(false) => PermissionResponse::Allow,
            _ => PermissionResponse::Deny,
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
