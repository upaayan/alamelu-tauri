# Alamelu Pi Tauri: Sidebar Toggle Repair, Topbar Folder Tooltip, and CI Builds

## Owner Ask & Scope
1. **Repair Sidebar Toggle (left)**: When sidebar is open, clicking the toggle collapses the sidebar. When collapsed, clicking the toggle now successfully re-expands the sidebar (previously clicks were intercepted by the draggable macOS window header region in overlay titlebar mode, though `Cmd+B` worked).
2. **Add Mouseover Tooltip to Last Icon (right)**: Add shortcut tooltip on hover to the "Open folder" / "Add folder" action icon in the topbar (`⌘O` on macOS / `Ctrl+O` on Linux/Windows).
3. **Prevent typing 'o' interception**: Ensure `Command+O` / `Ctrl+O` shortcut handling does not interfere with regular typing.
4. **GitHub Actions Native Builds**: Ensure `.github/workflows/native-build.yml` builds both macOS Apple Silicon and Windows AMD64 (`.exe` NSIS installer) artifacts.

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

### 5. `apps/desktop/tests/core/ux-repair.spec.ts`
- Added `sidebar toggle button collapses and re-expands the sidebar via mouse clicks`.
- Added `topbar open/add folder icon displays shortcut tooltip on mouseover`.
- Added `typing the letter o in composer does not trigger open folder`.

### 6. `.github/workflows/native-build.yml`
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
