# `/tree` off, draft race fixed, every failing core test fixed: implementation

Builder: Claude (Opus 5.5). Critic: Opus 5.5 at high effort, as an agent. Diagnosis was done by four Opus helpers that changed no files; their notes are in `/private/tmp/tree-off-race.6mAjxJ/diag/{sidebar,providers,features,skills}/`.

Records:
- criteria: [tree_off_and_draft_race_criteria.md](tree_off_and_draft_race_criteria.md) — agreed 2026-11-07 about 20:08, with the owner's change to "every failing core test" and the I14 list;
- audit: [tree_off_and_draft_race_audit.md](tree_off_and_draft_race_audit.md).

Sudhir's rule for each test: "Everything as in the tests and docs, nothing else."

## What changed (32 tracked files, +469/−108 with the four raised items, plus the records)

**App: `/tree` and the draft race (I1, I2, I5, I6)**
- `electron/rpc-desktop-driver.ts`: `supportsTree = false`, with a comment giving the reason.
- `src/App.tsx`:
  - a typed `/tree`, with or without arguments, sets the error "/tree is turned off in Alamelu Pi." when the flag is off;
  - `handleSelectSession` saves an unsaved draft for the thread being left (`api.updateComposerDraft`) before `api.selectSession` (race A);
  - the hydrate effect treats a "selection" sync that reaches its nonce branch like "persist" and "state". That branch is reached only for the thread already in the box, since a switch takes the key-change branch (race B).

**App: the five defects the tests found (I14 A1–A5)**
- **A1** `packages/pi-rpc-driver/src/pi-rpc-driver.ts` `assertExistingLabSessionId`: a thread with no session file yet may be opened. pi writes the file on the first message, and `--session-id` with `--session-dir` creates it in the isolated folder. The id pattern check and the realpath-inside-folder check stay.
- **A2** `electron/external-pi-runtime-supervisor.ts` `providerRecord`: a provider's subscription name is used only when it is signed in by subscription or has no API-key setup. An API-key OpenAI is "OpenAI".
- **A3** `ExternalPiRuntimeSupervisor.refreshRuntime`: when no enabled model can be picked, the models of signed-in providers are turned on, as upstream pi-gui's refresh did. It writes `enabledModels` through the existing `setScopedModelPatterns`.
- **A4** `electron/app-store.ts` `withDiscoveredSkills`: the Skills view's list comes from the skill commands pi returned for the workspace's threads. pi's RPC runtime reports `skills: []`. It is applied in `serializeRuntimeState` and in `refreshAllRuntimeSnapshots`.
- **A5** `app-store.ts`, `app-store-internals.ts`, `app-store-worktree.ts`: the store keeps `generateThreadTitleOverride`, and the auto-title step uses it when it returns something other than `undefined`. main.ts sets it only through the `PI_APP_TEST_MODE` test hooks, so the product is unchanged.
- **A4, second part** (found in the first full run): `syncDerivedSessionState` also refreshes the workspace's skills. A thread's commands reach the screen through that smaller update, not through `refreshState`.
- **A6** `packages/pi-rpc-driver/src/pi-rpc-driver.ts` `renameSession` (found in the first full run).
  - **Problem:** a rename during a run failed with "RPC session is running; session configuration changes must wait for it to finish". `generateAndApplyAutoTitle` swallowed that error, so the thread kept "New thread".
  - **Why the wait is not needed:** pi applies `set_session_name` at any time; `dist/modes/rpc/rpc-mode.js` just calls `session.setSessionName(name)`.
  - **Fix:** while a run is going, the rename goes straight to the current client. When idle it keeps the existing idle-queue path.
  - **Evidence:** a throwaway probe started a thread in deferred-title mode and resolved the title during the run. Before the fix, the title stayed "New thread" for 25 seconds after the run ended.

**Tests: the harness (I14 T1, plus a temporary HOME)**

