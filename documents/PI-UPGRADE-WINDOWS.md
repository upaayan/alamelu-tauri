# Pi upgrades for Alamelu Pi Tauri on Windows

Start with [the canonical rebuild protection checklist](REBUILD-PROTECTION.md). It includes tracked version-specific adapter patches, Mac/WSL runtime check commands, pre-Rust CI gates, and recovery after package reinstalls. The historical evidence below does not replace those gates.

## 2026-09-14: Pi 0.85.1 extension startup failure

The Windows app was already current and did not need rebuilding. Upgrading WSL
Pi from 0.84.2 to 0.85.1 changed npm's `bin/pi` target from `dist/cli.js` to
`dist/bundle/cli.js`. The bundled entry point passed `--version`, `--help`, basic
RPC, and even a real model/tool turn without the app's explicit extension.
Those checks therefore missed the actual app startup failure.

The app explicitly loads
`extensions/alpi-luna-websocket-recovery.ts`. Its `loadPiWebSocketReset()` calls
`require.resolve("@earendil-works/pi-coding-agent")` to locate the active Pi
provider module and its WebSocket reset helper. Pi's unbundled extension loader
provides filesystem aliases. Its bundled loader instead provides virtual modules,
which do not satisfy this filesystem lookup from the installed app extension.

Observed with the preserved failed WSL package:

| Pi entry point, with installed app extension | Result |
| --- | --- |
| 0.84.2 `dist/cli.js` | RPC works |
| 0.85.1 `dist/cli.js` | RPC works |
| 0.85.1 `dist/bundle/cli.js` | Exits 1 before answering RPC |

Exact failure:

```text
Failed to load extension .../alpi-luna-websocket-recovery.ts
Cannot find module '@earendil-works/pi-coding-agent'
```

The app sees the resulting dead RPC child. Reverting the whole Pi package hid the
launcher/extension incompatibility. The narrow repair is Pi **0.85.1 with the
unbundled entry point**, retaining the extension and its access to the active
provider implementation. Merely suppressing the extension error would lose the
Luna recovery behavior.

## Installed WSL state

