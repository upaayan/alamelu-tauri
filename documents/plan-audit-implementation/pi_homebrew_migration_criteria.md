# Pi on the Mac: nvm to Homebrew, with Alamelu Pi Tauri fixed in the same change — criteria

Written 2026-11-07 15:50 IST by Claude (Opus 5.5) for the debate-loop skill. Critic: Fable (high), as an agent.
Council record (Claude, Fable, Astra; three rounds): `/private/tmp/pi-homebrew-council/final_plan.md`.

## Sudhir's words

- "I would prefer homebrew pi that updates on its own and remove the current one." (7 Nov 2026)
- "we want ONE pi install." (7 Nov 2026, on Paseo)
- "I do not use 5.6-luna anymore so would be happy to junk this fix if 6-luna works without this" (7 Nov 2026; the test
  showed gpt-6-luna works without it)
- "I like Astra's path. If the changes are small, let us fix both App and pi at the same time." (Path 2: app change
  first, then the switch.)
- "we should NOT use up our disk space by keeping a lot of backup junk."
- On the five decisions: "1 --> Yes" (set `selfUpdateCommand` to `["/opt/homebrew/bin/brew","upgrade","pi-coding-agent"]`
  and change the global rule at `~/.repo-memory/owner-rules.md:210` to match); "2 --> No. we continue as do. The auth on
  the servers are anyway different So, no need to pin versions" ("sync pi" unchanged); "3 --> yes" (Trash the two old app
  backups, `~/.pi/agent/backups` and the old Electron `Alamelu Pi.app`); "4 --> Please find and report to me before
  starting anything" (done: the uncommitted alamelu-tauri edits were reported, then committed and pushed as 874ee52,
  1de3214, bbdc427 on his word); "5 --> use debate-loop; Fable high critic".
- "Please go ahead. Use debate-loop. Make sure that you identify ALL documents that need to be updated and update them
  properly."

## Outcome

One pi on the Mac, installed by Homebrew (`brew install pi-coding-agent`) and updated with `brew upgrade pi-coding-agent`
or a plain `pi update`. Alamelu Pi Tauri rebuilt so it works with that pi. nvm's pi is gone (nvm's Node stays). The Luna
fix and the dead pi-ai patch are out of the app. Every live document says the new way; history records stay as they are.

Known consequence, stated so nobody is surprised: Homebrew does not upgrade pi by itself, and its wrapper sets
`PI_SKIP_VERSION_CHECK=1`, which turns off pi's own "new version available" notice
(`dist/utils/version-check.js:66`). New versions show up in `brew outdated` and `brew upgrade`. No scheduler is added.

## Out of scope (no change)

"sync pi" (`scripts/server_pi_maintenance.sh`, both copies), mock and backup, lazydata, WSL and the Windows app (rebuilt
only when Sudhir next needs it, through CI), sudhir-codex, the quota board, Hermes, gateways, pi-bootstrap, nvm's Node and
the `node`/`npm`/`npx` links in `~/.pi/agent/bin`, the Rust code, the driver's generic child rotation, the app's
connection and context-size checks.

## Plan criteria (yes/no)

Each is checked by the critic reading the plan; evidence is the named plan section.

- P1. The order is Path 2: app change on the working tree, tests, build and local signing; `brew install pi-coding-agent`;
  candidate app tested against Homebrew pi with `PI_GUI_PI_BIN=/opt/homebrew/bin/pi` and an isolated profile while nvm's
  pi stays; then the cutover. (Plan: "Order of work".)
- P2. The app change is only: remove the Luna extension and its wiring; remove the pi-ai patch module, its CLI, startup
  call, detection, collision branch, caller argument and their tests; add one helper so the sign-in bridge finds pi's
  package behind Homebrew's wrapper and under `dist/bundle/cli.js`; update the tests these touch. No Rust change. WSL's
  Luna checker and recovery material stay. (Plan: "App change".)
- P3. Mac settings and links: `selfUpdateCommand` set as Sudhir said, `npmCommand` kept; `~/.pi/agent/bin/pi` re-pointed to
  `/opt/homebrew/bin/pi`; `~/.local/bin/pi` and `~/.local/bin/pi_update_safe` to the Trash at the end. (Plan: "Mac setup".)
- P4. Backups are lean: only the current app, nvm's pi (left in place until the checks pass), the patched Cursor package
  and the three small files (`~/.local/bin/pi`, `~/.pi/agent/bin/pi`, `settings.json`). They go to the Trash when the
  same-day checks pass. The Rust build folder goes after the install. No dated backup folders or archives. (Plan:
  "Backups and clean-up".)
- P5. Cursor adapter patches come out as their own step after the pi move is proven: patched package moved aside,
  `pi install npm:pi-cursor-sdk@0.5.3`, stock hashes checked, then a Cursor turn, a context-variant model id and a
  stale-login recovery tested. (Plan: "Cursor adapter".)
