# Up-arrow message recall in the chat box: implementation

Builder: Claude (Opus 5.5). Critic: Opus 5.5 at high effort, as an agent.

Records: criteria [composer_history_criteria.md](composer_history_criteria.md) (agreed 18:41 IST; owner change 18:58), plan [composer_history_plan.md](composer_history_plan.md) (revision 3, PASS in round 2), audit [composer_history_audit.md](composer_history_audit.md).

## What changed

App code, in the renderer only:
- `apps/desktop/src/composer-history.ts` (new, 58 lines). Two pure functions:
  - `composerHistoryEntries(transcript)` returns the user's own non-blank messages, oldest first.
  - `stepComposerHistory(...)` does the terminal-style step, or returns `undefined` to leave the key alone.

  It imports types only. The state is `{ sessionKey, index }`. The plan's third field, the recalled `text`, was dropped by `simplify`: it always equals `history[index]`. "Recalling" therefore means the same thread, and the box still holds `history[index]`.
- `apps/desktop/src/App.tsx` (+25):
  - the import;
  - `composerHistoryRef`;
  - `composerHistoryRef.current = undefined` in the `[selectedSessionKey]` layout effect (P1-1);
  - a step in `handleComposerKeyDown`, after the clipboard, mention and slash handlers. It acts only on plain ArrowUp/ArrowDown (no Shift, Alt, Cmd or Ctrl), not during IME composition, and only with a selected thread. It calls `preventDefault()` and `setComposerDraft` only when the helper returns a step.

Tests:
- `tests/unit/composer-helpers.test.mjs` (+55): two tests covering the history list and every stepping rule in the plan's list.
- `tests/helpers/electron-app.ts` (+46/−8):
  - `seedComposerHistorySessionFixture`, a thread with "First question" and "Second question";
  - `registerSeededSessionInCatalog`, shared with `seedCompactedModelSwitchSessionFixture` after `simplify` (same steps, now in one place);
  - `selectSessionAndWaitForDraft`, next to `selectSession`.
- `tests/core/composer-controls.spec.ts` (+105/−1):
  - the new test, "Up and Down in an empty chat box recall this thread's earlier messages";
  - the two P9 fixes (empty-bar double-click with a hidden-window stand-in; wait for the selection before typing).

  The new test expands its workspace in the sidebar first, because workspaces start collapsed (`hooks/use-workspace-menu.tsx:151-153`: `collapsedWorkspaces[id] ?? true`). That is why the fixture's thread row was not clickable on the first run.

No change in `src-tauri/`, `electron/`, `packages/`, scripts or pi config.

## Verification Round 1 (2026-11-07, 18:46–19:20 IST)

All end-to-end runs used `PI_GUI_PI_BIN=/opt/homebrew/opt/pi-coding-agent/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` and background test mode. The windows stayed hidden.

Baseline, before any change (`PI_GUI_DRIVER=rpc PI_GUI_BRAND=alpi`):
```
✘ composer-controls.spec.ts:38  supports keyboard shortcuts, slash menus, and topbar controls … (fails at line 154: isMaximized stayed false)
✘ composer-controls.spec.ts:164 dark mode keeps the send button visible before and after typing (line 209: send button disabled)
✘ tree-command.spec.ts:14 / :106 (thread row never appears; not in scope)
dark-mode test alone, 3 runs: 3 failed at line 209
without PI_GUI_DRIVER/PI_GUI_BRAND: "DesktopAppStore requires an explicit session driver" — the window never opens
```

Diagnostics (a throwaway spec, since moved to the Trash):
- The element at (140, 12) is `BUTTON.icon-button topbar__icon`, inside `.topbar__left` (x 86–224).
- A real maximise toggle makes the hidden window visible (`isVisible()` true).
- The same dark-mode steps with a little time before typing kept the text.
- The fixture thread was in the state, but in a collapsed workspace.

After the change:
```
$ node --test apps/desktop/tests/unit/composer-helpers.test.mjs      -> pass 5, fail 0
$ pnpm run typecheck                                                  -> exit 0
$ pnpm --filter @alamelu-pi/desktop run build                         -> exit 0
$ PI_GUI_DRIVER=rpc PI_GUI_BRAND=alpi … test:e2e:runner -- composer-controls.spec.ts compacted-model-switch.spec.ts
  ✓ compacted-model-switch.spec.ts:5   model switch uses small active context after two compactions … (5.1s)
  ✓ composer-controls.spec.ts:40   supports keyboard shortcuts, slash menus, and topbar controls … (5.6s)
  ✓ composer-controls.spec.ts:201  dark mode keeps the send button visible before and after typing (4.7s)
  ✓ composer-controls.spec.ts:264  Up and Down in an empty chat box recall this thread's earlier messages (5.2s)
  4 passed (21.1s)
$ pnpm run verify:upgrade                                             -> tests 20, pass 20, fail 0; "Upgrade build gate passed."
```

The new test checks each of these:
- Up gives "Second question", then "First question", and stays on "First question".
- Down gives "Second question", then "".
- Typed text is kept on Up.
- After the recalled text is saved as the draft, a new empty thread stays empty on Up.
- Back in the fixture thread, the restored "Second question" stays "Second question" on Up.

The P1-1 reset line is proven to matter. With it removed and the app rebuilt, the new test fails where it should:
```
Error: expect(locator).toHaveValue(expected) failed   Expected: "Second question"   Received: "First question"   (line 328)
```
The line was then restored; the file was copied back and `grep -c` gives 1.