- Node: `22.23.1` (meets Pi's `>=22.19.0` requirement).
- Pi package: `/home/ubuntu/.playground/sudhir-codex-toolchain/lib/node_modules/@earendil-works/pi-coding-agent`, version `0.85.1`.
- Launcher: `/home/ubuntu/.playground/sudhir-codex-toolchain/bin/pi`.
- Required symlink target for this release: `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.
- Original working archive: `/home/ubuntu/.playground/sudhir-codex-toolchain/backups/pi-coding-agent-0.84.2-20260914.tgz`.
- Working package directory retained during repair: `/home/ubuntu/.playground/sudhir-codex-toolchain/backups/pi-coding-agent-0.84.2-pre-fix-20260914`.
- Failed-upgrade archive retained: `/home/ubuntu/.playground/sudhir-codex-toolchain/backups/pi-coding-agent-0.85.1-before-revert-20260914.tgz`.

The repaired package came from that preserved 0.85.1 archive, reproduced and tested
in isolation before activation. No application binary, extension code, provider
configuration, or authentication was replaced by the repair. No Rust build or
Windows installer was needed.

## Required upgrade check

`npm install -g` can reset the launcher to the bundled entry point. Check the
**resolved launcher and the installed app extension**, not just the package
version. Do not carry the 0.85.1 entry point assumption into future versions
without checking that it exists and passes this test.

On WSL, from this repository (or copy just the checker to WSL):

```bash
export PATH=/home/ubuntu/.playground/sudhir-codex-toolchain/bin:$PATH
python3 scripts/check-pi-app-extension.py \
  --pi /home/ubuntu/.playground/sudhir-codex-toolchain/bin/pi \
  --extension '/mnt/c/Users/Asus/AppData/Local/Alamelu Pi Tauri/extensions/alpi-luna-websocket-recovery.ts'
```

The checker fails if extension loading terminates Pi or if Pi cannot answer two
RPC requests. It makes no model request and saves no session. For a staged
package, pass `--node` and its explicit CLI JS path as `--pi`; test before changing
the installed package. The checker was verified to reject bundled 0.85.1 and
accept unbundled 0.85.1 with the actual installed extension.

Only for the diagnosed 0.85.1 layout, the compatible link is:

```bash
ln -sfn ../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  /home/ubuntu/.playground/sudhir-codex-toolchain/bin/pi
```

Keep the existing working package until the upgraded Pi passes the extension
check, a real authenticated tool turn, and a second prompt. Verify the native
Windows app backend through `wsl.exe` too. Do not disable provider extensions or
replace WSL configuration with Mac paths to make a check pass.

## Connection and verification details

Use `s3://sudhir-windows-relay`, region `ap-south-1`, for the Windows WSL poller.
Upload a uniquely named `relay_cmd_<id>.sh`; retrieve the exact
`relay_response_<id>.txt`. The response appears after the command exits. Never
resubmit an unresolved mutation. Remove only this task's relay keys after saving
the results. Use absolute executables in poller commands: interactive Bash can
stop under job control. The native Windows app's own `wsl.exe` → `bash -lic`
launch is a separate path and must be tested as such.

Repair evidence is saved in [release-evidence/pi085-wsl-20260914](release-evidence/pi085-wsl-20260914).
The native Windows backend loaded 733 models / 47 providers, created a temporary
session, used Meta Muse Spark 1.3 Contributor to read the test file, and completed
a second prompt in the same session. Both expected assistant replies were
verified in its transcript, and the test backend shut down with exit 0.

Final checks confirmed Pi 0.85.1, the unbundled launcher, and unchanged hashes for
Pi auth/settings/models, both xAI extensions, the Windows app executable, and its
Luna recovery extension. The executable remains the existing `3c02194` build.
Existing sessions and the running owner app were left intact; native backend
verification used separate temporary application state. This was a test of the
installed backend and its real native Windows → WSL path, not a visual GUI test.

Two additional observations were kept separate from the repair:

- WSL `.bashrc` line 151 runs `cd $lazydir`, selecting
  `/home/ubuntu/playground/lazytrade` even when the app requests another cwd.
  A relative test-file read exposed this setting. Explicit paths were used for
  the upgrade integration check; the shell setting was not changed.
- On Mac, a fresh 0.85.1 bundled Pi process with the installed app extension
  reproduces the same module-resolution failure; the explicit unbundled entry
  point passes. The launcher was initially left unchanged during the Windows
  repair, then fixed with explicit owner approval as recorded below. Do not assume
  an already-running app proves fresh Pi children will start successfully after
  an npm upgrade.

## Mac follow-up — approved and applied 2026-09-14

The owner approved applying the same launcher fix on Mac.
`/Users/sudhirjha/.nvm/versions/node/v24.16.0/bin/pi` now points to
`../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` instead of
`dist/bundle/cli.js`. Pi remains version **0.85.1**.

The regression checker passed through the actual `/Users/sudhirjha/.local/bin/pi`
launcher with the installed Mac app's Luna recovery extension: a fresh process
loaded the extension and answered two RPC requests. Hash checks confirmed that
Pi authentication, settings, models, both xAI extensions, and the app's Luna
extension were unchanged. The running Mac app and user sessions were not
restarted or modified. Evidence: [mac-launcher-fix.json](release-evidence/pi085-wsl-20260914/mac-launcher-fix.json).

## Cursor extension follow-up — 2026-09-14

The owner also requested a check of the Cursor extension. `pi-cursor-sdk` is
loaded through Pi's package settings, separately from the app-bundled Luna
extension. With both extensions explicitly loaded on the repaired Pi 0.85.1,
`cursor/composer-2.5` completed two consecutive prompts on both Mac and WSL.
This verifies startup coexistence and real Cursor replies; the reproduced
upgrade startup failure was the Luna extension's filesystem lookup under the
bundled Pi launcher. No Cursor package or configuration was changed.

Installed Cursor package versions differ: Mac `0.1.60`, WSL `0.3.6`. Both passed
this check; it was not a package synchronization or full Cursor feature audit.
Evidence: [Mac](release-evidence/pi085-wsl-20260914/mac-cursor-check.log) and
[WSL](release-evidence/pi085-wsl-20260914/wsl-cursor-check.log).

## Compaction compatibility rollout — 2026-09-14

Treat these two fixes as one Mac/Windows release: Cursor summaries must return finished text without Pi tool calls, and model switching must estimate the current Pi context rather than the complete JSONL archive.

| Component | Mac | Windows/WSL |
| --- | --- | --- |
| Pi |0.85.1, unbundled dist/cli.js |0.85.1, unbundled dist/cli.js |
| Cursor adapter |0.1.60, loads src/index.ts |0.3.6, loads dist/index.js |
| Compaction fix |Installed and verified |Installed and verified |
| Active-context backend fix |Installed and verified |Installed and verified |

The matching backend SHA256 is `af14fa814ae294239522e8e136add88e7f9ecf186e75d3b033b84e42570ccf66`. Windows ships this same JavaScript bundle while retaining its executable and platform dependencies. Do not copy Mac node-pty or replace WSL0.3.6 with Mac0.1.60; the adapter versions have other distinct behavior.

**Windows packaging trap:** source-only edits are inert in0.3.6. Patch cursor-context-tools, cursor-provider-turn-prepare and cursor-session-agent in both src/*.ts and their dist/*.js counterparts. The three original TypeScript emissions reproduced the installed dist hashes exactly; the emitted fixes were then tested through private settings.packages, matching the actual manifest loader. An npm reinstall can remove these local patches. Check the manifest entry point and runtime hashes, not just version numbers, after future upgrades.

**Release gate:** record Mac and Windows status together. Require targeted omitted/empty-tool regressions; actual manual and automatic compaction plus a normal tool turn; native app→WSL startup with the Luna extension; and model switching on a resumed private fixture after repeated compactions. Verify the actual compaction event and persisted model change. WSL's documented startup cwd override must be reflected in the fixture; a no-error result against an accidentally new empty session is not evidence. Keep Windows marked pending until its installed checks pass.

Evidence and rollout history: [compaction implementation](plan-audit-implementation/cursor_compaction_implementation.md) and [Fable audit](plan-audit-implementation/cursor_compaction_audit.md). Preserve one rollback for changed runtime files; clean only owned relay keys and temporary test state after all test children exit. Do not restore session backups over newer conversation history.

Installed Windows verification completed at22:52 IST on2026-09-14. Both fixes are deployed on both platforms. [Combined hashes/status](release-evidence/compaction-windows-20260914/compatibility-status.json), [manifest-loaded compaction evidence](release-evidence/compaction-windows-20260914/package-verification.json), and [native installed check](release-evidence/compaction-windows-20260914/native-installed.log). Windows rollback: `/home/ubuntu/.pi/agent/backups/compaction-windows-20260914/installed-before` (six adapter files plus backend/main.cjs). The app was reopened; seven owner-session files, auth/settings/models and executable were preserved. Five private native test roots, test agent copies and adapter candidate were removed.
