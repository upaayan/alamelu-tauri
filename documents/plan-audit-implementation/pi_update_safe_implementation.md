# pi_update_safe — implementation record

Date: 2026-10-11. Builder: Claude (Opus 5.5). Review: one simple implementation review by Claude Fable (effort high).

## Owner brief

1. After the Pi 1.1.0 upgrade the owner asked whether a future Pi update needs the full route or just `npm`. Answer given:
   routine updates need only a short route — install with nvm's Node 24 npm (the plain `npm` in his terminal is Hermes's
   Node 26 npm with prefix `~/.local`), re-point nvm `bin/pi` to `dist/cli.js`, run the quick checks, then "sync pi"; never
   `pi update`; the full plan-and-review route only when the Cursor adapter version changes, Pi's release notes show breaking
   provider/extension/compaction/RPC changes, or a check fails.
2. Owner: "write the pi_update_safe script and put it in ~/.local/bin. Make it executable"
3. Owner: "yes just a simple review. just in case because you and Fable will no longer be involved if both PASS" — after a
   PASS the owner runs the script himself.

## The script

`/Users/sudhirjha/.local/bin/pi_update_safe` (mode 755, not in any repository; SHA-256 at review time
`06ed79d20a08203c94b9e2a43029e7c77ab140de476b97107582d91fa14b676c`, 272 lines).

- `pi_update_safe [VERSION]` (default `latest`), `--dry-run [VERSION]` (prints what would happen; no change),
  `--check-only` (runs the checks on the installed Pi; no change), `--help`.
- Real update, in order: Mac only; resolves nvm's default Node (same logic as the `~/.local/bin/pi` wrapper); resolves the
  target with `npm view`; if already current, only fixes a wrong launcher and exits; refuses while Alamelu Pi is open; waits
  up to 3 minutes for other Pi processes (e.g. the LLM Costs board's 20-minute login probe); counts Cursor models with the
  old Pi; saves a rollback tar of the package directory to `~/.pi/agent/backups/pi-update-safe-<timestamp>/`; installs with
  `node npm-cli.js install -g --prefix <nvm Node dir>`; re-points `bin/pi` to `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`;
  checks version, launcher, the installed app's Luna extension (`check-pi-app-extension.py` through `~/.local/bin/pi`), the
  Cursor adapter patch (`check-cursor-compaction.py --package ~/.pi/agent/npm/node_modules/pi-cursor-sdk`), the Cursor A/B
  test (system-prompt code word + Pi `read` tool, `composer-2.5`, `--no-session`, stdin closed; it removes its temp folder
  and the SDK's matching `~/.cursor/projects` folder) and the Cursor model list (relay IDs present, count not lower).
- Any failed check or failed npm install → rollback: move the new package aside (kept for inspection), extract the tar,
  restore the old launcher target, re-check version + Luna, tell the owner not to run "sync pi", exit 1.
- All pass → delete this run's rollback tar, keep the log, print the next steps (reopen Alamelu Pi, "sync pi"). This follows
  the owner's ruling for the sync scripts ("sync pi should delete backups after successful verification", 10 Oct), applied
  here by analogy; going back stays possible with `pi_update_safe <old version>` (npm keeps every published version).
- The kit checkers come from `~/Library/Application Support/Alamelu Pi/maintenance-kit/scripts` (fallback:
  `~/playground/alamelu-tauri/scripts`). Overrides used only for testing: `PI_UPDATE_SAFE_NODE_DIR`, `PI_UPDATE_SAFE_PI`,
  `PI_CODING_AGENT_DIR` (with a Node-dir override the app/idle guards are skipped — the app does not use that Node).
- Never runs `pi update`, never touches the Cursor adapter, never syncs servers itself.

## Verification Round 1 (builder)

- `bash -n` OK; `shellcheck -s bash` clean (one SC2015 note fixed by using an `if`).
- Live, read-only: `--help`; `--dry-run` (1.1.0 current, "Nothing to do", reports the open app and the app's Pi child);
  `--dry-run 1.0.4` (describes the real run); plain run → "already the latest; nothing to do".
- Live `--check-only` (app open; no install): version, launcher, Luna, adapter, Cursor test (`tools=read`, `CODE=ZEBRA-4471`,
  correct file), 294 Cursor models with relay IDs — all PASS in 64 s; no `/tmp/pi-update-safe-ab.*` or
  `~/.cursor/projects/*pi-update-safe*` left (184 project folders before and after).
- Live guard: `pi_update_safe 1.0.4` with Alamelu Pi open → "Alamelu Pi is open. Quit it first …", exit 1, no backup folder
  created, Pi still 1.1.0. `--bogus` → clear error, exit 1.
- Sandbox (`/tmp/pus-sandbox.*`: Node dir with symlinked node/npm, Pi installed there, private agent dir with a Cursor-only
  `auth.json`, a copy of the patched adapter and an absolute `pi-web-access`; `PI_UPDATE_SAFE_NODE_DIR`, `PI_UPDATE_SAFE_PI`,
  `PI_CODING_AGENT_DIR`, `PI_CURSOR_SDK_STATE_ROOT` set):
  - Test 1, real update 1.0.4 → 1.1.0: rollback copy saved, installed, re-pointed, all six checks PASS, rollback tar
    removed, log kept, exit 0 (64 s).
  - Test 2, real install 1.1.0 → 1.0.4 with `run_checks` overridden to fail (script sourced): new install moved to
    `failed-pi-1.0.4`, 1.1.0 restored from the tar, launcher restored, version + Luna re-check pass, exit 1 with the
    "do not sync" message.
  - Test 3, `--check-only` on the restored sandbox Pi: all PASS.
  - Sandbox then emptied of its credential copy and moved to the Trash; no SDK project folders left.

## Response to Implementation Audit Round 1 (builder)

Fable PASS (0 high, 0 medium, 3 low). All three lows applied as message-only edits (no behaviour change; no further review
round, per the low-fix precedent):
- P1-01: `--help` now prints exactly the comment header (`awk` stops at the first non-comment line).
- P1-02: the header says where an interrupted run's previous Pi is saved; the "Installing" line now prints the exact `tar`
  and `ln` commands that put it back; a re-run that finds no Pi package points to the newest
  `pi-update-safe-*/pi-coding-agent-*.tgz` and the same two commands. The `trap` variant was not added (owner decision; not
  requested).
- P1-03: the `npm view` failure message now adds "(or npm could not reach the registry)".
- Note on deleting the rollback tar: the record now quotes the owner's actual ruling (made for the sync scripts) and says it
  is applied by analogy; REBUILD-PROTECTION's "one viable rollback" is met by reinstalling the old version from npm.

Re-verification: `bash -n` OK, `shellcheck` clean; `--help` prints the 18-line header only; `--dry-run 99.99.99` → the new
message, exit 1; a fresh sandbox run 1.0.4 → 1.1.0 printed the restore commands before installing, passed all six checks,
exit 0; sandbox (Cursor-only auth copy deleted first) moved to the Trash; no `~/.cursor/projects/*pi-update-safe*` left.
Script now: SHA-256 `43f4196071d8b6c9600699f9e57319964ab52c934cf607a06d353564d2c34d8b`, 278 lines, mode 755.
