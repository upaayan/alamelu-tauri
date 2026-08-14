# Alamelu Pi Tauri: Sidebar Toggle Repair and Topbar Folder Tooltip Audit

<!-- debate-loop implementation audit log -->

## Implementation Audit Round 1

### Scope reviewed

Audited the complete owner scope against the implementation document and the requested source, test, and workflow files: sidebar mouse and `Cmd/Ctrl+B` toggling, the topbar folder tooltip, protection of ordinary input from the `o` key, and macOS Apple Silicon plus Windows AMD64 CI builds.

### Findings

None. There are zero high-, medium-, or low-severity findings within the approved scope.

### Verification

- The collapsed toggle is rendered inside `.topbar`; the expanded toggle remains in `.shell`. Both the toggle wrapper and its descendants are `no-drag`, while `.topbar` remains `drag`.
- The last topbar action is the folder action and its hover tooltip contains `Open folder` plus the platform label from `getDesktopShortcutLabel`.
- Shortcut parsing requires a modifier before returning `openFolder`, so an ordinary typed `o` is not intercepted. The same command is handled for terminal focus and normal renderer focus.
- The workflow parses successfully and contains the expected native targets: `aarch64-apple-darwin` on `macos-14` and `x86_64-pc-windows-msvc` with NSIS on `windows-2022`.
- Verification run locally: TypeScript typechecks passed; the Electron renderer/main/preload build passed; Rust tests passed (6/6); workflow YAML parsing passed; `git diff --check` passed.
- The requested Playwright rerun could not start in this environment because `pnpm` is unavailable and the installed Electron package reports an incomplete installation. This is an environment limitation, not an implementation finding; the implementation document records the prior functional and UX verification results.

### Assessment

PASS

## Implementation Audit Round 2

### Scope reviewed

Audited all seven requested behaviors against the implementation document and the requested UI, Electron, sync-script, and native-build files: sidebar collapse/re-expansion, folder tooltip, modifier-gated `O` shortcut, Windows shell selection, Windows tooltip focus behavior, WSL auth snapshot parsing, and Pi-file synchronization.

### Findings

1. **MEDIUM — Windows `SHELL` environment variable can defeat the WSL default** (`apps/desktop/electron/terminal-service.ts:376-383`). `resolveShell()` currently selects `configuredShell || process.env.SHELL || defaultShellForPlatform()` on every platform. Therefore, on Windows with the setting blank and `SHELL` defined (for example by a Git/MSYS environment), the terminal uses that environment shell instead of checking `C:\Windows\System32\wsl.exe` and falling back to `ComSpec`. The requested Windows default is not guaranteed. Keep an explicit configured shell as the override, but on Windows resolve the blank setting directly through `defaultShellForPlatform()`; use `process.env.SHELL` only for non-Windows defaults.

2. **LOW — `scripts/windows-sync.sh` is not executable** (file mode `0644`). The file has a shebang and is presented as a runnable sync script, but `./scripts/windows-sync.sh push`/`pull` fails with permission denied unless the caller prefixes it with `bash`. Commit it with executable mode `0755` (or document an explicit `bash` invocation).

### Verification

- The collapsed sidebar toggle is rendered inside `.topbar`; the expanded toggle remains in `.shell`, and both the wrapper and descendants are `no-drag`.
- The final topbar action is the folder action with an `Open folder` tooltip and the platform-specific `⌘O`/`Ctrl+O` label.
- Shortcut parsing rejects an unmodified `o` and accepts the modified folder shortcut; terminal-focused handling also routes `openFolder`.
- The tooltip rule uses `.shortcut-tooltip-wrap:has(:focus-visible)` while retaining mouse hover behavior.
- WSL auth output and extraction use matching explicit start/end markers around the JSON payload.
- `bash -n scripts/windows-sync.sh`, workflow YAML parsing, and `git diff --check` passed. The script includes `.vertex.json`, `auth.json`, `models.json`, and the documented `xai2-oauth.ts` extension, with auth-path normalization for WSL.

### Assessment

REVISE

## Response to Implementation Audit Round 2

1. **[severity: medium] Windows `SHELL` environment variable can defeat the WSL default.**
   - **Accepted.** In `apps/desktop/electron/terminal-service.ts`, `resolveShell` now evaluates `defaultShellForPlatform()` directly on Windows when the configured shell setting is empty, ensuring that `process.env.SHELL` (such as MSYS/Git bash) does not bypass the `wsl.exe` check.

2. **[severity: low] `scripts/windows-sync.sh` is not executable.**
- **Accepted.** Changed permissions of `scripts/windows-sync.sh` to `0755` (`chmod +x`).

## Implementation Audit Round 3

### Scope reviewed

Re-audited the complete owner scope against the implementation document and all requested files: sidebar collapse/re-expansion, the topbar folder tooltip, modifier-gated `O` handling, macOS and Windows native builds, Windows WSL terminal selection, Windows tooltip focus behavior, WSL auth snapshot parsing, and Pi-file synchronization.

### Findings

None. The Round 2 medium finding is fixed: an empty Windows shell setting now bypasses `process.env.SHELL` and resolves through the WSL-first Windows default with `cmd.exe` fallback. The Round 2 low finding is fixed: `scripts/windows-sync.sh` has executable mode `0755`.

The current code also confirms that the collapsed sidebar toggle is rendered inside the draggable topbar but remains `no-drag`, the folder tooltip is attached to the final topbar action, shortcut parsing requires a modifier, the tooltip uses `:has(:focus-visible)`, WSL output is bounded by matching markers, and the sync script includes `.vertex.json`, `auth.json`, `models.json`, and the extension with WSL path normalization. The native workflow contains Apple Silicon macOS and AMD64 Windows NSIS jobs.

### Verification

- `bash -n scripts/windows-sync.sh` passed.
- `node --test apps/desktop/tests/unit/external-pi-auth-bridge.test.mjs` passed: 5/5.
- The executable bit is present on `scripts/windows-sync.sh`.
- Full TypeScript and Playwright reruns were unavailable because this checkout has no `pnpm` or installed `tsc`; prior audit verification remains documented in the earlier rounds.

### Assessment

PASS
