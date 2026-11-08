# `/tree` off, draft race fixed, every failing core test fixed: audit

Append-only. Critic: Opus 5.5 at high effort, as a Claude Code agent. Implementation only, so there are no plan rounds.

## Implementation Audit — Round 1 (critic: Opus 5.5 high)

Written 2026-11-07 21:11 IST. Phase: Implementation Audit. Role: critic. Round 1 of at most 3.

### Outcome, scope and done criteria, restated

- **Outcome.** `/tree` is off in Alamelu Pi. Its tests are disabled, with the reasons written in the files. Both directions of the chat-box draft race are fixed. Every core test that failed in the 0f900cc baseline (37 tests) is diagnosed and fixed, following Sudhir's rule: "Everything as in the tests and docs, nothing else."
- **Scope.**
  - App fixes only where the app breaks what a test or doc says (A1–A6).
  - Test fixes only where a test is out of date with a recorded decision, or its environment leaks (T1–T4).
  - Tests disabled only when the feature is off by design (D1–D3, `/tree`). Each disabled test points to a test that checks the off state.
  - Docs that a fix shows to be wrong are updated (I9).
  - Nothing beyond that.
- **Done criteria.**
  - I1–I9 and I14 as agreed.
  - I8b: the whole core lane runs with 0 failed, and the only skips are by design.
  - I15: the live and native lanes are not run, and the report says so.
  - I10–I12 (rebuild, Sudhir's check, commit) come after this audit, so they are not judged here.

### What I checked, and the result

- **Read in full:**
  - the global rules, the repo `AGENTS.md` and `apps/desktop/tests/AGENTS.md`;
  - the criteria, the implementation record and this audit file (it held only its header);
  - the whole `git diff` (28 files);
  - the helpers' notes and the run logs in `/private/tmp/tree-off-race.6mAjxJ/`.
- **Commands I ran myself:**
  - `node --test apps/desktop/tests/unit/*.test.mjs`: 75 pass, 0 fail.
  - `pnpm run typecheck`: exit 0.
  - `pnpm --filter @alamelu-pi/pi-rpc-driver test`: 79 pass, 0 fail.
- **The final core run** (`full2-e2e.txt`, plain `test:e2e:core`, no lane settings) shows 80 passed, 9 skipped, 0 failed. The 9 skips are exactly the by-design list: tree ×2, worktrees ×3, auto-title worktree, queued-messages ×2 and the provider-settings empty state. No throwaway `zz-*` spec is left in `tests/core`.

**The app changes. All are sound; none is wider than its test needs.**
- **A1** (`assertExistingLabSessionId` returns when no file exists).
  - Installed pi creates the session with that exact id when none exists: `dist/main.js:344-351`, "No project session found with id …; creating a new session with that id".
  - The id-pattern check and the realpath-inside-folder check stay.
  - In real use, a catalog thread whose pi file has gone missing now opens empty instead of failing the whole sidebar at start. That is the better outcome. Not a finding.
- **A2** (provider name).
  - The `/^openai$/i` title expectations were written in the same commit as `oauthProvider?.name ??` (8945d58, 11 Jul). The tests are the spec, so APP WRONG holds.
  - OAuth-only providers and providers signed in by subscription keep pi's subscription name.
- **A3** (auto-enable on refresh). This matches upstream `pi-gui-rpc-lab/packages/pi-sdk-driver/src/runtime-supervisor.ts:503-541` line for line: the same exact-match test and the same global write. Sudhir's real `~/.pi/agent/settings.json` has no `enabledModels` (I printed only that field), so the step is a no-op for him today. One latent effect is listed below (I1-6).
- **A4** (Skills list from skill commands). It applies only when skill commands exist. Toggles stay hidden (`supportsSkillToggles = false`). The cost per event is small.
- **A5** (title override). `main.ts:802` always passes the wrapper. It returns `undefined` unless `PI_APP_TEST_MODE`'s `setDeferredThreadTitleMode` was called, so the product is unchanged.
- **A6** (rename during a run).
  - Verified: `dist/modes/rpc/rpc-mode.js:523-529` just calls `session.setSessionName`.
  - `agent-session.js:3259` appends a `session_info` entry, which pi's context builder skips.
  - The idle path is unchanged.
- **Race fixes in `App.tsx`.**
  - "selection" reaches the nonce branch only when the key did not change. The backend sets "selection" only in `applyFastSessionSelection` (`app-store.ts:2093`) and when the selected id changes (`:2303`). So ignoring it on the same key is safe.
  - `handleSelectSession` saves only when the box differs from the saved draft. The save goes to the still-selected thread (`app-store-composer.ts:36`).
  - The race proof and the dark-mode test with the plain `selectSession` (3/3 after, 3/3 failing before) support both directions.
- **Verdicts.** Every APP WRONG / TEST OUT OF DATE / OFF BY DESIGN verdict I sampled has its record behind it:
  - commits a8a9832, 3c02194, 04f0de2 and 288a725;
  - `alpi_ux_repair_plan.md` §1.4(d) and §3.5, the latter saying the model list "keeps coming from `pi --list-models`", hence the lower-case labels.
- **No test is weakened below its purpose.**
  - `reopen-state` still proves that streaming continues after reopen, through the transcript record.
  - `model-scope-toggle` drops only its worktree half, which is off by design, and says so.
- **Disabled tests point to real off-state tests:**
  - `ux-repair.spec.ts:22` and `:99`;
  - `compaction-status.spec.ts:140`;
  - `new-thread-composer.spec.ts:205`.

### Findings

**I1-1 (low). The temporary HOME for every spec is the opposite of what the agreed criteria say.**
- Rests on: [G-scope] 2 and 8, and [G-scope] 9 (a plan covers only what its summary told him). Against that stands Sudhir's standing rule in [G-ops], "Tests never touch the real HOME".
- Evidence:
  - The criteria, "Raised with Sudhir, not done", say: "Every core test still sees the real HOME … Only the skills tests get a temporary HOME."
  - `tests/helpers/electron-app.ts` `buildDesktopLaunchEnv` now sets `HOME: testHomeDir(userDataDir)` for every launch. That covers the live, native and production lanes too, and none of those ran (I15).
  - The implementation record justifies the change by the `ux-repair` failure and the standing rule. The criteria were not updated, so the two records contradict each other.
- Consequence:
  - Sudhir has not been told plainly that an item listed as "not done" was done.
  - The lanes that did not run now launch with a fake HOME, untested. The live real-auth specs and the notification and open-panel specs could depend on HOME.
- Smallest remedy:
  - Add one dated line to the criteria's "Raised with Sudhir" list: done harness-wide under his standing rule, because the `/tree` test picked up his real skill.
  - In the report to Sudhir, say this in one line, and say that the live, native and production lanes now get a temporary HOME and were not run.
  - No code change.

**I1-2 (low). In Sudhir's real app, typing `/tree` + Enter will not show the I2 error.**
- Rests on: I2 ("`/tree` + Enter shows the error '/tree is turned off in Alamelu Pi.'") and I11 (his check in the installed app).
- Evidence:
  - The implementation record, VR1 "After the change": with the real HOME, the slash menu matched "/tree" to `/skill:using-git-worktrees` and Enter picked it.
  - That skill really is on this Mac: `~/.agents/skills/superpowers/using-git-worktrees`.
  - The production RPC config loads skills (`main.ts:655`, `noSkills: false`).
  - The test passes only because the harness now hides his skills.
- Consequence: in real use, `/tree` + Enter puts `/skill:using-git-worktrees` in the box. A second Enter would send that skill to pi. I2 holds only in an empty HOME.
- Smallest remedy:
  - One line in the implementation record, and in the I11 notes for Sudhir, saying what he will see.
  - Making Enter on an exact `/tree` show the error ahead of the menu would be a code change outside I2's agreed shape. Raise it with him; do not do it unasked.

**I1-3 (low). The I7 line is missing, and the I14 evidence lives only in `/private/tmp`.**
- Rests on:
  - I7: "One line in the implementation record, no code."
  - I14: "Its cause is written in the implementation record with evidence."
  - [G-ops]: "macOS deletes /private/tmp files untouched for over 3 days".
- Evidence:
  - `grep` finds no I7 edge (typing in the old box while a *different* thread loads) in `tree_off_and_draft_race_implementation.md`.
  - The record names the T2/T3 spec files, but the observed failure for each test exists only in `baseline-part1.txt`/`baseline-part2.txt` and the helpers' folders under `/private/tmp`. The helpers' final reports were never saved; the diag folders hold runs, not reports.
- Consequence: within three days, the per-test evidence behind 37 verdicts is gone from disk. Only the summaries in the criteria remain.
- Smallest remedy:
  - Add the I7 line.
  - Add a short per-test list to the implementation record: the test, its first error line from the baseline, the verdict and the record or commit behind it. Alternatively, copy the two baseline failure summaries into the repo next to the records.

**I1-4 (low). Two doc details are now stale.**
- Rests on: I9 ("also covers any doc a fix shows to be wrong").
- Evidence:
  - `apps/desktop/README.md:49` still lists "worktree UI behavior" as core-lane coverage.
  - `apps/desktop/README.md:130` still gives `test:core:worktrees` as a targeted example. That file is now entirely skipped (D1).
  - The `tree-command.spec.ts` header cites `navigateSessionTree (~line 516)` and `transcriptFromLocalSessionFile (~line 994)`. After A1 and A6 they are at 521 and 999.
- Consequence: a reader runs a lane that tests nothing, or looks at the wrong lines.
- Smallest remedy:
  - Drop the worktree mention, or mark it off by design.
  - Replace the example with another `test:core:*` script.
  - Cite the function names without line numbers.

**I1-5 (low). A known edge in the auto-title reopen test is not recorded as raised.**
- Rests on: [G-work] "A problem found along the way gets a fix offered, not just a mention", and the criteria's "Raised with Sudhir, not done" list.
- Evidence:
  - `new-thread-auto-title.spec.ts:221-228` now waits for the run to end before closing.
  - The record's own probe: closed mid-run, pi's file held the name, but the reopened thread kept the stale catalog title.
  - The builder argues that real use never has a stale catalog title, because `RpcDesktopDriver.renameSession` saves it too. I accept that the test change is honest, since the test's title says "after auto-title finished". But the heal does not run for a thread closed mid-run.
- Consequence: small. It matters only if the catalog save is lost, for example in a crash between pi's rename and the catalog write.
- Smallest remedy: one line in the "Raised with Sudhir" list. No code.

**I1-6 (low). A3 can rewrite pi's global model list if Sudhir ever uses patterns.**
- Rests on: Sudhir's real use; A3 "writes `enabledModels` on refresh".
- Evidence:
  - pi treats `enabledModels` as minimatch patterns or bare model ids, with optional `:thinking`. Its own docs (`docs/extensions.md:1218`, `docs/settings.md:18`) give `anthropic/*:high` as an example.
  - A3's "selectable" test is an exact `provider/model` match (`external-pi-runtime-supervisor.ts:58`), the same as the picker's (`composer-commands.ts:392-400`) and as upstream's.
  - With a list like `["anthropic/*"]`, nothing matches exactly. Each refresh would then append every signed-in provider's models to `~/.pi/agent/settings.json`, the file the pi CLI also reads.
  - Today his settings have no `enabledModels`, so nothing happens.
- Consequence: latent. It would silently change his pi-terminal model cycling.
- Smallest remedy:
  - Record it as raised with Sudhir.
  - A one-line guard (skip the auto-enable when any pattern is not a plain `provider/model`) is hardening beyond the test. Do it only on his yes.

### Owner questions

None blocking. I1-2 and I1-6 each carry an optional code change that needs Sudhir's yes. They should be raised, not done.

### Verdict reasoning

- There are no high or medium findings.
- Verification passes: unit tests, typecheck and the driver suite, run by me; the final core lane, from the log.
- The code changes match the criteria and are no wider than needed.
- But there are six low findings, more than the three a PASS allows. All six are fixed by record and doc lines; none needs code.

Verdict: REVISE

## Response to Implementation Audit — Round 1 (builder: Claude Opus 5.5)

All six findings are accepted. Each fix is a record or doc line; no code changed. These are in-scope low fixes, which Sudhir's rule says to make by default.

- **I1-1. Accepted.** The criteria's "Raised with Sudhir, not done" item is struck through, with a dated line: done harness-wide under his standing rule "Tests never touch the real HOME", after the `/tree` test picked up his real `using-git-worktrees` skill. The line also says that the live, native and production lanes get it and were not run. The report to Sudhir will say this in one line.
- **I1-2. Accepted.** The implementation record gains "What Sudhir will see when he types `/tree`". The criteria's raised list gains the optional change (an exact `/tree` shows the error ahead of the menu), which needs his yes. It is not done.
- **I1-3. Accepted.**
  - The I7 line is added to the implementation record.
  - A new section, "Each baseline failure: first error, verdict, evidence", lists all 37 tests, generated from the baseline logs and checked by hand: the first error, the verdict letter and the record or commit behind it. This is the durable copy.
- **I1-4. Accepted.**
  - `apps/desktop/README.md`: the core-lane line now says worktree specs are skipped, and the example `test:core:worktrees` becomes `test:core:navigation`.
  - The `tree-command.spec.ts` comment cites the function names without line numbers.
- **I1-5. Accepted.** It is added to the criteria's raised list: a thread closed mid-first-run, with a stale catalog title, does not take pi's name on reopen. No code.
- **I1-6. Accepted.** It is added to the criteria's raised list: A3's exact matching against pi's pattern syntax. A one-line guard needs his yes. No code.

## Implementation Audit — Round 2 (critic: Opus 5.5 high)

Written 2026-11-07 21:14 IST. Phase: Implementation Audit. Role: critic. Round 2 of at most 3. The rules and scope limits are the same as in round 1.

### Each response, checked

- **I1-1: resolved.**
  - The criteria's "Raised with Sudhir" item is struck through and replaced by a dated line. The line gives the reason (his standing rule "Tests never touch the real HOME", and the `/tree` test picking up `using-git-worktrees`).
  - It says that the live, native and production lanes get the temporary HOME and were not run.
  - The criteria and the implementation record now agree.
- **I1-2: resolved.**
  - "What Sudhir will see when he types `/tree`" in the implementation record is accurate: Enter picks `/skill:using-git-worktrees`, the menu no longer offers `/tree`, and the error shows only when nothing in the menu matches.
  - The optional change sits in the raised list and needs his yes.
- **I1-3: resolved.**
  - The I7 line is present, and its wording matches the criteria.
  - The new per-test section has 37 entries. I matched them against the baseline logs: the failure list in `baseline-part1.txt` and `baseline-part2.txt` is the same 37 core tests (9 + 28; the 29th in part 2 is the production `packaged-smoke`, correctly left out).
  - **First errors I checked against the logs:**
    - `archive:10`: strict mode, the Rename and Archive buttons both match.
    - `smoke:12`: 3 "New thread" buttons.
    - `compaction-status:52`: "gpt-5medium" in the hint.
    - `new-thread-composer:258`: "ChatGPT subscription".
    - `new-thread-composer:368` and `:424`: the notice says "Open Settings > Models", not "Providers".
    - `persistence:49`: `"attachments": 2` expected, `0` received.
    - `reopen-state:16`: `waitForWorkspaceByPath` returned null.
    - `skills-settings:6` and `:71`: "No skills found", and the real "Executing Plans" skill.
    - The new-thread-auto-title tests: `toHaveText("New thread")`.
  - **The cause behind A1** ("RPC lab session not found") is not in the baseline logs. It is in the helpers' notes (`diag/sidebar/reopen-diag.txt`, `unread-diag.txt`, `diag/skills/diag-persist.txt`). The list presents it as a cause, not as the logged error, which is fair.
- **I1-4: resolved.**
  - `apps/desktop/README.md` no longer lists worktree UI as core coverage, and says those specs are skipped.
  - The example is now `test:core:navigation`, which exists (`apps/desktop/package.json:47`).
  - The `tree-command.spec.ts` comment cites function names only.
- **I1-5 and I1-6: resolved.** Both are in the raised list with accurate wording, and both are left undone, pending his yes.

### The whole scope, checked again

- No app or test code changed since round 1. The per-file diff counts for code are the same; the only new file in the diff is `apps/desktop/README.md`, and the spec edit touches a comment only.
- I ran these again myself: `pnpm run typecheck` exits 0, and `node --test apps/desktop/tests/unit/*.test.mjs` gives 75 pass, 0 fail.
- No `zz-*` throwaway spec is left in `tests/core`.
- The final core-lane evidence from round 1 (80 passed, 9 skipped by design, 0 failed) still applies to this code.

### Findings

**I2-1 (low). The file count in the implementation record is out of date** (a regression from the round-1 response).
- Rests on: the record's accuracy (I9 and I14 records).
- Evidence:
  - `tree_off_and_draft_race_implementation.md:11` still says "What changed (28 files, +384/−98)".
  - `git diff --shortstat` now gives "29 files changed, 386 insertions(+), 100 deletions(-)".
  - The I1-4 fix added `apps/desktop/README.md` to the diff.
- Consequence: cosmetic. The heading no longer matches the commit.
- Smallest remedy: change the heading to 29 files, +386/−100, and add `apps/desktop/README.md` to the Docs list. That file is already named in the Docs bullet.

### Verdict reasoning

- All six round-1 findings are resolved.
- There are no high or medium findings, and one low finding (I2-1), within the three a PASS allows.
- Verification passes.
- No owner decision blocks the work. The optional changes in I1-2 and I1-6 are recorded as raised and need Sudhir's yes; they are not part of this change.

Verdict: PASS

## Response to Implementation Audit — Round 2 (builder)

- **I2-1. Accepted.** The heading now reads "29 tracked files, +386/−100", from `git diff --shortstat`. This is a trivial in-scope low fix, so it needs no further round. The round-2 PASS stands.

## Decision-model check 1 (implementation stage, after the round-2 PASS)

- State file: `tree_off_and_draft_race_check_1.json` (Sudhir's words, the criteria with his changes, the implementation record with its verification, and the audit summary).
- Model: `liquid/d1-ultra-20261015` (OpenRouter Decisions API). Call id: `gen-dec-1794066307-qyAnGGm6fLuJEIGcOHHn`.
- Probabilities (yes means a problem):
  - criteria_not_met 0.302
  - scope_breached 0.151
  - scope_missing 0.252
- All are under 0.5, so it is a clean check. Cost: $0.00042.

Critic lifecycle closed after the final PASS. The agent finished on its own; there are no open rounds.

## Implementation Audit — Round 3 (critic: Opus 5.5 high)

Written 2026-11-08 14:18 IST. Phase: Implementation Audit. Role: critic. Round 3, the last round for pre-existing defects. Same rules and scope limits as rounds 1 and 2.

### Outcome, scope and done criteria, restated

- **Outcome.** Everything round 2 passed still holds. In addition, the four items raised with Sudhir are fixed in this change. His words: "fix all 4 at the same time." The earlier rule still applies: "Everything as in the tests and docs, nothing else."
- **Scope.** I16–I19 as written in the criteria's 2026-11-08 section, plus the updated I8b, I9, I10, I11 and I12. The stale-title edge (audit I1-5) stays recorded only, with no code. Nothing more.
- **Done criteria for this round.**
  - I16: an exact `/tree` + Enter in a thread shows the "turned off" message, even when a "tree" skill is in the menu, and the box keeps `/tree`.
  - I17: A3 writes nothing when any `enabledModels` entry is a pattern, and a plain list behaves as before.
  - I18: with worktrees off, the workspace menu has no "Create permanent worktree".
  - I19: host commands keep the box's attachments, on screen and in the saved file.
  - I8b again: the whole core lane has 0 failed; unit, driver and typecheck pass.
  - I10–I12 (install, Sudhir's check, commit) come after this audit, so they are not judged here.

### What I checked, and the result

- **Read in full:** the global rules, the repo `AGENTS.md`, `apps/desktop/tests/AGENTS.md`, the criteria with every owner change, the implementation record including VR3, this audit file, and `git diff` (32 files, +469/−108).
- **Commands I ran myself:**
  - `pnpm run typecheck`: exit 0.
  - `node --test apps/desktop/tests/unit/*.test.mjs`: 76 pass, 0 fail.
  - `cmp` of `/private/tmp/tree-off-race.6mAjxJ/supervisor-backup.ts` against the supervisor: identical. Its 14:13:42 timestamp is the restore after the fail-without check, not a later code change.
- **Logs I read:**
  - `after3-e2e.txt`: 18 passed.
  - `full3-e2e.txt`: 80 passed, 9 skipped, 0 failed. The nine skips are the same by-design list as in VR1.
  - Every changed source file is dated before the 14:07:33 lane start, except the restored supervisor.

**I16: met.**
- `App.tsx` `handleComposerKeyDown`: `treeOffEnter` bypasses `slashMenu.handleSlashKeyDown` only when all of these hold: plain Enter, not composing, the tree capability off, and the box trims to exactly `/tree`.
- Every other menu key (arrows, Tab, Escape) and every other Enter still goes to the menu first.
- **Running state:** Enter, or Cmd/Ctrl+Enter, reaches the running branch and then `submitComposerDraft`. The tree check there runs before anything is sent, so `/tree` is refused while running too. `preventDefault` is called on both paths, so no newline is added, as the test's `toHaveValue("/tree")` confirms.
- **`/tree foo`:** the menu is closed once a space is typed (`extractActiveSlashQuery`, `use-slash-menu.tsx:38`), so I2's argument case is unaffected.
- **The new-thread box:** unchanged (`handleNewThreadComposerKeyDown`).
- **The test** seeds `using-git-worktrees` and asserts the menu shows it before Enter. Without the fix, Enter would pick that entry, so both the value check and the message check would fail.

**I17: met, as worded.**
- `isPlainModelId` follows the criterion's three rules:
  - a `/` is required;
  - no `*`, `?` or `[` (pi's glob test, `model-resolver.js:251`);
  - no trailing thinking level, from the list in `cli/args.js:7`.
- The unit test covers the four pattern shapes (no write) and the plain case (one write). The builder's fail-without check is in the record. One limit is in I3-2.

**I18: met.**
- The prop reaches all three render sites (`SortableWorkspaceGroup`, which spreads its props, and the two direct `WorkspaceGroupContent` sites). It is a required prop, so the passing typecheck proves it is passed everywhere.
- "Remove worktree" is still decided first, so it is unchanged.
- The new-thread chip at `App.tsx:2497` already used the same capability.
- The test would fail without the fix, because the item is not limited to git folders: the old condition was only `linkedWorktree` or `isNoRepository`. One wording point is in I3-1.

**I19: met.**
- **Callers of `finishComposerCommand`.** The typed `/model`, `/thinking`, `/status`, `/session`, `/name`, `/compact` and `/reload` all call it. So do the model picker and the thinking picker (`setSessionModel`, `setSessionThinkingLevel`). With the picker, attachments now also stay. That is the same direction and is no regression: before, a model change from the picker emptied the attachments on screen while the saved file kept them.
- **The saved file.** Attachments are written only by `persistComposerAttachments` on add, remove, queue and send. `schedulePersistUiState` does not write them. So the old code emptied memory but not the file, and the record's "came back after a restart" is correct. Memory and the file now agree.
- **Queued messages.** The queue path (`submitComposer`, running and not a host command) still empties and persists the attachments itself, and sends them with the message. A host command typed during a run goes to `runComposerCommand` first and keeps them. Queue editing is off (D2).
- **The new-thread box** has its own `newThreadAttachments`, so it is unaffected.
- **The renderer.** `setAttachmentsClearedOnSubmit(parseComposerCommand(previousDraft) === undefined)` hides the attachments only for messages. An incomplete command (`/name` with no title) still hides them for a moment, then they come back with the error. That is cosmetic, and it was the old behaviour for every command.
- **The test.** Without the store fix, the state comes back with no attachments, so `persistence:49`'s new `toHaveCount(2)` fails. The renderer part, which stops the blink, is not separately tested. That is fine for a cosmetic detail.

**Round-2 work: nothing weakened.**
- Race A and race B are untouched by the four changes. The I19 change does not touch the draft-sync sources.
- The disabled tests still point to real off-state tests.
- No LATE findings.

### Findings

**I3-1 (low). Three record details are out of date or loose.**
- Rests on: the records' accuracy (I9, and [G-scope] 9: an approved plan covers only what its summary told him).
- Evidence:
  - `tree_off_and_draft_race_implementation.md:11` still says "29 tracked files, +386/−100". `git diff --shortstat` now gives 32 files, +469/−108, after adding `sidebar.tsx`, `app-store-composer.ts` and the unit test.
  - The I18 section does not mention the 2026-11-08 sentence added to the `worktrees.spec.ts` header ("Since 2026-11-08 the workspace menu no longer offers …"). It is a comment only.
  - The criteria (I18, line 203) say the test "opens the menu of a git workspace". `ux-repair.spec.ts` `launchAlpi` uses `makeWorkspace`, a plain folder. The check still works, because the menu item is not limited to git folders, but the wording does not match the test.
- Consequence: cosmetic. The heading does not match the commit, and a reader may look for a git setup that is not there.
- Smallest remedy: update the heading from `git diff --shortstat`; add "and a header line in `worktrees.spec.ts`" to I18; change "a git workspace" to "a project workspace" in the record's VR3 note, or add one line saying the item was never limited to git folders.

**I3-2 (low). pi reads more entries as matches than the A3 guard can see, and two lines overstate the old risk.**
- Rests on: I17 ("Per pi's own rules (`dist/core/model-resolver.js`) … is a pattern"), and the prompt's request to check pi's real matching rules.
- Evidence:
  - For entries without glob characters, `resolveModelScopeFromModels` calls `resolveModelReference` with `fuzzy: true` and a lenient suffix (`model-resolver.js:280`). `selectReference` and `fuzzyMatches` (`:154-183`) match ignoring case, and by part of a model's id or name. An unknown suffix is dropped with a warning (`:127-145`).
  - So `anthropic/sonnet`, `Anthropic/Claude-X` and `openai/gpt-5:ultra` are real matches in pi. `isPlainModelId` calls them plain, A3's exact test calls them unselectable, and a refresh then adds the signed-in providers' models.
  - That happens once, not on every refresh. After the write, the list holds exact ids, so the next refresh finds a selectable model and stops.
  - The code comment (`external-pi-runtime-supervisor.ts:64`, "added to on every refresh") and the raised-list wording carried over from I1-6 say "every refresh".
  - Today Sudhir's settings have no `enabledModels`, so nothing happens.
- Consequence: the guard covers the rules the criterion lists, but not every shape pi accepts. A rare list shape can still get one write to `~/.pi/agent/settings.json`.
- Smallest remedy: one sentence in the implementation record's I17 section naming this limit, and "once" instead of "every refresh" in the comment. No new code: a full match would mean reusing pi's resolver, which is wider than I17's agreed shape. This is not a new item to raise with Sudhir, only an honest note of what the guard does.

### Owner questions

None.

### Verdict reasoning

- I16–I19 are each met on the code and on the evidence.
- Nothing round 2 passed is weakened, and there are no LATE findings.
- Verification passes: typecheck and unit tests run by me, and the full core lane from the log.
- There are two low findings, both fixed by record or comment lines, within the three a PASS allows.
- No owner decision is open.

Verdict: PASS

## Response to Implementation Audit — Round 3 (builder)

- **I3-1. Accepted.**
  - The record's heading now reads "32 tracked files, +469/−108", from `git diff --shortstat`.
  - The I18 section names the new `worktrees.spec.ts` header sentence, and says the test uses a plain project folder because the item was never limited to git folders.
  - The criteria's I18 check now says "a project workspace", with a dated correction note.
- **I3-2. Accepted.**
  - The supervisor comment now ends "rather than having models added to it", without "every refresh".
  - The record's I17 section names the limit: pi's loose matching of plain-looking entries can still lead to one addition, as upstream did, and the list then holds exact ids.
  - The raised-list line from I1-6 now says once, not every refresh.
  - No new code.
- Both are trivial in-scope low fixes, so no further round is needed. The round-3 PASS stands.
- The comment change touches backend source after the 14:14 build. So the app is rebuilt and signed again before the install, and the recorded hash is the final one.

## Decision-model check 2 (implementation stage, after the round-3 PASS)

- State file: `tree_off_and_draft_race_check_2.json`. It holds Sudhir's words, including both 2026-11-08 messages, the criteria with all his changes, the implementation record with VR1–VR3, the diff summary and the audit summary.
- Model: `liquid/d1-ultra-20261015` (OpenRouter Decisions API). Call id: `gen-dec-1794127777-12Lk3KnRppPug1OSwiWx`.
- Probabilities (yes means a problem):
  - criteria_not_met 0.139
  - scope_breached 0.057
  - scope_missing 0.193
- All are under 0.5, so it is a clean check. Cost: $0.00059.

Critic lifecycle closed after the final PASS. The round-3 agent finished on her own; there are no open rounds.
