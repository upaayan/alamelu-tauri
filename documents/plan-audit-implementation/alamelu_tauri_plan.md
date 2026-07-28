# Alamelu Pi Tauri — Implementation Plan

## Objective and scope

Build and test a separate macOS Apple Silicon Tauri application that presents
the existing Alamelu Pi desktop experience and uses the same installed Pi
runtime, credentials, models, skills, extensions, workspaces, sessions, tools,
terminal, diffs, attachments, and provider login capabilities.

This phase is deliberately limited to the local macOS application. It does not
create a public repository, add GitHub Actions, build Windows artifacts, change
the installed Electron Alamelu Pi, or investigate the Codex app license.

The candidate will be visibly and technically separate:

- Product/bundle name: `Alamelu Pi Tauri`
- Window title/brand: `Alamelu Pi`
- Bundle identifier: `com.alamelu.pi.tauri`
- Application state: the Tauri bundle's own application-support directory
- Candidate path: Tauri's build output, not `/Applications/Alamelu Pi.app`
- Signing identity: the existing `Alamelu Pi Local Code Signing` identity,
  selected by its stored identity hash

## Architecture

### Reused application layers

Retain the existing React renderer and the Alamelu-owned shared packages:

- `packages/session-driver`
- `packages/pi-rpc-driver`
- `packages/catalogs`
- the external installed `pi --mode rpc` runtime

This preserves the model catalogue, authentication, session semantics, tool
events, extensions, skills, worktrees, diff handling, and the existing UI.

### Tauri host

Add a Tauri 2 host under `apps/desktop/src-tauri` which owns:

- the native window and lifecycle;
- one long-lived Node backend child process;
- request/response correlation over newline-delimited JSON;
- forwarding backend events to the renderer;
- native window operations and filesystem dialogs where the WebView cannot
  supply them safely;
- clean child-process shutdown.

Rust remains a transport and native-shell layer. Model/session logic does not
move into Rust.

### Backend compatibility sidecar

Bundle the existing Electron main process as a Node sidecar with `electron`
resolved to a small compatibility module. The module supplies only the Electron
surface actually used by Alamelu Pi:

- `app` paths/lifecycle;
- an in-memory `BrowserWindow`/`webContents` event surface;
- `ipcMain` handler registration and dispatch;
- safe OS open-path/open-URL operations;
- notification and window event forwarding;
- placeholders for native actions handled directly by Tauri.

The existing `DesktopAppStore`, RPC driver, terminal service, and IPC handlers
remain the source of behavior. A transport entrypoint receives Tauri requests,
dispatches the registered IPC handler with a stable synthetic renderer, and
returns results or errors. Calls and state events may be concurrent.

`node-pty` remains an external native dependency copied into the Tauri
resources. The sidecar uses the user's installed Node runtime, matching the
existing Alamelu Pi dependency on the installed Pi/Node toolchain.

The Rust host resolves absolute Node and Pi executables before starting the
sidecar. Resolution order is: explicit test/user override; the inherited
`PATH`; version-sorted `~/.nvm/versions/node/*/bin`; `~/.local/bin`;
`/opt/homebrew/bin`; `/usr/local/bin`; and the user's login shell. The resolved
Pi path is passed as `PI_GUI_PI_BIN`, and both executable directories are added
to the sidecar's explicit `PATH`. Startup fails with a clear visible error if
either executable is unavailable. Tests exercise this resolver with a minimal
Finder-like environment rather than inheriting the development shell.

### Renderer bridge

Add a Tauri bridge that exposes the same `window.piApp` contract as the Electron
preload. Ordinary methods route through the generic backend transport. Event
subscriptions route through Tauri events.

Native exceptions use Tauri directly:

- choose workspace/attachments;
- maximize/restore the window;
- native URL/path opening;
- theme/window state;
- clipboard image paste;
- notifications.

The build selects the Tauri bridge without changing the Electron preload, so
the original Electron build remains buildable from this source tree.

### Complete route ownership and readiness

The adapter generates or checks its routes against `desktopIpc`; unassigned
channels fail the contract test.

| Owner | Requests |
| --- | --- |
| Rust/native | `pickWorkspace`, `pickComposerAttachments`, `readClipboardImage`, `toggleWindowMaximize`, `openExternal`, `getThemeMode`, `getResolvedTheme`, `setThemeMode`, `getNotificationPermissionStatus`, `requestNotificationPermission`, `openSystemNotificationSettings` |
| Node backend | `ping`; all state, workspace, worktree, session, model, provider, settings, terminal, composer, session-tree, file, diff, stage, open-path, skill, extension, and host-UI requests not listed in the Rust row |

Native pickers return structured paths/data to the adapter. The adapter then
uses the existing backend mutation (`addWorkspacePath` or
`addComposerAttachments`), so there is only one state owner.

| Event origin | Events |
| --- | --- |
| Node backend | `stateChanged`, `selectedTranscriptChanged`, `providerLoginStateChanged`, `terminalData`, `terminalExit`, `terminalError`, `workspacePicked`, and notification requests generated by run state |
| Rust/native | `appCommand`, `clipboardImagePasted`, `notificationPermissionStatusChanged`, `themeChanged`, window/lifecycle errors |

Backend readiness is not inferred from process startup. The sidecar verifies
that the complete expected backend handler set has registered, then emits one
`backend-ready` control message. Rust does not expose the WebView bridge as
ready and does not dispatch queued calls before receiving it. Early calls wait
within a bounded timeout; backend exit rejects all pending calls. Transport
tests cover correlation, concurrent out-of-order replies, event delivery,
subscription removal, readiness timeout, and child exit.

