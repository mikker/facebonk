use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone)]
struct AppState {
    storage_dir: PathBuf,
    storage_override: Option<PathBuf>,
    updates_enabled: bool,
    backend_socket_path: PathBuf,
    backend: Arc<BackendController>,
}

struct BackendController {
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    storage_dir: String,
    storage_override: Option<String>,
    updates_enabled: bool,
    bridge: &'static str,
    backend_transport: &'static str,
}

impl BackendController {
    fn spawn(
        app: &AppHandle,
        storage_dir: &PathBuf,
        updates_enabled: bool,
        backend_socket_path: &PathBuf,
    ) -> Result<Arc<Self>, String> {
        let mut command = backend_command(app)?
            .args([
                backend_script_path(app)?
                    .to_str()
                    .ok_or_else(|| "backend script path was not valid UTF-8".to_string())?,
                "--storage",
                &storage_dir.to_string_lossy(),
                "--socket",
                &backend_socket_path.to_string_lossy(),
            ])
            .set_raw_out(true);

        if let Some(app_path) = packaged_app_path()? {
            command = command.args([
                "--app-path",
                app_path
                    .to_str()
                    .ok_or_else(|| "packaged app path was not valid UTF-8".to_string())?,
            ]);
        }

        command = if updates_enabled {
            command.arg("--updates")
        } else {
            command.arg("--no-updates")
        };

        let (mut receiver, child) = command
            .spawn()
            .map_err(|error| format!("failed to spawn Pear bridge: {error}"))?;

        let controller = Arc::new(Self {
            child: Mutex::new(Some(child)),
        });

        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        print!("{chunk}");
                    }
                    CommandEvent::Stderr(bytes) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        eprint!("{chunk}");
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("Pear bridge error: {error}");
                    }
                    CommandEvent::Terminated(payload) => {
                        let message = payload
                            .code
                            .map(|code| format!("Pear bridge exited with code {code}"))
                            .unwrap_or_else(|| "Pear bridge exited".to_string());
                        eprintln!("{message}");
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(controller)
    }
}

impl Drop for BackendController {
    fn drop(&mut self) {
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

fn parse_storage_override() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        if arg == "--storage" {
            return args.next().map(PathBuf::from);
        }

        if let Some(value) = arg.strip_prefix("--storage=") {
            return Some(PathBuf::from(value));
        }
    }

    std::env::var_os("FACEBONK_STORAGE").map(PathBuf::from)
}

fn parse_updates_enabled() -> bool {
    let args = std::env::args().skip(1).collect::<Vec<_>>();

    if args.iter().any(|arg| arg == "--updates") {
        return true;
    }

    if args.iter().any(|arg| arg == "--no-updates") {
        return false;
    }

    !cfg!(dev)
}

fn resolve_storage_dir(
    app: &AppHandle,
    storage_override: &Option<PathBuf>,
) -> Result<PathBuf, String> {
    match storage_override {
        Some(path) => Ok(path.clone()),
        None => Ok(app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?),
    }
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    let _keep_backend_alive = &state.backend;

    AppInfo {
        storage_dir: state.storage_dir.display().to_string(),
        storage_override: state
            .storage_override
            .as_ref()
            .map(|path| path.display().to_string()),
        updates_enabled: state.updates_enabled,
        bridge: "Tauri invoke -> Rust host -> Bare runtime host",
        backend_transport: "Rust host forwards JSON RPC to the Facebonk Bare host over a local Unix socket",
    }
}

#[tauri::command]
fn backend_request(
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let payload = serde_json::json!({
        "method": method,
        "params": params.unwrap_or_else(|| serde_json::json!({})),
    });

    let payload = request_backend_socket(&state.backend_socket_path, &payload)?;

    if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(payload
            .get("result")
            .cloned()
            .unwrap_or_else(|| serde_json::json!(null)))
    } else {
        let error = payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("backend returned an unknown error");
        Err(error.to_string())
    }
}

fn backend_command(app: &AppHandle) -> Result<Command, String> {
    if cfg!(dev) {
        Ok(app.shell().command(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!(
                    "bare-{}{}",
                    current_tauri_target(),
                    current_bare_binary_suffix()
                )),
        ))
    } else {
        app.shell()
            .sidecar("bare")
            .map_err(|error| format!("failed to configure bundled bare sidecar: {error}"))
    }
}

fn backend_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(dev) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("bare")
            .join("pear-host.cjs"));
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve resource dir: {error}"))?;

    let candidates = [
        resource_dir.join("bare").join("pear-host.cjs"),
        resource_dir
            .join("resources")
            .join("bare")
            .join("pear-host.cjs"),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "failed to locate bundled Pear bridge script".to_string())
}

fn packaged_app_path() -> Result<Option<PathBuf>, String> {
    if cfg!(dev) {
        return Ok(None);
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(app_image) = std::env::var_os("APPIMAGE") {
            return Ok(Some(PathBuf::from(app_image)));
        }
    }

    let exe = std::env::current_exe()
        .map_err(|error| format!("failed to resolve current executable: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        let app_bundle = exe
            .parent()
            .and_then(|dir| dir.parent())
            .and_then(|dir| dir.parent())
            .map(PathBuf::from)
            .ok_or_else(|| "failed to resolve .app bundle path".to_string())?;
        return Ok(Some(app_bundle));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(Some(exe))
    }
}

fn current_tauri_target() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "aarch64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    #[allow(unreachable_code)]
    "unsupported-target"
}

fn current_bare_binary_suffix() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        return ".exe";
    }
    #[allow(unreachable_code)]
    ""
}

#[cfg(unix)]
fn backend_socket_path() -> PathBuf {
    std::env::temp_dir().join(format!("facebonk-{}.sock", std::process::id()))
}

#[cfg(not(unix))]
fn backend_socket_path() -> PathBuf {
    PathBuf::from("facebonk.sock")
}

#[cfg(unix)]
fn request_backend_socket(socket_path: &PathBuf, payload: &Value) -> Result<Value, String> {
    let mut stream = UnixStream::connect(socket_path)
        .map_err(|error| format!("failed to connect to backend socket: {error}"))?;

    let request_body = serde_json::to_vec(payload)
        .map_err(|error| format!("failed to encode backend request: {error}"))?;

    stream
        .write_all(&request_body)
        .map_err(|error| format!("failed to write backend request: {error}"))?;

    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|error| format!("failed to finish backend request: {error}"))?;

    let mut response_body = Vec::new();
    stream
        .read_to_end(&mut response_body)
        .map_err(|error| format!("failed to read backend response: {error}"))?;

    serde_json::from_slice(&response_body)
        .map_err(|error| format!("backend response was not valid JSON: {error}"))
}

#[cfg(not(unix))]
fn request_backend_socket(_socket_path: &PathBuf, _payload: &Value) -> Result<Value, String> {
    Err("unix socket backend transport is only implemented on Unix platforms".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let storage_override = parse_storage_override();
            let updates_enabled = parse_updates_enabled();
            let storage_dir = resolve_storage_dir(app.handle(), &storage_override)?;
            let backend_socket_path = backend_socket_path();

            std::fs::create_dir_all(&storage_dir)
                .map_err(|error| format!("failed to create storage dir: {error}"))?;

            #[cfg(unix)]
            if backend_socket_path.exists() {
                let _ = std::fs::remove_file(&backend_socket_path);
            }

            let backend = BackendController::spawn(
                app.handle(),
                &storage_dir,
                updates_enabled,
                &backend_socket_path,
            )?;

            app.manage(AppState {
                storage_dir,
                storage_override,
                updates_enabled,
                backend_socket_path,
                backend,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, backend_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
