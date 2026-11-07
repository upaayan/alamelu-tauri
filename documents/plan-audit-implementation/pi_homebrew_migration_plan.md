# Plan: Pi on the Mac from nvm to Homebrew, with Alamelu Pi Tauri fixed in the same change

Written 2026-11-07 16:05 IST by Claude (Opus 5.5), builder. Critic: Fable (high), as an agent.
Criteria (agreed by Sudhir 16:02 IST, with his changes): `pi_homebrew_migration_criteria.md`.
Council record: `/private/tmp/pi-homebrew-council/` (`final_plan.md` and the round files).

## Outcome and scope

One pi on the Mac, from Homebrew's `pi-coding-agent` formula, updated by "sync pi" (which now runs
`brew upgrade pi-coding-agent` first), by `brew upgrade pi-coding-agent`, or by a plain `pi update`. Alamelu Pi Tauri is
rebuilt so it works with that pi. nvm's pi goes; nvm's Node stays. The Luna fix and the dead pi-ai patch leave the app.
The Cursor adapter goes back to stock 0.5.3. Every live document says the new way.

Out of scope: see the criteria. In short: the servers' part of "sync pi", mock and backup,
WSL and the Windows app, sudhir-codex, quota board, Hermes, gateways, pi-bootstrap, nvm's Node, Rust code, driver rotation,
the app's connection and context-size checks, the `gpt-5.6-luna` login probes in "sync pi".

## Facts this plan rests on (checked 7 Nov 2026)

- Mac pi today: 1.5.0 under nvm Node v24.16.0, package
  `~/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent` (152 MB); nvm's `bin/pi` re-pointed to
  `dist/cli.js`. Homebrew 7.0.12; formula `pi-coding-agent` 1.5.0, not installed. `HOMEBREW_NO_INSTALL_CLEANUP` unset.
- The formula installs the npm package into `libexec` and writes `/opt/homebrew/bin/pi` -> `../Cellar/pi-coding-agent/<v>/bin/pi`,
  a small bash wrapper that sets `PI_SKIP_VERSION_CHECK=1` and runs `libexec/bin/pi` (-> `dist/bundle/cli.js`).
- The Rust shell finds pi in this order (`lib.rs:1062-1118`): `PI_GUI_PI_BIN`, PATH, `~/.nvm/versions/node/*/bin/pi`,
  `~/.local/bin/pi`, `/opt/homebrew/bin/pi`, ... and canonicalizes the first hit (`lib.rs:1107`). So the Finder-launched app
  picks Homebrew's pi only once nvm's `bin/pi` and `~/.local/bin/pi` are gone, and it then holds the versioned Cellar path.
- The RPC driver runs that path directly unless it contains `/lib/node_modules/` (`rpc-client.ts`, `resolvePiRpcSpawnCommand`),
  so the wrapper runs as is. The backend's PATH starts with the resolved Node's folder (`lib.rs:732-739`).
- Two things break under Homebrew's pi today:
  1. The sign-in bridge accepts only `.../dist/cli.js` (`external-pi-auth-bridge.ts:194-205`); with the wrapper it throws,
     the supervisor swallows it (`external-pi-runtime-supervisor.ts:279-286`) and every provider shows "not connected".
  2. The Luna extension (`resources/alpi-luna-websocket-recovery.ts`) calls `require.resolve` on pi's package and fails under
     the bundled entry, so pi exits at start. gpt-6-luna works without it (tested 7 Nov).
- The pi-ai patch is dead since pi 0.82.1: 1.5.0's `openai-completions.js` carries the upstream fix signature. Its detection
  (`model-switch-preflight.ts:180-192`) also computes pi-ai's path from the old layout, so under Homebrew it would wrongly
  report "not patched" and turn the collision warning into a block.
- `brew upgrade` runs `brew cleanup` on the upgraded formula unless `HOMEBREW_NO_INSTALL_CLEANUP` is set (`man brew`), which
  deletes the old Cellar folder that an open app or a running terminal pi still uses.

## Order of work (Path 2)

1. App change (below) in the alamelu-tauri working tree on `main` (clean at bbdc427 apart from these plan files).
2. Tests: `pnpm run verify:upgrade`; the unit tests the change touches; `pnpm --filter @alamelu-pi/desktop run typecheck`
   (`tsc` on both tsconfigs; it catches any leftover `piBin` or patch reference).
3. Build and sign: `pnpm run package:tauri` (its `beforeBuildCommand` reaches the same gate), then
   `pnpm --filter @alamelu-pi/desktop run sign:tauri` (local identity "Alamelu Pi Local Code Signing", from AWS secret
   `alamelu/pi-codesign`, never printed). First cold Rust build expected 3-6 minutes; whole step about 15 minutes. I tell
   Sudhir before it starts.