### State and credential behavior

The Tauri app uses a distinct UI/session state directory while continuing to
use the existing `~/.pi/agent` configuration as Alamelu Pi already does.
Credentials are never copied into the repository or build artifacts.

## Expected file/module changes

- Root build metadata and scripts for Tauri build, check, package, and smoke.
- `apps/desktop/vite.config.tauri.ts` — renderer-only Vite entry.
- `apps/desktop/src/tauri-main.tsx` — installs the Tauri bridge, then loads the
  existing React application.
- `apps/desktop/src/tauri-bridge.ts` — complete `PiDesktopApi` adapter.
- `apps/desktop/electron/tauri-electron-shim.ts` — minimal Electron
  compatibility surface.
- `apps/desktop/electron/tauri-backend-transport.ts` — JSON transport and IPC
  dispatch.
- `apps/desktop/scripts/build-tauri-backend.mjs` — deterministic backend bundle
  and native-resource packaging.
- `apps/desktop/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`,
  capabilities, Rust source, and icons.
- Contract/unit tests for transport, API parity, lifecycle, and error handling.
- Packaging/signing/smoke scripts that retrieve the existing signing metadata
  without logging secrets.
- README notes limited to local prerequisites, architecture, and commands.

## Build order

1. Add Tauri renderer build and an API-parity test against the Electron
   preload contract.
2. Add the Electron compatibility module and backend transport with focused
   Node tests.
3. Add the Rust Tauri host and transport tests.
4. Add native-action paths and complete all `window.piApp` methods.
5. Build the renderer/backend, run type checks and existing relevant unit
   tests, then run `cargo check` and Rust tests.
6. Build the Apple Silicon `.app`.
7. Unlock the existing signing keychain, sign by stored identity hash without
   timestamping, and verify the full bundle with strict `codesign`.
8. Launch the packaged candidate with isolated Tauri state and perform the
   packaged smoke tests.

## Verification strategy

### Static and automated checks

- `pnpm typecheck`
- renderer production build
- backend sidecar build
- API contract test proving that the Tauri bridge exposes every
  `PiDesktopApi` method
- existing unit tests relevant to RPC launch, external Pi discovery,
  authentication bridge, model parsing, user-facing errors, and packaging
- backend transport tests covering success, thrown errors, events, and
  concurrent requests
- `cargo fmt --check`
- `cargo check`
- `cargo test`

### Packaged candidate checks

- build produces an Apple Silicon Tauri `.app` with identifier
  `com.alamelu.pi.tauri`;
- no Electron framework is present in the bundle;
- candidate and `/Applications/Alamelu Pi.app` have different identifiers and
  paths;
- strict signature verification passes with the existing Alamelu identity;
- candidate launches while the installed Electron app remains untouched;
- backend readiness/ping succeeds;
- isolated state path is used;
- real Pi runtime is found;
- provider/model catalogue is populated from the user's existing Pi setup;
- a temporary workspace can be opened;
- a session can be created and a short real model response completes;
- the integrated terminal can run a deterministic command;
- skills/extensions lists load;
- diff/file listing works in a temporary Git workspace;
- cancellation and graceful quit do not leave backend or Pi processes behind;
- a screenshot is inspected to confirm the real desktop surface renders.

The smoke harness must redact credentials and avoid printing token-bearing
configuration.

### Bounded Tauri functional-parity matrix

Existing focused backend tests remain the evidence for reused store/driver
logic. The following checks specifically cross each replaced Tauri host
boundary:

| Surface | Tauri-path acceptance check |
| --- | --- |
| GUI executable discovery | Launch the packaged app with a minimal Finder-like `PATH`; assert absolute Node and Pi discovery and backend readiness. |
| Workspace/native path | Choose a temporary workspace through the native picker test seam, load it, and open its path. |
| Attachments/clipboard | Attach a small file and paste a small generated PNG; assert composer attachment state, then remove both. |
| Worktree/diff/stage | In a temporary Git repository, create a worktree, modify a file, read the diff, stage it, and remove the worktree. |
| Streaming/cancel | Start a deterministic test-stream through the real bridge, observe transcript/state events, cancel, and assert the UI returns to idle. A separate minimal real-model response proves the installed Pi path. |
| Terminal | Create a terminal, write a deterministic command, observe output/exit events, resize, and close it. |
| Theme/window | Toggle theme and maximize state; observe the theme event and restored window state. |
| Notification | Trigger the Tauri notification test seam after permission-state evaluation and assert dispatch without altering user preferences. |
| Provider login | Use the existing provider-login test flow, observe state transitions, then cancel; do not write, remove, or replace stored credentials. |
| Lifecycle | Quit during an idle test session and assert no sidecar or descendant Pi process remains. |

## Edge cases and failure behavior

- Missing Node/Pi: show a concise startup error rather than a blank window.
- Backend exits or emits malformed output: reject outstanding requests, show a
  recoverable error, and prevent silent hangs.
- Concurrent requests/events: correlate by unique request ID and serialize only
  writes to the child stdin.
- App closes during a run: request store flush, terminate descendants, then
  exit within a bounded interval.
- Paths containing spaces and non-ASCII characters: pass structured JSON and
  avoid shell interpolation.
- Native dialogs canceled by the user: return the unchanged application state.
- Clipboard has no supported image: return no attachment without error.
- Existing Electron app/state: never write to or replace its bundle or
  application-support directory.

## Out of scope for this phase

- GitHub repository creation or publishing
- GitHub Actions
- Windows/Linux packages
- auto-update
- Apple notarization or public distribution
- Codex application modification or license analysis
- unrelated refactoring or hardening
