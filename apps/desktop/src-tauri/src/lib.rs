use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
#[cfg(target_os = "macos")]
use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::window::{Color, Effect, EffectState, EffectsBuilder};
use tauri::{Emitter, Manager, State, Theme, WebviewWindow, Window, WindowEvent};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::{NotificationExt, PermissionState};
use tokio::sync::{oneshot, Notify};
use uuid::Uuid;

type PendingResult = Result<Value, String>;

struct Backend {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PendingResult>>>>,
    ready: Arc<AtomicBool>,
    ready_notify: Arc<Notify>,
    fatal: Arc<Mutex<Option<String>>>,
}

struct ThemeModeState(Mutex<String>);
struct TransparencyState(AtomicBool);

impl Backend {
    async fn wait_ready(&self) -> Result<(), String> {
        if self.ready.load(Ordering::Acquire) {
            return Ok(());
        }
        if let Some(error) = self.fatal.lock().expect("fatal mutex poisoned").clone() {
            return Err(error);
        }
        tokio::time::timeout(Duration::from_secs(30), self.ready_notify.notified())
            .await
            .map_err(|_| "Alamelu Pi backend readiness timed out".to_string())?;
        if self.ready.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(self
                .fatal
                .lock()
                .expect("fatal mutex poisoned")
                .clone()
                .unwrap_or_else(|| "Alamelu Pi backend stopped before becoming ready".to_string()))
        }
    }

    fn send(&self, value: &Value) -> Result<(), String> {
        write_backend_input(&self.stdin, value)
    }

    fn sync_window(&self, window: &Window, closed: bool) -> Result<(), String> {
        self.send(&window_state_message(window, closed))
    }

    fn shutdown(&self) {
        let _ = self.send(&json!({ "type": "shutdown" }));
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let finished = self
                .child
                .lock()
                .ok()
                .and_then(|mut child| {
                    child
                        .as_mut()
                        .and_then(|entry| entry.try_wait().ok())
                        .flatten()
                })
                .is_some();
            if finished || Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                if child.try_wait().ok().flatten().is_none() {
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-(child.id() as i32), libc::SIGTERM);
                    }
                    let _ = child.kill();
                }
            }
        }
    }
}