All of these are in `tests/helpers/electron-app.ts`:
- `PI_GUI_BRAND` defaults to `alpi`, unless the shell or a spec sets it.
- Every launched app gets its own `HOME` inside its user-data folder. The first full run showed why: typing `/tree` matched the real skill `/skill:using-git-worktrees` from `~/.agents/skills`, and Enter picked it. That broke the HOME rule in Sudhir's global rules ("Tests never touch the real HOME").
- `findPiSessionManagerModule` finds pi's `dist/core/session-manager.js` from npm's `dist/cli.js`, from `dist/bundle/cli.js`, or from Homebrew's `bin/pi` wrapper.
- `PROVIDER_ENV_VARS` adds the four Google Cloud variables.
- `seedAgentDir` takes `defaultProjectTrust`.
- New shared `expandWorkspaceOfSession` and `expandWorkspaceGroup` helpers:
  - `clickSession` calls them;
  - `createNamedThread` uses them in place of its own copy;
  - `startThreadViaIpc` expands the new thread's workspace, as starting a thread from the screen does (alpi_sidebar_no_repository_plan.md).

  They wait for the workspace row before deciding whether it is collapsed. In the first full run the dark-mode test clicked an open group shut, just after leaving Settings.

**Tests: specs**

Out of date with a recorded decision (T2, T3, T4):
- `navigation`, `persistence`, `smoke`, `unread-state` and `timeline-pinning` (whose dead `data-collapsed` lines are removed);
- `archive`, `smoke`, `reopen-state`, `compaction-status`, `provider-settings`, `model-scope-toggle` and `new-thread-composer`;
- `skills-settings` (frontmatter and project trust);
- `composer-controls`: the dark-mode test goes back to a plain `selectSession`, so it checks race B.
- `new-thread-auto-title` :195: the test closes the first app only after its run has ended. Its own title says "after auto-title finished". It then expands the workspace before checking the sidebar row.
  - Probe: closed at once, mid-run, pi's file held `session_info: "Heal title after reopen"`, but the reopened thread kept the stale catalog title. Closed after the run, the title healed within about a second.
  - In real use the catalog holds the right title, because `RpcDesktopDriver.renameSession` saves it there too. Only a test that corrupts the catalog and then closes mid-run reaches this case.

Disabled, with the reason and the test that checks the off state (I3, D1–D3):
- `tree-command` ×2, live `tree-command`;
- `worktrees` ×3, `new-thread-auto-title` (worktree);
- `queued-messages` ×2;
- `provider-settings` (the empty-state test).

Changed to check the off state (I4): `ux-repair` "/tree is turned off…".

**Docs (I9)**
- `README.md`, the testing paragraph: the helper sets the brand and an isolated user-data folder, features that are off are skipped with a reason, and the core-lane command is given.
- `apps/desktop/README.md` needs no settings note: the harness now makes the documented `test:e2e:core` command work with no settings, as VR1's plain-command run shows. Two lines were stale after this change (audit I1-4): the core lane no longer lists worktree UI as coverage (its specs are skipped), and the targeted-script example `test:core:worktrees` becomes `test:core:navigation`.
- `tests/core/tree-command.spec.ts`'s comment cites function names, not line numbers, which shift.

Not changed: `src-tauri/`, pi, pi config, scripts.

## Each baseline failure: first error, verdict, evidence (I14; answers I1-3)

These come from the 0f900cc baseline logs. The first error is shortened. Verdict letters follow the criteria's I14 list: A = app fix, D = off by design, T = test out of date or leaking.