4. `brew install pi-coding-agent`. Record `/opt/homebrew/bin/pi --version`, the wrapper's text (no secrets in it), the
   `libexec/bin/pi` target, the shebang of `dist/bundle/cli.js`, and that `dist/index.js` exists in the Homebrew package.
5. Candidate test while nvm's pi stays and the old app stays installed and closed. Run the packaged smoke (temp state
   folder, Finder-like PATH) twice on the new build: first with `PI_GUI_PI_BIN` set to nvm's
   `.../pi-coding-agent/dist/cli.js` (the layout the bridge knows today: the baseline), then with
   `PI_GUI_PI_BIN=/opt/homebrew/bin/pi`. Command: `PI_GUI_PI_BIN=<path> pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged`.
   Pass = both runs pass and their closing lines `Packaged Tauri smoke: OK (N providers, ...)` show the same N, well above
   the 17-18 a broken bridge gives (47-49 seen before; alamelu `progress.md:203`, `REBUILD-PROTECTION.md`). The smoke's
   own check (`providerCount > 10`) passes even with the bridge broken, so the N comparison is the evidence. On a mismatch,
   run the packaged executable directly with the same environment and read its stderr for "unsupported layout" or the
   supervisor's auth warning. A failure stops here; nothing on the Mac has changed except the new formula.
6. Cutover (the prudent path, below). Then the checks I3-I5.
7. Cursor adapter to stock (below). Then its checks.
8. "sync pi" step, documents, cards, rules (below). (`selfUpdateCommand` is set in Cutover step 3.)
9. Implementation review by Fable; repairs; PASS; decision-model check.
10. Commit and push (alamelu-tauri, alamelu with the mock fast-forward, agents-brain; then the lazydata copy). Only then
    the clean-up: the hold folder and the approved old items to the Trash; list for Sudhir.

## App change (alamelu-tauri)

Remove the Luna extension and its wiring:
- delete `apps/desktop/resources/alpi-luna-websocket-recovery.ts` and `apps/desktop/tests/unit/alpi-luna-websocket-recovery.test.mjs`;
- `apps/desktop/electron/main.ts`: delete `resolveAlpiLunaWebSocketRecoveryExtensionPath` (375-383), the
  `alpiLunaWebSocketRecoveryExtensionPath` constant (834-837) and its `extensionPaths` spread (857);
- `apps/desktop/src-tauri/tauri.conf.json:46` resource entry; `apps/desktop/scripts/build-tauri-backend.mjs:51-52` copy pair;
  `apps/desktop/electron-builder.alpi.yml:19-20` extraResources pair; the matching expectation in
  `apps/desktop/tests/unit/alpi-packaging.test.mjs:20`.
Remove the pi-ai patch:
- delete `apps/desktop/electron/pi-ai-patch.mjs`, `apps/desktop/scripts/patch-global-pi-ai.mjs`, `apps/desktop/tests/unit/pi-ai-patch.test.mjs`;
- `main.ts`: the import (35), `ensurePiAiPatched` and its comment (676-723), the call and its comment (827-830);
- `model-switch-preflight.ts`: the `piPatchApplied` parameter (41), the collision branch (61-64), the legacy-id scanner and
  `hasCollidingToolCallIds` if nothing else uses them, `PATCH_MARKER`, `UPSTREAM_FIX_SIGNATURE`, `isPiPatchApplied`
  (175-192); keep the connection and context-size checks unchanged;
