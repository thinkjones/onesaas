use std::path::PathBuf;
use tauri::{Manager, RunEvent};

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

/// Env for the sidecar: fixed loopback port, data under the app data dir.
pub fn sidecar_env(data_dir: &PathBuf) -> Vec<(String, String)> {
    vec![
        ("PORT".into(), "8787".into()),
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
        .setup(|app| {
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
                cmd = cmd.args(sidecar_args(&resource_dir));
                for (k, v) in sidecar_env(&data_dir) {
                    cmd = cmd.env(&k, &v);
                }
                let (_rx, _child) = cmd.spawn().expect("spawn server");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build app")
        .run(|_app, event| {
            // The sidecar is a child of this process: exiting kills it.
            if let RunEvent::Exit = event {
                std::process::exit(0);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_points_at_bundled_server_and_app_data() {
        let res = PathBuf::from("/R");
        let data = PathBuf::from("/D");
        assert_eq!(
            sidecar_args(&res),
            vec!["/R/resources/app/dist/server.mjs".to_string()]
        );
        assert_eq!(
            sidecar_env(&data),
            vec![
                ("PORT".to_string(), "8787".to_string()),
                ("DB_FILE".to_string(), "/D/agent.db".to_string()),
                ("FILES_DIR".to_string(), "/D/files".to_string()),
            ]
        );
    }
}