- `archive:10` — strict mode: `.session-row__action` matched 2 (Rename and Archive). T3: row actions changed; hover opacity is on `.session-row__actions` (`src/styles/sidebar.css`).
- `compaction-status:52` — `.composer__hint` got "Enter to queue · … · gpt-5medium". T3: the elapsed label has its own slot, `.composer__elapsed` (commit 3c02194).
- `model-scope-toggle:19` — badge button "openai:gpt-5" not found. T3: friendly badge label with the raw id as its title (alpi_ux_repair §3.5); pi's lower-case catalog labels; the Others workspace in the picker; worktree step off (D1).
- `navigation:14` — `.session-row--active` "Persistence session" not found after restart. T2: sidebar starts collapsed (alpi_sidebar_no_repository_plan.md).
- `new-thread-auto-title:19, :82, :123, :160, :194` — topbar expected "New thread", got the prompt text. A5: the test-only title hook was dropped by the store. Then A6: a rename during a run failed ("session configuration changes must wait"). Then T2: rows were hidden in a collapsed workspace. `:194` also closes the first app only after its run ends (see the record).
- `new-thread-auto-title:49` — composer never visible for a worktree thread. D1: worktrees off (`supportsWorktrees = false`; alpi_ux_repair §1.4(d)).
- `new-thread-composer:258` — expected "OpenAI · gpt-4o", got "OpenAI (ChatGPT subscription) · gpt-4o". A2: pi ≥ 0.99's OpenAI OAuth name was used for an API-key provider.
- `new-thread-composer:368` — notice said "Open Settings > Models", not "Providers". T1: the shell's Google Cloud variables made Vertex "connected". Then A3: refresh did not turn on a newly signed-in provider's models. Then T3: lower-case model labels.
- `new-thread-composer:424` — same notice. T1 (Google Cloud variables).
- `persistence:49` — 2 attachments came back as 0 after restart. A1: "RPC lab session not found" for a thread pi had not written yet.
- `persistence:149` — `.session-row--active` not found after restart. T2.
- `provider-settings:14, :74, :186, :236` — the "openai" rows were not found under the new name. A2, plus `/openai/i` in `:14`.
- `provider-settings:295` — the empty state never appears. D3: the Others workspace always exists.
- `provider-settings:349, :402` — no "Login" button. T3: dual-method providers show "Use subscription" (alpi_external_provider_auth_bridge_plan.md).
- `queued-messages:99, :155` — no Edit or Steer button. D2: queue editing off (`supportsQueueEditing = false`, commit 288a725); the file's own header has said "not run" since 13 Sep.
- `reopen-state:16` — `waitForWorkspaceByPath` returned null: the whole state was emptied by "RPC lab session not found". A1. Then T3: replies show only when finished, "Preparing response…" (commit a8a9832).
- `skills-settings:6` — "No skills found". T4: frontmatter, trust, HOME. Then A4: the Skills view list was hard-wired empty under RPC.
- `skills-settings:71` — slash menu showed real skills ("Executing Plans"). T4: the real `~/.agents/skills` leaked; frontmatter and trust were missing.
- `smoke:12` — strict mode: 3 "New thread" buttons. T3: per-workspace + buttons (commit 04f0de2); the heading is "Alamelu Pi".
- `smoke:53` — session title not found. T2.
- `timeline-pinning:366, :418` — row click timed out. T2: their `[data-collapsed]` expand never matched.
- `tree-command:14, :106` — row click timed out. `/tree` off (I3).
- `unread-state:52` — row not found after restart. T2, then A1.
- `worktrees:13, :59, :106` — no worktree workspace appeared. D1.

The helpers' full notes stay in `/private/tmp/tree-off-race.6mAjxJ/diag/` until macOS clears them. The list above is the durable copy.

**I7, the known edge kept:** you click a *different* thread and type in the old thread's box in the moment before the new one loads. That text may be lost, since it is ambiguous which thread it belongs to. No code.

**What Sudhir will see when he types `/tree` (answers I1-2):**
- In his real app the slash menu also lists his own skills. Typing `/tree` matches `/skill:using-git-worktrees` (from `~/.agents/skills/superpowers`), and Enter puts that skill in the box instead of showing "/tree is turned off in Alamelu Pi.".
- The menu no longer offers `/tree` itself (I1), and nothing opens the tree dialog.
- The error shows when no menu item matches, as in the test's empty HOME.

## Verification Round 1 (2026-11-07, 20:24–)

**Baseline, before any change, at 0f900cc.**

The whole core lane, run with `PI_GUI_DRIVER=rpc PI_GUI_BRAND=alpi PI_GUI_PI_BIN=<Homebrew cli.js>`, since without those the window never opens:
```
part 1 (10 files): 25 passed, 9 failed, 1 skipped
part 2 (21 files): 27 passed, 28 failed  (+1 production packaged-smoke matched by name; not core)
=> 37 failed, 52 passed, 1 skipped
```

The race proofs, on the unfixed build:
```
zz-race-proof.spec.ts (throwaway, not committed), on the unfixed build:
  race A, switch to another thread: Expected "check the logs"        Received ""
  race A, click the open thread:    Expected "check the logs again"  Received ""   -> 2 failed
dark-mode test with plain selectSession, --repeat-each=3, unfixed build: 3 failed (send button disabled, line 247)
```

