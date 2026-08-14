# Alamelu Pi Tauri: Sidebar Toggle Repair, Topbar Folder Tooltip, and CI Builds

## Owner Ask & Scope
1. **Repair Sidebar Toggle (left)**: When sidebar is open, clicking the toggle collapses the sidebar. When collapsed, clicking the toggle now successfully re-expands the sidebar (previously clicks were intercepted by the draggable macOS window header region in overlay titlebar mode, though `Cmd+B` worked).
2. **Add Mouseover Tooltip to Last Icon (right)**: Add shortcut tooltip on hover to the "Open folder" / "Add folder" action icon in the topbar (`⌘O` on macOS / `Ctrl+O` on Linux/Windows).
3. **Prevent typing 'o' interception**: Ensure `Command+O` / `Ctrl+O` shortcut handling does not interfere with regular typing.
4. **GitHub Actions Native Builds**: Ensure `.github/workflows/native-build.yml` builds both macOS Apple Silicon and Windows AMD64 (`.exe` NSIS installer) artifacts.
5. **Windows Credential Sync**: Ensure `windows-sync.sh` copies all required Pi configuration files including `.vertex.json`, `auth.json`, `models.json`, and extensions, and normalizes file paths for WSL.
6. **Windows Integrated Terminal Default**: Default Windows integrated terminal shell to `wsl.exe` if present, with fallback to `cmd.exe`.
7. **Windows Tooltip Hover State**: Fix tooltip persistence on Windows by replacing `:focus-within` with `:has(:focus-visible)` so tooltips dismiss immediately on mouse leave and do not persist after click.
8. **WSL Auth Snapshot Extraction**: Isolate the JSON auth snapshot output with explicit markers (`__ALPI_AUTH_SNAPSHOT_START__` / `__ALPI_AUTH_SNAPSHOT_END__`) so WSL login shell banners or MOTD lines do not break JSON parsing.

No scope expansion. All changes are minimal, targeted, and fully reversible.

## Architecture & Code Changes

### 1. `apps/desktop/src/topbar.tsx`
- Added optional `primarySidebarToggle?: ReactNode` to `TopbarProps`.
- Rendered `{primarySidebarToggle}` inside `<header className="topbar" ...>`.
- Wrapped the folder icon button in `<div className="shortcut-tooltip-wrap topbar__tooltip-wrap">` with `<span className="shortcut-tooltip topbar__tooltip" role="tooltip"><span>Open folder</span><kbd>{openFolderShortcut}</kbd></span>`, matching the terminal and diff toggle buttons.
- Defined `openFolderShortcut = getDesktopShortcutLabel(api.platform, "O")`.

### 2. `apps/desktop/src/App.tsx`
- When `snapshot.sidebarCollapsed` is `false` (sidebar expanded): `SidebarToggleButton` is rendered in `.shell` over the non-draggable sidebar area.
- When `snapshot.sidebarCollapsed` is `true` (sidebar collapsed): `SidebarToggleButton` is passed into `Topbar` as `primarySidebarToggle`, making it a direct descendant of the draggable `.topbar` container.
- Wired `desktopCommands.openFolder` in `handleCommand` so that `Cmd+O` / `Ctrl+O` triggers `api.pickWorkspace()`, both in standard focus and inside terminal panels.

### 3. `apps/desktop/src/ipc.ts`
- Added `openFolder: "open-folder"` to `desktopCommands`.
- Mapped `!input.shift && (lowerKey === "o" || input.code === "KeyO")` in `getDesktopCommandFromShortcut` to `desktopCommands.openFolder`.

### 4. `apps/desktop/src/styles/main.css`
- Added `position: relative;` to `.topbar` to anchor absolutely-positioned children like `.sidebar-toggle` at `top: 11px; left: var(--titlebar-toggle-left);`.
- Added `-webkit-app-region: no-drag;` to `.sidebar-toggle, .sidebar-toggle *` to ensure all children (button, SVG, tooltip) remain non-draggable.
- Replaced `.shortcut-tooltip-wrap:focus-within` with `.shortcut-tooltip-wrap:has(:focus-visible)` to prevent sticky tooltips after clicking buttons on Windows WebView2.

### 5. `apps/desktop/electron/terminal-service.ts`
- On Windows (`process.platform === "win32"`), default shell resolution checks for `C:\Windows\System32\wsl.exe` and uses WSL if present, falling back to `process.env.ComSpec || "cmd.exe"`.

### 6. `apps/desktop/electron/external-pi-auth-bridge.ts`
- Enclosed the WSL auth probe JSON output in boundary markers (`__ALPI_AUTH_SNAPSHOT_START__` and `__ALPI_AUTH_SNAPSHOT_END__`), parsing only the marked JSON payload to prevent JSON parse errors from shell startup messages.

### 7. `scripts/windows-sync.sh`
- Added sync for `.vertex.json` and path normalization for WSL paths in `auth.json`.

### 8. `.github/workflows/native-build.yml`
- Configured triggers on `push` to `main` as well as `workflow_dispatch` with platform choices (`all`, `windows`, `macos`).
- Builds macOS Apple Silicon (`Alamelu-Pi-Tauri-macos-arm64.zip`) and Windows AMD64 (`.exe` NSIS installer).

## Verification Round 1

### Commands and Output

1. **Typecheck**:
```bash
$ pnpm run typecheck
$ tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit
EXIT 0
```

2. **Tauri Unit Tests**:
```bash
$ pnpm run test:tauri:unit
✔ Tauri bridge exposes every PiDesktopApi property (11.388959ms)
✔ backend becomes ready, correlates concurrent calls, and shuts down (1211.29775ms)
ℹ tests 2
ℹ pass 2
EXIT 0
```

3. **Tauri Functional Smoke Test**:
```bash
$ pnpm run test:tauri:functional
✔ Tauri backend supports workspace, diff, terminal, provider flow, and a real model (38457.361167ms)
ℹ tests 1
ℹ pass 1
EXIT 0
```

4. **Tauri Assets Build**:
```bash
$ pnpm run build:tauri:assets
✓ built in 1.02s
Tauri backend built at apps/desktop/out/tauri-backend
EXIT 0
```

5. **Rust/Cargo Tests**:
```bash
$ cargo test --manifest-path src-tauri/Cargo.toml
test result: ok. 6 passed; 0 failed; 0 ignored
EXIT 0
```

## Verification Round 2

### Commands and Output

1. **Typecheck**:
```bash
$ pnpm run typecheck
$ tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit
EXIT 0
```

2. **Tauri Unit & Functional Tests**:
```bash
$ node --test apps/desktop/tests/unit/tauri-api-parity.test.mjs apps/desktop/tests/unit/tauri-backend-transport.test.mjs apps/desktop/tests/unit/tauri-functional-smoke.test.mjs
✔ Tauri bridge exposes every PiDesktopApi property (14.859ms)
✔ backend becomes ready, correlates concurrent calls, and shuts down (1365.688875ms)
✔ Tauri backend supports workspace, diff, terminal, provider flow, and a real model (39121.818416ms)
ℹ tests 3
ℹ pass 3
EXIT 0
```

3. **Rust/Cargo Tests**:
```bash
$ cargo test --manifest-path src-tauri/Cargo.toml
test result: ok. 6 passed; 0 failed; 0 ignored
EXIT 0
```

4. **Live Windows WSL Pi Execution Test (via S3 Relay)**:
```text
pi -p --provider google --model gemini-2.5-flash:high "what is 2+2?" -> 4
pi -p --provider google-vertex --model gemini-2.5-flash:high "what is 3+3?" -> 6
PASS
```
