use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;

/// The spawned server sidecar. Held so it can be killed on exit — a dropped
/// CommandChild leaves the process running by default (orphaned server).
struct ServerChild(Mutex<Option<CommandChild>>);

/// Args for the bundled node running the bundled server script.
pub fn sidecar_args(resource_dir: &PathBuf) -> Vec<String> {
    vec![resource_dir
        .join("resources")
        .join("app")
        .join("dist")
        .join("server.mjs")
        .to_string_lossy()
        .into_owned()]
}

/// Sidecar port: 8787 unless PORT is set (lets a test instance run
/// alongside a dev server; the extension pairing expects 8787).
pub fn sidecar_port() -> String {
    std::env::var("PORT").unwrap_or_else(|_| "8787".into())
}

/// Env for the sidecar: loopback port, data under the app data dir.
pub fn sidecar_env(data_dir: &PathBuf, port: &str) -> Vec<(String, String)> {
    vec![
        ("PORT".into(), port.to_string()),
        (
            "DB_FILE".into(),
            data_dir.join("agent.db").to_string_lossy().into_owned(),
        ),
        (
            "FILES_DIR".into(),
            data_dir.join("files").to_string_lossy().into_owned(),
        ),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            // Referenced only by the release-only spawn below; keeps debug clean.
            #[cfg(debug_assertions)]
            let _ = &app;
            // Dev runs the server via beforeDevCommand (tsx watch); only the
            // packaged app spawns the sidecar.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::ShellExt;
                let data_dir = app.path().app_data_dir().expect("app data dir");
                std::fs::create_dir_all(&data_dir).expect("create data dir");
                let resource_dir = app.path().resource_dir().expect("resource dir");
                // sidecar("server") resolves src-tauri/bin/server-<triple>,
                // which the build script installs as the node binary.
                let mut cmd = app.shell().sidecar("server").expect("sidecar");
                cmd = cmd.kill_on_drop(true).args(sidecar_args(&resource_dir));
                for (k, v) in sidecar_env(&data_dir, &sidecar_port()) {
                    cmd = cmd.env(&k, &v);
                }
                let (_rx, child) = cmd.spawn().expect("spawn server");
                *app.state::<ServerChild>().0.lock().unwrap() = Some(child);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Explicit kill: the plugin only auto-kills JS-spawned
                // children, and exit(0) below would skip Drop cleanup.
                if let Some(child) = app.state::<ServerChild>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
                std::process::exit(0);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_port_defaults_to_8787_and_honors_env() {
        std::env::remove_var("PORT");
        assert_eq!(sidecar_port(), "8787".to_string());
        std::env::set_var("PORT", "8899");
        assert_eq!(sidecar_port(), "8899".to_string());
        std::env::remove_var("PORT");
    }

    #[test]
    fn sidecar_points_at_bundled_server_and_app_data() {
        let res = PathBuf::from("/R");
        let data = PathBuf::from("/D");
        assert_eq!(
            sidecar_args(&res),
            vec!["/R/resources/app/dist/server.mjs".to_string()]
        );
        assert_eq!(
            sidecar_env(&data, "8787"),
            vec![
                ("PORT".to_string(), "8787".to_string()),
                ("DB_FILE".to_string(), "/D/agent.db".to_string()),
                ("FILES_DIR".to_string(), "/D/files".to_string()),
            ]
        );
    }
}