- `app-store-composer.ts`: the import (25) and the argument (512); the store's `piBin` if nothing else reads it:
  `app-store.ts:138` (field and comment), `app-store-internals.ts:39`, and the `piBin` passed into the store at
  `main.ts:875` (the driver's own `piBin` at `main.ts:658` stays); if something else reads it, only reword the comment;
- `tests/unit/model-switch-preflight.test.mjs`: drop the collision and patch-detection cases and the third argument.
Fix the sign-in bridge for Homebrew's layout (`external-pi-auth-bridge.ts`):
- `externalPiAuthModulePaths(resolvedPiBin)` finds pi's package root for three layouts and returns the same three paths
  from it (`dist/index.js`, legacy `dist/modes/interactive/interactive-mode.js`):
  1. `<root>/dist/cli.js` (nvm today; tests keep it);
  2. `<root>/dist/bundle/cli.js` (plain npm `bin`);
  3. `<keg>/bin/pi` with `<keg>/libexec/lib/node_modules/@earendil-works/pi-coding-agent/package.json` present and naming
     `@earendil-works/pi-coding-agent` (Homebrew wrapper).
  Anything else throws the same "unsupported layout" error. About 30 lines; synchronous `existsSync`/`readFileSync`.
- `tests/unit/external-pi-auth-bridge.test.mjs`: add cases for layouts 2 and 3 (temp folders) and one unsupported path.
Unchanged: Rust code, `process-path.ts`, the driver and its tests (the "Luna" names there are generic rotation tests),
`scripts/check-pi-app-extension.py` and `scripts/upgrade-wiring.test.mjs` (WSL), `apps/desktop/tests/helpers/electron-app.ts`.
After the change, `grep -rn -i -E "luna-websocket|alpi-luna|pi-ai-patch|patch-global-pi-ai|isPiPatchApplied|piPatchApplied"`
over `apps/desktop` (excluding `node_modules` and history docs) returns nothing.

## Mac setup

- `~/.pi/agent/settings.json`: add `"selfUpdateCommand": ["/opt/homebrew/bin/brew","upgrade","pi-coding-agent"]`; keep
  `npmCommand` (pi uses it for `pi install` packages). Edited with a JSON load/dump that keeps every other key; values are
  not printed.
- `~/.pi/agent/bin/pi`: re-point to `/opt/homebrew/bin/pi`. Its `node`, `npm`, `npx` links stay.
- `~/.local/bin/pi` (nvm-only launcher) and `~/.local/bin/pi_update_safe`: moved to the hold folder at cutover, then Trash.
- Before cutover, re-check that nothing else names the old paths: `crontab -l`, `~/Library/LaunchAgents`, shell dotfiles,
  `grep` for `.local/bin/pi\b` and `nvm/versions/node/v24.16.0/bin/pi` in alamelu, alamelu-tauri, agents-brain scripts.

## Cutover — the prudent path

Sudhir's rule: back up the working version, install and verify the new one, remove the backup only if it works, else
restore. The backup is a move, not a copy, into one folder: `~/pi-homebrew-hold/` (no dates, no archives).
1. Close Alamelu Pi Tauri (ask Sudhir; never kill his app). Record the open pi processes (`ps`), so none is cut mid-turn.
2. Move into the hold folder: `/Applications/Alamelu Pi Tauri.app` (76 MB); nvm's pi package folder (152 MB) and nvm's
   `bin/pi` link; `~/.local/bin/pi`; `~/.local/bin/pi_update_safe`; the old `~/.pi/agent/bin/pi` link. Copy
   `settings.json` there (it is edited in place).
3. Install the new signed app into `/Applications`; re-point `~/.pi/agent/bin/pi`; add `selfUpdateCommand`.
4. Verify (I3-I5): new login shell `type -a pi` shows only `/opt/homebrew/bin/pi`; `pi --version`; open the app from Finder
   (Sudhir is told first; the window appears); record the RPC child's command line and its Node from `ps`; providers
   connected; a chat reply, a model switch, a gpt-6-luna turn, a Cursor turn (patched adapter still in place, so a later
   Cursor failure points at the adapter alone); `pi update` once (expected: brew says already installed).
5. Pass: the hold folder stays until the Cursor step passes too, then goes to the Trash. Fail: put every held item back to
   its place (app, nvm package and link, launcher, link, settings copy) and report; Homebrew's pi can stay installed.

## Cursor adapter

Sudhir: "not doing a deep dive"; a Cursor failure in his own testing is fixed separately.
1. Move `~/.pi/agent/npm/node_modules/pi-cursor-sdk` (31 MB, patched) into the hold folder.
2. `pi install npm:pi-cursor-sdk@0.5.3`.
3. `python3 scripts/check-cursor-compaction.py --package ~/.pi/agent/npm/node_modules/pi-cursor-sdk --baseline` confirms
   the stock 0.5.3 hashes (the manifest's "before" values).
4. One Cursor turn and one turn on a context-variant model id, in a private test session (never Sudhir's threads).
   Stale-login recovery is not staged (it needs a broken login); Sudhir's use covers it.
5. Fail: put the patched copy back from the hold folder and report; the fix is a separate task.

## "sync pi" (alamelu `scripts/server_pi_maintenance.sh`)

One new block in the outer run, before the Mac preflight (about 20 lines):
- header `=== PI upgrade (Mac, Homebrew) ===`;
- dry run: summary line `Mac brew: would run brew upgrade pi-coding-agent`;
- real run: version before (`pi --version`), then `HOMEBREW_NO_INSTALL_CLEANUP=1 /opt/homebrew/bin/brew upgrade pi-coding-agent`
  inside an `if output=$(...)` test like the login loop (the script runs under `set -Eeuo pipefail`, so a bare call would
  abort the whole run), output captured and its last lines shown only on failure; version after; summary line either
  `brew: pi 1.5.0 -> 1.5.1 (reopen Alamelu Pi to use it)` or `brew: pi 1.5.0, already up to date`, or
  `brew: FAIL (...)` with `overall_status=1`; the preflight and the servers still run after a failure (as the script does
  for a failed Mac login);
- if `/opt/homebrew/bin/brew` is missing: summary `brew: skipped (Homebrew not found)`, not a failure.
The servers' part is unchanged (they still install `@latest` with their own npm; the no-downgrade guard compares with the
Mac's `pi --version`). The first real "sync pi" after the move is Sudhir's, when he asks; it will also move mock and backup
from 1.1.0 to the latest pi, as "sync pi" would today. Not run as part of this work: only `bash -n`, `--dry-run`, and the
same brew command by hand once.
Old Cellar versions are removed by Homebrew's own periodic clean-up (every 30 days, on a later brew command).
lazydata copy (Sudhir, 16:12: "That needs to be byte identical to this repo's version"): after the alamelu commit and
push, copy the alamelu file over `~/playground/lazydata/scripts/server_pi_maintenance.sh` (branch `dev-main`; identical
today at 76b15747), check with `cmp`, commit that one file and push.

## Documents

Update:
- alamelu-tauri `README.md`: delete "The pi-ai patch" section (82-90).
- alamelu-tauri `AGENTS.md:35`: replace "preserve the external runtime patches" with: the Mac runs stock Homebrew pi and the
  stock Cursor adapter; WSL keeps its launcher fix, Luna checker and adapter patch.
- alamelu-tauri `documents/REBUILD-PROTECTION.md`: top line (last verified Mac release 2026-11-07, Homebrew pi 1.5.0 + stock
  0.5.3); the "What must survive" rows for `npm install -g of Pi` and `pi update / reinstall` (Mac: nothing to re-point,
  reopen the app after an upgrade; WSL rows unchanged); the `verify:upgrade` test count; "Adapter recovery": the Mac runs
  stock 0.5.3 since 2026-11-07, `0.5.3/mac-local-fixes.patch` kept as the recovery source; "Installed runtime release
  gates" step 1: the Luna check is WSL only; a new section "Mac release 2026-11-07 — Homebrew pi 1.5.0, stock adapter, no
  Luna extension, no pi-ai patch" with the update route ("sync pi", or `brew upgrade pi-coding-agent` / `pi update`; reopen
  the app); "Connection, copies and cleanup": the Mac's `~/.pi/agent/backups` evidence copies went to the Trash on
  2026-11-07 (Sudhir), WSL keeps its copy.
- alamelu-tauri `documents/PI-UPGRADE-WINDOWS.md`: one line at the top: since 2026-11-07 the Mac runs Homebrew pi with no
  launcher re-point and no Luna extension; the launcher and Luna material below is WSL only (its re-pointed launcher is now
  unnecessary for the Windows app built from this source, but harmless; leave it).
- Maintenance kit `~/Library/Application Support/Alamelu Pi/maintenance-kit`: copy every file listed in its
  `kit-manifest.json` from the repository and rewrite the hashes; report any listed file the repository no longer has.
- alamelu `scripts/server_pi_maintenance.sh` (above) and alamelu `AGENTS.md` "sync pi" paragraph (the Mac brew step, the
  held-back clean-up, "reopen Alamelu Pi"); then lazydata `scripts/server_pi_maintenance.sh`, byte-identical copy.
- `~/.repo-memory/owner-rules.md:210` becomes: "**Pi updates on the Mac:** 'sync pi' (it runs `brew upgrade pi-coding-agent`
  first, then the servers), or `brew upgrade pi-coding-agent` / `pi update` for the Mac alone; reopen Alamelu Pi
  afterwards." Then `repomem rules sync`, refresh the [G-ops] global summary card (mem_5768716fdec7, which names
  `pi_update_safe`), `~/.local/bin/memory_check`.