- P6. Rollback is written for each stage and never relies on `pi_update_safe`. (Plan: "Rollback".)
- P7. Every document that needs a change is named with the change, and every document left alone is named with the reason
  (history, or still correct). The list matches the sweep below. (Plan: "Documents".)
- P8. Nothing out of scope is planned. (Whole plan.)

## Implementation criteria (yes/no)

Evidence for each goes in Verification Round N of `pi_homebrew_migration_implementation.md`, with real command output.

- I1. App tests pass: `pnpm run verify:upgrade` and the unit tests the change touches; no reference to the Luna extension
  or the pi-ai patch is left in app code, build config or tests (grep), apart from WSL material and history.
- I2. The new app is built, signed with "Alamelu Pi Local Code Signing", and passes the candidate test against Homebrew
  pi before the cutover.
- I3. Homebrew pi is installed and is the only pi: `/opt/homebrew/bin/pi --version` shows the formula version;
  `type -a pi` in a new login shell finds only Homebrew's; nvm's global `@earendil-works/pi-coding-agent` is uninstalled.
- I4. The Finder-launched app runs Homebrew's pi: the child process path and its Node are recorded from `ps`; providers
  show connected; a chat reply, a model switch, a Cursor turn and a gpt-6-luna turn work.
- I5. `pi update` resolves to `/opt/homebrew/bin/brew upgrade pi-coding-agent` (run once; with no new version it is a
  no-op).
- I6. Cursor adapter is stock 0.5.3 (hashes match the manifest's stock values) and the three Cursor tests pass.
- I7. Documents updated as listed below; the maintenance kit in Application Support refreshed and its manifest matches;
  `owner-rules.md:210` changed, `repomem rules sync` run, the [G-ops] global summary refreshed, `memory_check` OK;
  repo-memory cards mem_98db28bf6d3d and mem_60a5e7594386 rewritten.
- I8. Clean-up: the old app backups, `~/.pi/agent/backups`, the old Electron app, the old Tauri app, `pi_update_safe`,
  `~/.local/bin/pi`, the patched Cursor package copy, the three small file copies and the Rust build folder are in the
  Trash, listed for Sudhir to empty. Nothing permanently deleted; no `rm -rf`.
- I9. Persisted: alamelu-tauri, alamelu (progress.md) and agents-brain commits pushed after the foreign-commit check; then
  lazydata `scripts/server_pi_maintenance.sh` copied from alamelu, `cmp` identical, committed alone on `dev-main` and pushed.

## Documents (from the sweep, 7 Nov 2026)

Update:
- alamelu-tauri `README.md`: remove "The pi-ai patch" section (82-90).
- alamelu-tauri `AGENTS.md:35`: "preserve the external runtime patches" no longer true for the Mac.
- alamelu-tauri `documents/REBUILD-PROTECTION.md`: rewrite the Mac route (Homebrew pi, no Luna, no pi-ai patch, stock
  Cursor adapter, `brew upgrade` then reopen the app).
- alamelu-tauri `documents/PI-UPGRADE-WINDOWS.md`: one line that WSL keeps its re-pointed launcher and Luna checker; the
  Mac no longer needs them.
- alamelu-tauri `maintenance/pi-cursor-sdk/manifest.json`: the Mac's 0.5.3 state after the patches come out.
- alamelu-tauri `apps/desktop/electron/app-store.ts:138`: the `piBin` comment (or field) that exists only for the patch.
- Maintenance kit `~/Library/Application Support/Alamelu Pi/maintenance-kit`: refresh the two documents, the Cursor
  manifest and `kit-manifest.json` hashes.
- `~/.pi/agent/settings.json`: add `selfUpdateCommand`.
- `~/.repo-memory/owner-rules.md:210`, then `repomem rules sync` (regenerates `~/.claude/CLAUDE.md` and the other copies),
  the [G-ops] global summary, `memory_check`.
- repo-memory cards mem_98db28bf6d3d ("Routine Mac Pi updates") and mem_60a5e7594386 ("Alamelu Pi Tauri rebuild/Pi update").
- agents-brain `access/operating-facts.md:34`.
- alamelu `documents/progress.md`: a new dated entry.

Retire (Trash): `~/.local/bin/pi_update_safe`, `~/.local/bin/pi`.

No change, with the reason:
- History records: alamelu-tauri `documents/plan-audit-implementation/*` (Luna, pi-ai, pi_update_safe, upgrades),
  alamelu `documents/plan-audit-implementation/*`, alamelu `TODO-13Sep26.md`, older alamelu `progress.md` entries, lazydata
  `documents/plan-audit-implementation/*` (guarded repo, history).
- Still correct: alamelu-tauri `apps/desktop/AGENTS.md`, `apps/desktop/README.md` (point at REBUILD-PROTECTION.md);
  `apps/desktop/tests/helpers/electron-app.ts` (already lists `/opt/homebrew/bin/pi`); `packages/pi-rpc-driver/test/*`
  (path logic and generic rotation stay); `scripts/check-pi-app-extension.py`, `scripts/upgrade-wiring.test.mjs` (WSL);
  `.github/workflows/upgrade-compatibility.yml` ("tainted Luna" is a driver test name); `~/.pi/agent/extensions/package-lock.json`
  (no install path); the alamelu-tauri `.agent-memory/cards` (no mention).

## Owner changes

- 2026-11-07 16:02 IST. Backups: "Yes but only AFTER the new one is proven. The prudent path is: Backup existing working
  version / Install and verify the new one / If it works, remove backup / Else, restore backup". So each item being
  replaced is first moved aside to one holding folder (no copies, no dated folders), the new one is installed and
  verified, and only then the held item goes to the Trash; on a failure the held item is put back. P4 and I8 updated.
- 2026-11-07 16:02 IST. "sync pi": Sudhir changed "sync pi stays exactly as it is" to "bundle the brew upgrade as part of
  sync pi and problem solved." `scripts/server_pi_maintenance.sh` (alamelu copy) gets a first Mac step,
  `brew upgrade pi-coding-agent`. Claude's recommendation (a) was given and not overruled, so the step runs with
  Homebrew's immediate clean-up held back (`HOMEBREW_NO_INSTALL_CLEANUP=1` for that one command) and prints "reopen
  Alamelu Pi" when the version changed, because the open app holds pi's versioned folder (`lib.rs:1107` canonicalizes
  `/opt/homebrew/bin/pi` to `.../Cellar/pi-coding-agent/<version>/...`). The lazydata copy is not touched without his
  word (guarded repo). The servers' part of "sync pi" stays as it is. New criteria P9 and I10.