fn write_backend_input(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let mut stdin = stdin.lock().map_err(|_| "Backend input lock failed")?;
    serde_json::to_writer(&mut *stdin, value).map_err(|error| error.to_string())?;
    stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
static NATIVE_NOTIFICATION_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
#[cfg(target_os = "macos")]
static NATIVE_PERMISSION_REQUESTS: OnceLock<
    Mutex<HashMap<usize, oneshot::Sender<Result<String, String>>>>,
> = OnceLock::new();
#[cfg(target_os = "macos")]
static NEXT_NATIVE_PERMISSION_REQUEST: AtomicUsize = AtomicUsize::new(1);

#[cfg(target_os = "macos")]
extern "C" {
    fn alamelu_notifications_init(callback: extern "C" fn(*const c_char));
    fn alamelu_notification_show(
        identifier: *const c_char,
        title: *const c_char,
        body: *const c_char,
    );
    fn alamelu_notification_permission_status(
        callback: extern "C" fn(i64, *const c_char, *mut c_void),
        context: *mut c_void,
    );
    fn alamelu_notification_request_permission(
        callback: extern "C" fn(i64, *const c_char, *mut c_void),
        context: *mut c_void,
    );
}

#[cfg(target_os = "macos")]
extern "C" fn native_notification_activated(identifier: *const c_char) {
    if identifier.is_null() {
        return;
    }
    let id = unsafe { CStr::from_ptr(identifier) }
        .to_string_lossy()
        .into_owned();
    let Some(app) = NATIVE_NOTIFICATION_APP.get() else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(backend) = app.try_state::<Backend>() {
        let _ = backend.send(&json!({ "type": "notification-activated", "id": id }));
    }
}

#[cfg(target_os = "macos")]
fn install_native_notification_activation(app: &tauri::AppHandle) {
    let _ = NATIVE_NOTIFICATION_APP.set(app.clone());
    unsafe {
        alamelu_notifications_init(native_notification_activated);
    }
}

#[cfg(not(target_os = "macos"))]
fn install_native_notification_activation(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
fn show_native_notification(id: &str, title: &str, body: &str) -> Result<(), String> {
    let id = CString::new(id).map_err(|_| "Notification ID contains a null byte")?;
    let title = CString::new(title).map_err(|_| "Notification title contains a null byte")?;
    let body = CString::new(body).map_err(|_| "Notification body contains a null byte")?;
    unsafe {
        alamelu_notification_show(id.as_ptr(), title.as_ptr(), body.as_ptr());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn show_native_notification(
    app: &tauri::AppHandle,
    _id: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn macos_permission_name(status: i64) -> Result<String, String> {
    match status {
        0 => Ok("default".to_string()),
        1 => Ok("denied".to_string()),
        2 => Ok("granted".to_string()),
        _ => Err(format!(
            "Unknown macOS notification permission status: {status}"
        )),
    }
}

#[cfg(target_os = "macos")]
extern "C" fn native_notification_permission_completed(
    status: i64,
    error: *const c_char,
    context: *mut c_void,
) {
    let request_id = context as usize;
    let sender = NATIVE_PERMISSION_REQUESTS
        .get()
        .and_then(|requests| requests.lock().ok()?.remove(&request_id));
    let Some(sender) = sender else {
        return;
    };
    let result = if error.is_null() {
        macos_permission_name(status)
    } else {
        Err(unsafe { CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned())
    };
    let _ = sender.send(result);
}

#[cfg(target_os = "macos")]
async fn macos_notification_permission(request: bool) -> Result<String, String> {
    let request_id = NEXT_NATIVE_PERMISSION_REQUEST.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    NATIVE_PERMISSION_REQUESTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Notification permission request lock failed".to_string())?
        .insert(request_id, sender);
    let context = request_id as *mut c_void;
    unsafe {
        if request {
            alamelu_notification_request_permission(
                native_notification_permission_completed,
                context,
            );
        } else {
            alamelu_notification_permission_status(
                native_notification_permission_completed,
                context,
            );
        }
    }
    match tokio::time::timeout(Duration::from_secs(30), receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("macOS notification permission callback was dropped".to_string()),
        Err(_) => {
            if let Some(requests) = NATIVE_PERMISSION_REQUESTS.get() {
                if let Ok(mut requests) = requests.lock() {
                    requests.remove(&request_id);
                }
            }
            Err("macOS notification permission request timed out".to_string())
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutedEvent {
    channel: String,
    payload: Value,
}

#[tauri::command]
async fn backend_invoke(
    backend: State<'_, Backend>,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    backend.wait_ready().await?;
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    backend
        .pending
        .lock()
        .map_err(|_| "Backend response lock failed")?
        .insert(id.clone(), sender);
    if let Err(error) = backend.send(&json!({
        "type": "request",
        "id": id,
        "channel": channel,
        "args": args
    })) {
        backend
            .pending
            .lock()
            .map_err(|_| "Backend response lock failed")?
            .remove(&id);
        return Err(error);
    }
    tokio::time::timeout(Duration::from_secs(600), receiver)
        .await
        .map_err(|_| "Backend request timed out".to_string())?
        .map_err(|_| "Backend response channel closed".to_string())?
}

#[tauri::command]
fn native_pick_workspace() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn native_pick_attachments() -> Result<Vec<Value>, String> {
    let Some(paths) = rfd::FileDialog::new().pick_files() else {
        return Ok(Vec::new());
    };
    paths.iter().map(attachment_from_path).collect()
}

fn attachment_from_path(path: &PathBuf) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("Attachment is not a file: {}", path.display()));
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_string();
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    let id = Uuid::new_v4().to_string();
    if matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
        if metadata.len() > MAX_IMAGE_BYTES {
            return Err(format!("Image attachment is larger than 10 MB: {name}"));
        }
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        return Ok(json!({
            "id": id,
            "kind": "image",
            "name": name,
            "mimeType": mime,
            "data": base64::engine::general_purpose::STANDARD.encode(bytes)
        }));
    }
    Ok(json!({
        "id": id,
        "kind": "file",
        "name": name,
        "mimeType": mime,
        "fsPath": path.to_string_lossy(),
        "sizeBytes": metadata.len()
    }))
}

#[tauri::command]
fn native_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn native_set_transparency(
    window: WebviewWindow,
    transparency: State<'_, TransparencyState>,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        window
            .set_background_color(Some(Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        window
            .set_effects(
                EffectsBuilder::new()
                    .effect(Effect::UnderWindowBackground)
                    .state(EffectState::Active)
                    .build(),
            )
            .map_err(|error| error.to_string())?;
    } else {
        window
            .set_effects(None)
            .map_err(|error| error.to_string())?;
        window
            .set_background_color(None)
            .map_err(|error| error.to_string())?;
    }
    transparency.0.store(enabled, Ordering::Release);
    Ok(())
}

#[tauri::command]
fn native_open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS URLs may be opened".to_string());
    }
    open::that_detached(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn native_get_theme_mode(theme_mode: State<'_, ThemeModeState>) -> Result<String, String> {
    theme_mode
        .0
        .lock()
        .map(|mode| mode.clone())
        .map_err(|_| "Theme mode lock failed".to_string())
}

#[tauri::command]
fn native_get_resolved_theme(window: WebviewWindow) -> Result<String, String> {
    window
        .theme()
        .map(theme_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn native_set_theme_mode(
    window: WebviewWindow,
    app: tauri::AppHandle,
    theme_mode: State<'_, ThemeModeState>,
    mode: String,
) -> Result<String, String> {
    let theme = match mode.as_str() {
        "system" => None,
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => return Err(format!("Unsupported theme mode: {mode}")),
    };
    window.set_theme(theme).map_err(|error| error.to_string())?;
    *theme_mode
        .0
        .lock()
        .map_err(|_| "Theme mode lock failed".to_string())? = mode.clone();
    let resolved = window
        .theme()
        .map(theme_name)
        .unwrap_or_else(|_| mode.clone());
    let _ = app.emit(
        "alamelu-tauri://native-event",
        RoutedEvent {
            channel: "alamelu-pi:theme-changed".to_string(),
            payload: Value::String(resolved),
        },
    );
    Ok(mode)
}

fn theme_name(theme: Theme) -> String {
    match theme {
        Theme::Dark => "dark".to_string(),
        _ => "light".to_string(),
    }
}

#[tauri::command]
async fn native_notification_status(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos_notification_permission(false).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.notification()
            .permission_state()
            .map(permission_name)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn native_request_notification(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos_notification_permission(true).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.notification()
            .request_permission()
            .map(permission_name)
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn permission_name(state: PermissionState) -> String {
    match state {
        PermissionState::Granted => "granted".to_string(),
        PermissionState::Denied => "denied".to_string(),
        PermissionState::Prompt | PermissionState::PromptWithRationale => "default".to_string(),
    }
}

#[tauri::command]
fn native_open_notification_settings() -> Result<(), String> {
    open::that_detached("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn native_smoke_enabled() -> bool {
    env::var_os("ALAMELU_TAURI_SMOKE_FILE").is_some()
}

fn require_smoke() -> Result<(), String> {
    if env::var_os("ALAMELU_TAURI_SMOKE_FILE").is_some() {
        Ok(())
    } else {
        Err("This command is only available during packaged smoke testing".to_string())
    }
}

#[tauri::command]
fn native_smoke_transparency(transparency: State<'_, TransparencyState>) -> Result<bool, String> {
    require_smoke()?;
    Ok(transparency.0.load(Ordering::Acquire))
}

#[tauri::command]
fn native_smoke_emit_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    require_smoke()?;
    if !matches!(theme.as_str(), "light" | "dark") {
        return Err(format!("Unsupported smoke theme: {theme}"));
    }
    app.emit(
        "alamelu-tauri://native-event",
        RoutedEvent {
            channel: "alamelu-pi:theme-changed".to_string(),
            payload: Value::String(theme),
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn native_smoke_sync_window(
    backend: State<'_, Backend>,
    focused: bool,
    visible: bool,
    minimized: bool,
) -> Result<(), String> {
    require_smoke()?;
    backend.send(&json!({
        "type": "window-state",
        "focused": focused,
        "visible": visible,
        "minimized": minimized,
        "closed": false
    }))
}

#[tauri::command]
fn native_smoke_open_workspace(backend: State<'_, Backend>) -> Result<(), String> {
    require_smoke()?;
    let path = env::var("ALAMELU_TAURI_SMOKE_WORKSPACE")
        .map_err(|_| "Packaged smoke workspace is unavailable".to_string())?;
    backend.send(&json!({ "type": "native-open-workspace", "path": path }))
}

#[tauri::command]
fn native_smoke_attachment() -> Result<Value, String> {
    require_smoke()?;
    let path = env::var("ALAMELU_TAURI_SMOKE_ATTACHMENT")
        .map_err(|_| "Packaged smoke attachment is unavailable".to_string())?;
    attachment_from_path(&PathBuf::from(path))
}

#[tauri::command]
fn native_record_smoke(app: tauri::AppHandle, report: Value) -> Result<(), String> {
    let Some(path) = env::var_os("ALAMELU_TAURI_SMOKE_FILE") else {
        return Ok(());
    };
    let body = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    fs::write(PathBuf::from(path), body).map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}

struct BackendLaunchSpec {
    args: Vec<std::ffi::OsString>,
    backend_entry: Option<std::ffi::OsString>,
}

fn node_compatible_windows_path(path: &Path) -> std::ffi::OsString {
    let value = path.as_os_str().to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}").into();
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.into();
    }
    path.as_os_str().to_os_string()
}

fn backend_launch_spec(backend_path: &Path, windows: bool) -> BackendLaunchSpec {
    if windows {
        BackendLaunchSpec {
            args: vec![
                "-e".into(),
                "require(process.env.ALAMELU_TAURI_BACKEND_ENTRY);".into(),
            ],
            backend_entry: Some(node_compatible_windows_path(backend_path)),
        }
    } else {
        BackendLaunchSpec {
            args: vec![backend_path.as_os_str().to_os_string()],
            backend_entry: None,
        }
    }
}

fn start_backend(app: &tauri::AppHandle) -> Result<Backend, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let backend_path = resource_dir.join("backend").join("main.cjs");
    if !backend_path.is_file() {
        return Err(format!(
            "Bundled backend is missing: {}",
            backend_path.display()
        ));
    }
    let home =
        dirs::home_dir().ok_or_else(|| "Could not resolve the home directory".to_string())?;
    let node = resolve_executable("node", "ALAMELU_TAURI_NODE", &home)?;
    let pi = resolve_pi_executable(&home)?;
    let app_data = env::var_os("PI_APP_USER_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?,
        );
    fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;

    let mut path_entries = vec![
        node.parent().unwrap_or(Path::new("")).to_path_buf(),
        pi.parent().unwrap_or(Path::new("")).to_path_buf(),
    ];
    if let Some(existing) = env::var_os("PATH") {
        path_entries.extend(env::split_paths(&existing));
    }
    let child_path = env::join_paths(path_entries).map_err(|error| error.to_string())?;

    let launch = backend_launch_spec(&backend_path, cfg!(windows));
    let mut command = Command::new(&node);
    command
        .args(&launch.args)
        .current_dir(backend_path.parent().unwrap_or(&resource_dir))
        .env("PATH", child_path)
        .env("PI_GUI_BRAND", "alpi")
        .env("PI_GUI_PI_BIN", &pi)
        .env("PI_APP_USER_DATA_DIR", &app_data)
        .env(
            "ALAMELU_TAURI_BACKEND_DIR",
            backend_path.parent().unwrap_or(&resource_dir),
        )
        .env("ALAMELU_TAURI_RESOURCES", &resource_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(backend_entry) = launch.backend_entry {
        command.env("ALAMELU_TAURI_BACKEND_ENTRY", backend_entry);
    }
    #[cfg(windows)]
    if is_wsl_executable(&pi) {
        command.env("PI_GUI_WSL", "1");
        if env::var_os("PI_CODING_AGENT_DIR").is_none() {
            command.env("PI_CODING_AGENT_DIR", resolve_wsl_agent_dir(&pi)?);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start Alamelu Pi backend with {}: {error}",
            node.display()
        )
    })?;
    let stdin = Arc::new(Mutex::new(
        child
            .stdin
            .take()
            .ok_or_else(|| "Backend stdin is unavailable".to_string())?,
    ));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Backend stdout is unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Backend stderr is unavailable".to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let ready = Arc::new(AtomicBool::new(false));
    let ready_notify = Arc::new(Notify::new());
    let fatal = Arc::new(Mutex::new(None));

    read_backend_stdout(
        app.clone(),
        stdout,
        stdin.clone(),
        pending.clone(),
        ready.clone(),
        ready_notify.clone(),
        fatal.clone(),
    );
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[alamelu-tauri-backend] {line}");
        }
    });

    Ok(Backend {
        stdin,
        child: Mutex::new(Some(child)),
        pending,
        ready,
        ready_notify,
        fatal,
    })
}

fn read_backend_stdout(
    app: tauri::AppHandle,
    stdout: std::process::ChildStdout,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<PendingResult>>>>,
    ready: Arc<AtomicBool>,
    ready_notify: Arc<Notify>,
    fatal: Arc<Mutex<Option<String>>>,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(value) => value,
                Err(error) => {
                    fail_backend(&pending, &fatal, &ready_notify, error.to_string());
                    return;
                }
            };
            let message: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => {
                    eprintln!("[alamelu-tauri-backend] {line}");
                    continue;
                }
            };
            match message.get("type").and_then(Value::as_str) {
                Some("ready") => {
                    ready.store(true, Ordering::Release);
                    ready_notify.notify_waiters();
                    let _ = app.emit("alamelu-tauri://backend-ready", ());
                }
                Some("response") => {
                    let Some(id) = message.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let sender = pending.lock().ok().and_then(|mut map| map.remove(id));
                    if let Some(sender) = sender {
                        let result = if message.get("ok").and_then(Value::as_bool) == Some(true) {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(message
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Backend request failed")
                                .to_string())
                        };
                        let _ = sender.send(result);
                    }
                }
                Some("event") => {
                    if let (Some(channel), Some(payload)) = (
                        message.get("channel").and_then(Value::as_str),
                        message.get("payload"),
                    ) {
                        let _ = app.emit(
                            "alamelu-tauri://backend-event",
                            RoutedEvent {
                                channel: channel.to_string(),
                                payload: payload.clone(),
                            },
                        );
                    }
                }
                Some("notification") => {
                    let id = message
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("alamelu-notification");
                    let title = message
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Alamelu Pi");
                    let body = message.get("body").and_then(Value::as_str).unwrap_or("");
                    #[cfg(target_os = "macos")]
                    let _ = show_native_notification(id, title, body);
                    #[cfg(not(target_os = "macos"))]
                    let _ = show_native_notification(&app, id, title, body);
                }
                Some("native-request") => {
                    let Some(id) = message.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let id = id.to_string();
                    let method = message
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let app = app.clone();
                    let stdin = stdin.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = match method.as_str() {
                            "notification-status" => native_notification_status(app.clone()).await,
                            "notification-request" => {
                                native_request_notification(app.clone()).await
                            }
                            _ => Err(format!("Unsupported native request: {method}")),
                        };
                        let response = match result {
                            Ok(result) => {
                                json!({ "type": "native-response", "id": id, "ok": true, "result": result })
                            }
                            Err(error) => {
                                json!({ "type": "native-response", "id": id, "ok": false, "error": error })
                            }
                        };
                        let _ = write_backend_input(&stdin, &response);
                    });
                }
                Some("fatal") => {
                    let error = message
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Backend failed")
                        .to_string();
                    fail_backend(&pending, &fatal, &ready_notify, error);
                }
                _ => {}
            }
        }
        fail_backend(
            &pending,
            &fatal,
            &ready_notify,
            "Alamelu Pi backend exited".to_string(),
        );
    });
}

fn window_state_message(window: &Window, closed: bool) -> Value {
    json!({
        "type": "window-state",
        "focused": !closed && window.is_focused().unwrap_or(false),
        "visible": !closed && window.is_visible().unwrap_or(false),
        "minimized": !closed && window.is_minimized().unwrap_or(false),
        "closed": closed
    })
}

fn route_window_event(window: &Window, event: &WindowEvent) {
    let Some(backend) = window.try_state::<Backend>() else {
        return;
    };
    let closed = matches!(
        event,
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
    );
    let _ = backend.sync_window(window, closed);
    if let WindowEvent::ThemeChanged(theme) = event {
        let _ = window.app_handle().emit(
            "alamelu-tauri://native-event",
            RoutedEvent {
                channel: "alamelu-pi:theme-changed".to_string(),
                payload: Value::String(theme_name(*theme)),
            },
        );
    }
}

fn install_application_menu(app: &tauri::App) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Alamelu Pi Tauri")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let open_folder = MenuItemBuilder::with_id("file.open-folder", "Open Folder…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_folder)
        .separator()
        .close_window()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn open_workspace_from_menu(app: &tauri::AppHandle) {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return;
    };
    if let Some(backend) = app.try_state::<Backend>() {
        let _ = backend.send(&json!({
            "type": "native-open-workspace",
            "path": path.to_string_lossy()
        }));
    }
}