- repo-memory cards: rewrite mem_98db28bf6d3d (routine Mac Pi updates) and mem_60a5e7594386 (Tauri rebuild/Pi update) to
  the new facts; retract the old texts the usual way.
- agents-brain `access/operating-facts.md:34`: same wording as the global rule.
- alamelu `documents/progress.md`: a dated entry for this change.

Retire (hold folder, then Trash): `~/.local/bin/pi_update_safe`, `~/.local/bin/pi`.

No change, with the reason:
- History: alamelu-tauri and alamelu `documents/plan-audit-implementation/*` older records, alamelu `TODO-13Sep26.md`, older
  `progress.md` entries, lazydata `documents/plan-audit-implementation/*` (guarded repo), the dated sections of
  `REBUILD-PROTECTION.md` and `PI-UPGRADE-WINDOWS.md`.
- Still correct: alamelu-tauri `apps/desktop/AGENTS.md`, `apps/desktop/README.md`; `maintenance/pi-cursor-sdk/manifest.json`
  (it describes versions, not which machine runs which; stock hashes are already there);
  `apps/desktop/tests/helpers/electron-app.ts` (already lists `/opt/homebrew/bin/pi`); `packages/pi-rpc-driver/test/*`;
  `scripts/check-pi-app-extension.py`, `scripts/upgrade-wiring.test.mjs`; `.github/workflows/upgrade-compatibility.yml`;
  `~/.pi/agent/extensions/package-lock.json`; alamelu-tauri `.agent-memory/cards`.