- 2026-11-07 16:02 IST. Cursor: "If cursor fails during my testing, I will ask my sweetheart ( you ) to fix that
  separately." The stock adapter goes in and is tested as in P5/I6; a failure is reported (and the held patched copy put
  back, per the prudent path), and any fix is a separate task, not part of this change.
- 2026-11-07 16:12 IST. lazydata copy of "sync pi": "That needs to be byte identical to this repo's version. So, after you
  finish and verify and commit and push here, copy the sync pi script to lazydata and commit and push there as well."
  So after the alamelu commit and push, `~/playground/lazydata/scripts/server_pi_maintenance.sh` (branch `dev-main`) is
  replaced with the alamelu file, `cmp` shows them identical, and lazydata gets its own commit and push of that one file.
  P9, I9 and the documents list updated.
- 2026-11-07 16:51 IST. Cursor adapter after the switch: told that stock 0.5.3 drops 47 unqualified Cursor ids (only the
  `@200k/@300k/@1m` forms remain; one thread uses `claude-opus-5-5`), Sudhir answered "2 is fine" and "I checked cursor
  opus 5.5@1M and gpt luna 5.6 and 6 and everything is fine." The stock adapter stays; the patched copy goes to the
  Trash with the hold folder. His own turns in the app are the I4 in-app evidence ("So, what else do we need?").

Added criteria:
- P9. "sync pi" (alamelu copy) gets the Mac `brew upgrade pi-coding-agent` step first, with immediate clean-up held back,
  a "reopen Alamelu Pi" line when the version changed, a dry-run line, and a summary line; the server part is unchanged;
  the lazydata copy is made byte-identical after the alamelu push (owner change 16:12). (Plan: "sync pi".)
- I10. `bash -n` passes; `bash scripts/server_pi_maintenance.sh --dry-run < /dev/null` shows the new Mac step and its
  summary line; the same brew command runs once by hand. No real "sync pi" run in this work (it would also upgrade mock
  and backup, which is Sudhir's call when he says "sync pi").

Changed criteria:
- P4 now reads: each item to be replaced is moved (not copied) to one holding folder before the new one goes in; the held
  items go to the Trash only after the new one is proven; on a failure they are put back.
- I8 now reads: after the checks pass, the held items, the old app backups, `~/.pi/agent/backups`, the old Electron app,
  `pi_update_safe`, `~/.local/bin/pi` and the Rust build folder are in the Trash, listed for Sudhir to empty; nothing
  permanently deleted; no `rm -rf`.
- P5 and I6 now read: the stock adapter is installed and its stock hashes checked, then one Cursor turn and one
  context-variant model id turn are tested; stale-login recovery is not staged (it needs a broken login) and is left to
  Sudhir's use ("I am not doing a deep dive on the Cursor changes").
- Documents: add alamelu `scripts/server_pi_maintenance.sh` (update) and alamelu `AGENTS.md` "sync pi" paragraph (update,
  it describes what the script does). `maintenance/pi-cursor-sdk/manifest.json` moves to "no change": it describes adapter
  versions, not which machine runs which, and the stock 0.5.3 hashes are already in it.

## Agreement

Sudhir, 2026-11-07 16:02 IST: "Go ahead with the build using debate-loop as discussed earlier." Criteria agreed with the
owner changes above.