**After the change** (20:37, no lane settings):
```
pnpm run verify:upgrade                         -> tests 20, pass 20, fail 0; "Upgrade build gate passed."
pnpm --filter @alamelu-pi/pi-rpc-driver test    -> tests 79, pass 79, fail 0
pnpm --filter @alamelu-pi/desktop run build     -> exit 0
node --test apps/desktop/tests/unit/*.test.mjs  -> tests 75, pass 75, fail 0
pnpm run typecheck                              -> exit 0
zz-race-proof + ux-repair                       -> 8 passed, 1 failed: ux-repair /tree-off. Its screenshot shows the composer
                                                   holding "/skill:using-git-worktrees" — a real skill from ~/.agents/skills
                                                   that the slash menu matched for "/tree" -> the temporary HOME in the harness
dark-mode test, plain selectSession, x3         -> 3 passed
```

**Full core lane, first run** (20:40, `pnpm --filter @alamelu-pi/desktop run test:e2e:core`, no lane settings):
```
7 failed, 9 skipped, 75 passed (6.6m)   (75 includes the 2 throwaway race proofs)
  composer-controls:201 dark mode         — row click timed out: the expand helper closed an open group (see the helper change)
  new-thread-auto-title :19 :83 :124 :161 :195 — placeholder rows hidden (collapsed workspace), and titles never applied (A6)
  skills-settings:26                      — Skills view still empty (A4 second part)
skipped (9) = tree ×2, worktrees ×3, auto-title worktree ×1, queued-messages ×2, provider-settings empty state ×1
```

**After those fixes** (20:50–20:57):
```
pnpm run verify:upgrade                      -> tests 20, pass 20, fail 0
pnpm --filter @alamelu-pi/pi-rpc-driver test -> tests 79, pass 79, fail 0
pnpm run typecheck                           -> exit 0;   Electron build -> exit 0
auto-title + skills-settings + composer-controls -> 9 passed, 1 skipped, 1 failed (auto-title:195 reopen half)
auto-title:195, --repeat-each=3 (before the wait-for-run-end step) -> 3 failed at line 246 (title not healed)
auto-title:195, --repeat-each=3 (with the wait)                     -> 3 failed at line 255 (row hidden: collapsed after restart)
new-thread-auto-title.spec.ts, --repeat-each=2 (with the expand step) -> 10 passed, 2 skipped
```
The throwaway specs (`zz-race-proof`, `zz-title-probe`, `zz-heal-probe`) are in the Trash.

**Full core lane, final run** (20:57–21:03, `pnpm --filter @alamelu-pi/desktop run test:e2e:core`, no lane settings, on the code to be committed):
```
core lane exit 0
  9 skipped
  80 passed (5.6m)
```
- **The skipped tests are all by design:** tree ×2, worktrees ×3, auto-title worktree ×1, queued-messages ×2, provider-settings empty state ×1.
- **Counts:** `tests/core` declares 89 tests, now and at 0f900cc. So the baseline was 52 passed and 37 failed out of 89. The baseline's single "skipped" was `tests/live/queued-messages.spec.ts`, which the file name `queued-messages.spec.ts` also matched; it skips without real logins. It is not core.

Not run (I15):
- the live lane, which needs real provider logins and skips without them;
- the native lane, which takes the screen and focus, so it runs only when Sudhir says;
- the production lane.

## Verification Round 2: build, sign, gate 5 (I10) (2026-11-07, 21:15–21:17 IST)

```
$ pnpm run package:tauri                              -> exit 0 (upgrade gate ran first; Rust "Finished release in 15.97s")
$ pnpm --filter @alamelu-pi/desktop run sign:tauri    -> valid on disk; satisfies its Designated Requirement
$ codesign -dvvv <bundle>  -> Identifier=com.alamelu.pi.tauri  Authority=Alamelu Pi Local Code Signing
gate 5, backend hash:
  new bundle      ee8c52ea847002abfc420dd90daf12d1e8bf92a671576bd8c5d462b17ba7a2ca  Contents/Resources/backend/main.cjs
  installed app   456687f2869cfee225324e347bcb785e1b09de197359938d0a81274a0c101bb3
```