## Backups and clean-up

During the move the only backups are the items moved into `~/pi-homebrew-hold/`: the old app (76 MB), nvm's pi (152 MB) and
its link, the patched Cursor adapter (31 MB), `~/.local/bin/pi`, the old `~/.pi/agent/bin/pi` link, a `settings.json` copy,
`pi_update_safe`. No other copies. When the cutover and Cursor checks pass, the hold folder goes to the Trash, with the
approved old items: `/Applications/Alamelu Pi Tauri.app.backup-20260901-001156` (77 MB),
`/Applications/Alamelu Pi.app.before-compaction-queue-20260913-013815` (293 MB), `~/.pi/agent/backups` (340 MB),
`/Applications/Alamelu Pi.app` (Electron, 293 MB), the app's leftover `pi-patch-state.json`, and the Rust build folder
`apps/desktop/src-tauri/target` (size reported after the build). Deletions are moves to the Trash only; no `rm -rf`. Sudhir
empties the Trash.

## Rollback

- Before cutover: nothing on the Mac changed except the new formula; `brew uninstall pi-coding-agent` if Sudhir wants it gone.
- During the checks: put every held item back from `~/pi-homebrew-hold/` (the Cursor copy alone if only Cursor fails).
- After the hold folder is in the Trash: Finder's "Put Back" until Sudhir empties it. After that: `brew reinstall
  pi-coding-agent` fixes a broken Homebrew pi; the old app can be rebuilt from Git. `pi_update_safe` is not used.

## Verification (evidence goes to `pi_homebrew_migration_implementation.md`, Verification Round N)

The implementation PASS covers I1-I7 and I10. I8 and I9 can only exist after Order step 10 (commit, push, then the Trash), so
their evidence is appended to the implementation record after that step, as the 11 Oct record did.

- I1: `pnpm run verify:upgrade`; `node --test` on the changed unit tests; the grep above.
- I2: `package:tauri`, `sign:tauri`, `codesign -dv` on the app (identity name only), the two candidate smoke runs and
  their closing lines (same N providers).
- I3-I5: the cutover checks above, with the `ps` lines.
- I6: the Cursor checks above.
- I7: `git diff --stat` per repo; the kit hash check; `repomem rules sync`; `memory_check` output; the new card ids.
- I8: `ls ~/.Trash` names for the moved items; `ls ~/pi-homebrew-hold` gone.
- I9: `git fetch && git log --oneline origin/<upstream>..HEAD` before each push (`main` for alamelu-tauri, alamelu and
  agents-brain; `dev-main` for lazydata); push results; mock `git pull --ff-only` for alamelu (its deploy sequence) with
  matching `git rev-parse HEAD^{tree}`; the `cmp` output for the two "sync pi" copies.
- I10: `bash -n scripts/server_pi_maintenance.sh`; `bash scripts/server_pi_maintenance.sh --dry-run < /dev/null` (it also
  dry-runs the servers through SSH or the relay, changing nothing); the brew command once by hand.

## Commits

- alamelu-tauri: app change, tests, docs, these records; one commit after the implementation PASS.
- alamelu: `scripts/server_pi_maintenance.sh`, `AGENTS.md`, `documents/progress.md`; commit, push, fast-forward mock.
- agents-brain: `access/operating-facts.md`.
- lazydata (`dev-main`): `scripts/server_pi_maintenance.sh` only, copied after the alamelu push; `cmp` identical; push after
  the foreign-commit check.
- Only my own files (`git add <path>`); attribution line as required.