`simplify` (the repo's AGENTS.md rule) was done by the builder, without helper agents (the change is small):
- **Fixed:**
  - the redundant `text` field in the recall state;
  - the duplicated catalog registration, now a shared helper;
  - the wait helper, moved to the shared test helpers (`tests/AGENTS.md`: prefer shared helpers).
- **Skipped:**
  - building the history list on every arrow press: negligible cost;
  - fixing the app-side draft race at its root, in the hydrate effect: Sudhir's ruling keeps P9 test-only.

Diff (`git diff --stat` plus the new file):
```
apps/desktop/src/App.tsx                          |  25 ++++++
apps/desktop/tests/core/composer-controls.spec.ts | 105 +++++++++++++++++++++-
apps/desktop/tests/helpers/electron-app.ts        |  46 ++++++++--
apps/desktop/tests/unit/composer-helpers.test.mjs |  55 ++++++++++++
apps/desktop/src/composer-history.ts              |  58 (new)
```

## Verification Round 2: build, sign, gate 5, install (2026-11-07, 19:11–19:13 IST)

```
$ pnpm run package:tauri            -> exit 0 (upgrade gate ran first; Rust "Finished release in 1m 01s"; bundle 19:12)
$ pnpm --filter @alamelu-pi/desktop run sign:tauri -> valid on disk; satisfies its Designated Requirement
$ codesign -dvvv <bundle>           -> Identifier=com.alamelu.pi.tauri  Authority=Alamelu Pi Local Code Signing
gate 5, backend hash (new bundle vs the installed app before the swap):
  456687f2869cfee225324e347bcb785e1b09de197359938d0a81274a0c101bb3  <bundle>/Contents/Resources/backend/main.cjs
  456687f2869cfee225324e347bcb785e1b09de197359938d0a81274a0c101bb3  /Applications/Alamelu Pi Tauri.app/Contents/Resources/backend/main.cjs
```

Gates 1–4 were not run (plan, P1-5): this change touches no pi, adapter, compaction or model-switch code. This record stands in for gate 6's release record. Windows/WSL: CI builds it, and it is not installed (P8).

Install (Sudhir's prudent path). The app was not running, so nothing was interrupted.
```
mv "/Applications/Alamelu Pi Tauri.app" "/Applications/Alamelu Pi Tauri.app.before-composer-history-20261107-191249"   (kept until the new one is proven)
ditto <bundle> "/Applications/Alamelu Pi Tauri.app"  -> codesign -v valid; Authority=Alamelu Pi Local Code Signing; binary identical to the bundle
```

## Verification Round 3: launch check and run times (2026-11-07, 19:16 IST)

Answers Implementation Audit round 1, findings I1-1 and I1-2.

Launch (I5). The script `/private/tmp/composer-history-debate.FsBn1t/finder_launch.sh` launches the app with a Finder-like environment: launchd's PATH plus the five `CURSOR_*` settings launchd holds, as in the 2026-11-07 Mac release route. It uses `open -g`, so the app opens in the background without taking focus.
```
19:16:11 open exit 0
15981 ~/.nvm/versions/node/v24.16.0/bin/node /Applications/Alamelu Pi Tauri.app/Contents/Resources/backend/main.cjs
PATH=~/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
PI_GUI_PI_BIN=/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin/pi
alpi-startup-debug.log (modified 19:16:16): workspaces=12 sessions=264  providerCounts=49  modelCounts=813
```
So the installed app launches and finds Homebrew pi 1.5.0. The provider and model counts are the same as this afternoon's release (49 and 813). Only the variable names were read from the process environment, never their values, apart from `PATH` and `PI_GUI_PI_BIN`.

Run times (I1-2), from file modification times:
```
19:08:45  mutation run log (reset line removed; the earlier, pre-simplify spec, so the failure cites line 328); App.tsx restored at 19:08:45
19:10:20  last code edits (simplify: composer-history.ts, composer-controls.spec.ts, electron-app.ts)
19:10:29  typecheck exit 0
19:10:34  Electron build exit 0
19:10:56  e2e "4 passed" (compacted-model-switch + the 3 composer-controls tests)   <- on the final code
19:11–19:12  Tauri build of the final code; signed and installed 19:12:49
```

The old copy, `/Applications/Alamelu Pi Tauri.app.before-composer-history-20261107-191249`, stays until Sudhir has tried the new app (I1, his own check). It goes to the Trash then. That is "proven" in Sudhir's prudent path: install, verify, then remove the backup.

## Sudhir's check in the installed app (I1)

19:19 IST, 2026-11-07. Sudhir tried Up and Down in the installed app: "Looks fine to me."

## Verification Round 4: commit, push, CI, clean-up (I7, I8) (2026-11-07, 19:20–19:25 IST)

```
git fetch; git log HEAD..origin/main and origin/main..HEAD -> both empty (no one else's commits)
git add <the 11 files of this change only>; commit 2de5eba "Chat box: Up in an empty box recalls this thread's earlier messages"; git push origin main
CI "Native builds" run 42378757475 for 2de5eba: success
  compatibility (macos-15) success · compatibility (windows-2022) success · macOS Apple Silicon success · Windows AMD64 success
```

- **Old app copy:** `/Applications/Alamelu Pi Tauri.app.before-composer-history-20261107-191249` (77M) was moved to the Trash at 19:20, after Sudhir's check. `/Applications` now holds only `Alamelu Pi Tauri.app`. Sudhir empties the Trash.
- **Review scratch files:** the prompts, heartbeats, the spare `App.tsx` copy and the two throwaway diagnostic specs went to the Trash. The logs and `finder_launch.sh` stay in `/private/tmp/composer-history-debate.FsBn1t/`, where macOS clears them later.
- **Stray processes:** no test Electron process is left running.
- **Documents:** none beyond these four records (plan, P7).
- **Repo-memory cards:** none.
- **Windows:** CI built the AMD64 installer. It is not installed in this change (P8).
