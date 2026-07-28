# Alamelu Pi Tauri — Implementation Record

Plan: [alamelu_tauri_plan.md](./alamelu_tauri_plan.md)

## Outcome

Built and tested a separate Apple Silicon Tauri application:

- Product: `Alamelu Pi Tauri`
- Window brand: `Alamelu Pi`
- Identifier: `com.alamelu.pi.tauri`
- Candidate:
  `apps/desktop/src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`
- Size: approximately 76 MB
- Electron framework in bundle: absent
- Existing `/Applications/Alamelu Pi.app`: untouched

The candidate is signed with `Alamelu Pi Local Code Signing`, uses hardened
runtime, and passes strict deep signature verification.

## Implemented architecture

### Reused unchanged behavior

The existing React renderer, `DesktopAppStore`, Pi RPC driver, catalogues,
session handling, model/provider handling, skills/extensions, terminal, diffs,
attachments, and provider-login controller remain the application engine.

### New Tauri host

`apps/desktop/src-tauri` supplies:

- the native Tauri window;
- absolute Node/Pi discovery that works with a Finder-like restricted `PATH`;
- a correlated JSON request/event transport to one Node sidecar;
- native workspace/attachment pickers;
- native theme, transparency, maximize, URL opening, menu, and notification
  operations;
- real window lifecycle forwarding to the reused backend visibility logic;
- macOS notification-ID activation routing to the existing per-session click
  handler;
- backend notification permission status/request routing to
  `UNUserNotificationCenter`;
- real asynchronous macOS permission-state queries and first-run authorization
  requests returned through the correlated native-response transport;
- bounded readiness/request timeouts;
- graceful backend/Pi process-tree shutdown;
- an isolated state directory and a test-only state override.

### Backend sidecar

`tauri-electron-shim.ts` implements only the Electron host surface used by the
existing backend. `tauri-backend-transport.ts` loads the existing main process,
waits until the complete backend handler set is registered, then exposes it to
Rust. `node-pty` is copied as the platform-native resource and its macOS spawn
helper is made executable.

### Renderer bridge

`tauri-bridge.ts` exposes the complete `PiDesktopApi` contract as
`window.piApp`. Backend calls use the sidecar; native calls use Rust. A contract
test compares the Tauri object against every interface member.

Normal WebKit paste events carry clipboard image bytes through the existing
composer path. The native attachment picker constructs the same attachment
records as the Electron host.

### Packaging and signing

- Tauri renderer/backend asset build
- Apple Silicon `.app` packaging
- AWS Secrets Manager retrieval of the existing signing metadata without
  printing secret fields
- keychain unlock and signing by identity hash
- hardened-runtime and strict signature verification
- packaged UI smoke under a minimal Finder-like environment

No credentials or signing values are stored in the repository or artifact.

## Verification evidence

### Compile/build

- TypeScript renderer and Electron/backend projects: PASS
- Vite Tauri renderer production build: PASS (350 modules)
- esbuild backend sidecar: PASS
- `cargo fmt --check`: PASS
- `cargo check`: PASS
- Tauri Apple Silicon release build and `.app` bundle: PASS

### Automated tests

- Rust host tests: 4 passed
  - Finder-like NVM executable discovery
  - native attachment metadata
  - external URL scheme restriction
  - native macOS permission-state mapping
- Tauri API/transport tests: 2 passed
  - all 91 `PiDesktopApi` members exposed
  - readiness, concurrent correlation, real Pi state, and clean shutdown
- Existing focused Alamelu tests: 60 passed
  - auth bridge, model parser, Pi patch, model switching, Finder path,
    RPC configuration/launcher, and user-facing errors
- Tauri functional smoke: PASS
  - 42 providers and 580 models discovered
  - workspace/file listing
  - diff and staging in a temporary Git repository
  - integrated terminal command/output/close
  - provider login-state flow and cancellation without credential mutation
  - existing RPC worktree capability correctly reported as unsupported
  - background window state reached the synthetic backend window
  - background completion emitted a native notification with a stable ID
  - ordinary refocus preserved the currently selected session
  - activating a specific notification selected its corresponding session
  - default permission state invoked the native permission request exactly once
    through the native-host seam
  - native Open Folder transport loaded a second temporary workspace
  - real authenticated `cursor/auto` response contained `TAURI_READY`
  - a second real run was cancelled and did not remain running

### Signed packaged app smoke

Launched the signed candidate with:

- `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
- isolated temporary Tauri state
- real installed Node, Pi, and existing read-only credentials

Result:

- backend ping: `pi desktop ready`
- WebView API members: 91
- providers: 42
- models: 580
- rendered UI contained New thread, Skills, Extensions, and workspace controls
- native dark-theme round trip: PASS
- native system-theme event and event-listener removal: PASS
- native transparency enable/disable path: PASS
- native lifecycle state reached the backend: PASS
- native Open Folder menu transport loaded a temporary workspace: PASS
- native attachment conversion/add/remove through Rust and WebView: PASS
- generated PNG paste through WebKit composer path, state, and removal: PASS
- native notification permission query through the signed Rust/native boundary:
  PASS
- maximize/restore round trip: PASS
- signed candidate window visually inspected: PASS; the Alamelu Pi shell,
  navigation, native menu, and empty-workspace surface rendered correctly
- app exited automatically after the smoke
- no backend or Pi child remained

The native file-dialog UI itself is represented in automation by the same-path
smoke seam because system dialogs are not safely scriptable in this packaged
test. Rust attachment conversion is additionally covered by a host unit test.

Final signature:

- Identifier: `com.alamelu.pi.tauri`
- Authority: `Alamelu Pi Local Code Signing`
- Hardened runtime: present
- `codesign --verify --deep --strict`: PASS

On macOS, notification delivery uses `UNUserNotificationCenter` with a retained
delegate. Its response callback carries the exact notification identifier into
Rust and then into the existing backend click handler. Window focus and Dock
reopen no longer synthesize notification clicks. Permission status and the
first-run authorization prompt use the same native framework rather than the
desktop notification plugin's placeholder permission result.

## Scope notes

- The reused Pi RPC driver reports worktrees as unsupported; the Tauri build
  preserves that existing Alamelu Pi behavior.
- Public GitHub repository creation, CI, Windows packaging, auto-update,
  notarization, and Codex licensing remain outside this phase.