fn fail_backend(
    pending: &Arc<Mutex<HashMap<String, oneshot::Sender<PendingResult>>>>,
    fatal: &Arc<Mutex<Option<String>>>,
    ready_notify: &Arc<Notify>,
    error: String,
) {
    if let Ok(mut slot) = fatal.lock() {
        *slot = Some(error.clone());
    }
    ready_notify.notify_waiters();
    if let Ok(mut requests) = pending.lock() {
        for (_, sender) in requests.drain() {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

fn resolve_executable(name: &str, override_var: &str, home: &Path) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(value) = env::var_os(override_var) {
        candidates.push(PathBuf::from(value));
    }
    if let Some(path) = env::var_os("PATH") {
        for entry in env::split_paths(&path) {
            candidates.push(entry.join(name));
            #[cfg(windows)]
            candidates.push(entry.join(format!("{name}.exe")));
        }
    }
    let nvm_root = home.join(".nvm").join("versions").join("node");
    if let Ok(entries) = fs::read_dir(&nvm_root) {
        let mut versions: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        versions.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        candidates.extend(
            versions
                .into_iter()
                .map(|entry| entry.join("bin").join(name)),
        );
    }
    candidates.extend([
        home.join(".local").join("bin").join(name),
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        PathBuf::from("/usr/bin").join(name),
    ]);
    #[cfg(unix)]
    {
        let shell = env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
        if let Ok(output) = Command::new(shell)
            .args(["-lc", &format!("command -v {name}")])
            .output()
        {
            if output.status.success() {
                let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !value.is_empty() {
                    candidates.push(PathBuf::from(value));
                }
            }
        }
    }
    for candidate in candidates {
        if candidate.is_file() {
            return candidate.canonicalize().map_err(|error| error.to_string());
        }
    }
    Err(format!(
        "Could not find {name}. Set {override_var} to its absolute executable path."
    ))
}

#[cfg(not(windows))]
fn resolve_pi_executable(home: &Path) -> Result<PathBuf, String> {
    resolve_executable("pi", "PI_GUI_PI_BIN", home)
}

#[cfg(windows)]
fn resolve_pi_executable(home: &Path) -> Result<PathBuf, String> {
    resolve_executable("wsl", "PI_GUI_PI_BIN", home).map_err(|_| {
        "Could not find WSL. Install WSL with Pi, or set PI_GUI_PI_BIN to wsl.exe.".to_string()
    })
}

#[cfg(windows)]
fn is_wsl_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wsl.exe"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn resolve_wsl_agent_dir(wsl: &Path) -> Result<PathBuf, String> {
    let output = Command::new(wsl)
        .args(["--exec", "sh", "-lc", "wslpath -w \"$HOME\""])
        .output()
        .map_err(|error| format!("Could not query the WSL home directory: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not query the WSL home directory: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if home.is_empty() {
        return Err("WSL returned an empty home directory".to_string());
    }
    Ok(PathBuf::from(home).join(".pi").join("agent"))
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let backend = start_backend(&app.handle())?;
            app.manage(backend);
            install_native_notification_activation(&app.handle());
            app.manage(ThemeModeState(Mutex::new("system".to_string())));
            app.manage(TransparencyState(AtomicBool::new(false)));
            install_application_menu(app)?;
            if let (Some(window), Some(backend)) =
                (app.get_webview_window("main"), app.try_state::<Backend>())
            {
                let _ = backend.send(&json!({
                    "type": "window-state",
                    "focused": window.is_focused().unwrap_or(false),
                    "visible": window.is_visible().unwrap_or(false),
                    "minimized": window.is_minimized().unwrap_or(false),
                    "closed": false
                }));
            }
            Ok(())
        })
        .on_window_event(route_window_event)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "file.open-folder" {
                open_workspace_from_menu(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_invoke,
            native_pick_workspace,
            native_pick_attachments,
            native_toggle_maximize,
            native_set_transparency,
            native_open_external,
            native_get_theme_mode,
            native_get_resolved_theme,
            native_set_theme_mode,
            native_notification_status,
            native_request_notification,
            native_open_notification_settings,
            native_smoke_enabled,
            native_smoke_transparency,
            native_smoke_emit_theme,
            native_smoke_sync_window,
            native_smoke_open_workspace,
            native_smoke_attachment,
            native_record_smoke
        ])
        .build(tauri::generate_context!())
        .expect("error while building Alamelu Pi Tauri");

    app.run(|handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(backend) = handle.try_state::<Backend>() {
                backend.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn windows_backend_launch_keeps_spaced_entry_path_out_of_arguments() {
        let backend_path = Path::new(
            r"\\?\C:\Users\Asus\AppData\Local\Alamelu Pi Tauri\resources\backend\main.cjs",
        );
        let launch = backend_launch_spec(backend_path, true);
        assert_eq!(
            launch.args,
            vec![
                OsString::from("-e"),
                OsString::from("require(process.env.ALAMELU_TAURI_BACKEND_ENTRY);")
            ]
        );
        assert_eq!(
            launch.backend_entry,
            Some(OsString::from(
                r"C:\Users\Asus\AppData\Local\Alamelu Pi Tauri\resources\backend\main.cjs"
            ))
        );
    }

    #[cfg(unix)]
    #[test]
    fn finder_like_resolution_finds_nvm_executables() {
        let root = env::temp_dir().join(format!("alamelu-tauri-resolver-{}", Uuid::new_v4()));
        let bin = root.join(".nvm/versions/node/v24.1.0/bin");
        fs::create_dir_all(&bin).unwrap();
        let executable = bin.join("pi");
        fs::write(&executable, "#!/bin/sh\n").unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();
        let previous_path = env::var_os("PATH");
        env::set_var("PATH", "/usr/bin:/bin");
        let resolved = resolve_executable("pi", "ALAMELU_TEST_PI_OVERRIDE", &root).unwrap();
        if let Some(value) = previous_path {
            env::set_var("PATH", value);
        }
        assert_eq!(resolved, executable.canonicalize().unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_http_external_urls() {
        let parsed = url::Url::parse("file:///tmp/private").unwrap();
        assert!(!matches!(parsed.scheme(), "http" | "https"));
    }

    #[test]
    fn native_attachment_preserves_file_metadata() {
        let root = env::temp_dir().join(format!("alamelu-tauri-attachment-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("note.txt");
        fs::write(&file, "hello").unwrap();
        let attachment = attachment_from_path(&file).unwrap();
        assert_eq!(attachment["kind"], "file");
        assert_eq!(attachment["name"], "note.txt");
        assert_eq!(attachment["sizeBytes"], 5);
        assert_eq!(attachment["fsPath"], file.to_string_lossy().as_ref());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn maps_native_notification_permission_statuses() {
        assert_eq!(macos_permission_name(0).unwrap(), "default");
        assert_eq!(macos_permission_name(1).unwrap(), "denied");
        assert_eq!(macos_permission_name(2).unwrap(), "granted");
        assert!(macos_permission_name(99).is_err());
    }
}