The backend hash changed, as expected: `rpc-desktop-driver.ts`, the supervisor, the store and `pi-rpc-driver.ts` (A1, A6) are backend code. Checks of what the new bundle carries:
- "RPC lab session not found" appears 0 times in the new `main.cjs`, and once in the installed one;
- `supportsTree = false` is in the new `main.cjs`;
- "/tree is turned off in Alamelu Pi" is in the embedded frontend (`out/tauri/assets/index-*.js`, built at 21:15).

Gates 1–4 were not run. No pi, adapter, compaction or model-switch code changed; `verify:upgrade` (20 of 20) covers the RPC and wiring tests. Windows/WSL: CI builds it; it is not installed in this change.

Install is pending. Alamelu Pi Tauri is running on Sudhir's Mac (pid 19950), so the swap waits for him to quit it.

## The four raised items, moved into this change (2026-11-08; criteria I16–I19)

Sudhir, 2026-11-08: "fix all 4 at the same time. No, dropping 1 and 2, lol." The criteria file has his words in full.

**I16. Exact `/tree` + Enter**
- `src/App.tsx` `handleComposerKeyDown`:
  - when `/tree` is off and the box holds exactly `/tree`, Enter skips the slash menu and goes to the submit check, which shows "/tree is turned off in Alamelu Pi.";
  - any other Enter, and the new-thread box, are unchanged.
- Test: `ux-repair.spec.ts`'s `/tree` test seeds a global skill `using-git-worktrees`. It checks that the `/tree` menu shows that skill, that Enter shows the message, and that the box still holds `/tree`.

**I17. The A3 guard**
- `electron/external-pi-runtime-supervisor.ts`: `isPlainModelId`. The auto-enable runs only when every `enabledModels` entry has a `/`, has no `*`, `?` or `[`, and does not end in one of pi's thinking levels.
  - The rules come from pi 1.5.0's `dist/core/model-resolver.js` (`resolveModelScopeFromModels`, `splitThinkingSuffix`).
  - The level list comes from `dist/cli/args.js`: off, minimal, low, medium, high, xhigh, max.
- Test: `tests/unit/external-pi-runtime-supervisor.test.mjs`, with the supervisor's snapshot read and settings write replaced:
  - four pattern lists cause no write;
  - `["fake-provider/fake-model"]` still gains `anthropic/claude-x`.
- Limit (audit I3-2): pi also matches a plain-looking entry loosely, ignoring case and by part of a name (`anthropic/sonnet`, `Anthropic/Claude-X`), and drops an unknown suffix such as `:ultra`.
  - The guard treats those entries as plain. A refresh can then add the signed-in providers' models, as upstream did.
  - That happens once, not on every refresh: after the write the list holds exact ids, so the next refresh stops.
  - Matching pi fully would mean reusing pi's resolver, which is wider than I17. Today his settings have no `enabledModels`.

**I18. "Create permanent worktree" hidden when worktrees are off**
- `src/sidebar.tsx`: `worktreesUnsupported` is passed from `App.tsx` (`driverCapabilities.worktrees === false`) through `Sidebar` to each workspace group.
  - The item is hidden when the flag is set, as it already was for the Others folder.
  - "Remove worktree" is unchanged.
- Test: `ux-repair.spec.ts`'s worktrees-off test opens the workspace menu of a plain project folder. "Open folder" is there, and "Create permanent worktree" is not. The item was never limited to git folders, so a plain folder shows the fix.
- The `worktrees.spec.ts` header gains one sentence: the menu no longer offers the item.

**I19. Host commands keep the attachments**
- `electron/app-store-composer.ts` `finishComposerCommand` no longer empties the session's attachments or the state's `composerAttachments`. It still clears the command text.
- `src/App.tsx` `submitComposerDraft` hides the attachments while sending only when the text is not a host command (`parseComposerCommand`), so they do not blink out during `/status`.
- Before: the screen lost them and the saved file kept them, so they came back after a restart. Both persistence tests already expected them back.
- Test: `persistence:49` checks that both attachments are on screen right after `/status`. Its restart half already checks the saved file.

## Verification Round 3: the four items (2026-11-08, 14:04–14:13 IST)

Script `/private/tmp/tree-off-race.6mAjxJ/after3.sh`, then `full3.sh`, with logs alongside:

```
$ pnpm run typecheck                                    -> exit 0
$ node --test apps/desktop/tests/unit/*.test.mjs        -> tests 76, pass 76, fail 0   (75 + the new A3-guard test)
$ pnpm run verify:upgrade                               -> tests 20, pass 20, fail 0
$ pnpm --filter @alamelu-pi/desktop run build           -> exit 0
$ test:e2e:runner ux-repair.spec.ts persistence.spec.ts new-thread-composer.spec.ts
                                                        -> 18 passed (1.0m)
$ test:e2e:core (whole core lane, 14:07:33–14:13:16)     -> exit 0
  9 skipped
  80 passed (5.7m)
```

- The new checks sit inside existing tests, so the core lane's counts are unchanged:
  - `/tree` + Enter with a "tree" skill in the menu;
  - the workspace menu;
  - the attachments after `/status`.
- The skipped nine are the same as in VR1, all by design.
- The new unit test fails without the guard. Checked at 14:13: the guard line was taken out of a backed-up copy, the test ran (`pass 1, fail 1`, four writes such as `['anthropic/*', 'anthropic/claude-x']` against an expected `[]`), and the file was put back (`cmp` identical).
- Not run, as before (I15): the live, native and production lanes.

## Verification Round 4: final build, sign and install (I10) (2026-11-08, 14:17–14:20 IST)

The app was rebuilt after the round-3 comment fix:

```
$ pnpm run package:tauri                              -> exit 0 (upgrade gate ran first; Rust "Finished release in 15.21s")
$ pnpm --filter @alamelu-pi/desktop run sign:tauri    -> valid on disk; satisfies its Designated Requirement
$ codesign -dvvv <bundle>  -> Identifier=com.alamelu.pi.tauri  Authority=Alamelu Pi Local Code Signing
gate 5, backend hash:
  new bundle         638f0407f3240d6e0ce8ae81c827c5aa41bba11949c3c13c07785bfd3cd2fd09  Contents/Resources/backend/main.cjs
  previous install   456687f2869cfee225324e347bcb785e1b09de197359938d0a81274a0c101bb3
```

- The hash is the same as the 14:14 build. The bundler strips comments, so the comment-only fix did not change `main.cjs`.
- What the bundle carries:
  - `main.cjs` holds the thinking-level guard and no "RPC lab session not found";
  - the embedded frontend (`out/tauri/assets/index-BvCVdhBH.js`, 14:19) holds "/tree is turned off in Alamelu Pi." and the exact-`/tree` Enter check.

Install. The app was not running (`pgrep`, 14:20), and Sudhir said he is not using it:

```
mv "/Applications/Alamelu Pi Tauri.app" "/Applications/Alamelu Pi Tauri.app.before-tree-off-20261108-1420"
ditto <bundle> "/Applications/Alamelu Pi Tauri.app"
codesign -v  -> ok;  Authority=Alamelu Pi Local Code Signing;  installed main.cjs 638f0407…
finder_launch.sh (open -g, launchd's PATH)  -> backend pid 53302 up within 1 s
PI_GUI_PI_BIN=/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin/pi   (the same pi as `command -v pi`)
```

- No `pi --mode rpc` process runs yet. The app starts one when a thread is opened.
- I11 (Sudhir's own check) waits until he next uses the app. The old copy stays beside it until then (I12).

## Persistence (I12) (2026-11-08)

- Commit `f56362a` holds this change's files only: the 32 tracked files and the five records. It was pushed to `origin/main`; `origin/main..HEAD` was empty before the push.
- CI "Native builds", run 42464657190, is green:
  - attempt 1: the Windows job's tests passed, then it failed with `http status: 504` while Tauri's bundler downloaded `nsis-3.11.zip` from GitHub. That was GitHub's outage, not the code.
  - attempt 2 re-ran only that job, and it passed.
  - compatibility (macOS, Windows), macOS Apple Silicon and Windows AMD64 all succeeded.
- The old app copy, `/Applications/Alamelu Pi Tauri.app.before-tree-off-20261108-1420`, goes to the Trash after Sudhir's own check (I11).
- These records are committed with `[skip ci]`.
