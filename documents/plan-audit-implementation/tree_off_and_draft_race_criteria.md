# `/tree` off, tree tests disabled, chat-box draft race fixed: criteria

Debate-loop, implementation only (no plan). Builder: Claude (Opus 5.5). Critic: Opus 5.5 at high effort, as an agent.
Written 2026-11-07 19:58 IST.

## Sudhir's words (2026-11-07)

1. "if we find a problem, do we not fix it? I appreciate that you are waiting for my go ahead and I am giving it. Please fix the test tree-command.spec.ts or delete the test. Whatever is the right thing to do in light of our fixes. What does the test do anyway? If the race is easy to fix, go ahead. If not, I can live with it."
2. "1 --> yes / use debate-loop ( implementation only ). update any docs that need to be updated."
3. After my correction (in pi's RPC mode, a `/tree` switch forks into a new thread file the app never tracks): "I do not need the tree command. So, 2 it is. But disable the test also. And document it as comments inside the test or somewhere. I do not want a test failing all the time."

Option 2 was: turn `/tree` off in the app for now. You branch in pi's terminal instead.

## The race, with worked examples

The app saves what you type 350 ms after you stop typing (`App.tsx` draft-save effect). Clicking a thread, even the one already open, makes the backend send that thread's saved draft back. The renderer then puts it in the box (`applyFastSessionSelection` → the hydrate effect). The race has two directions.

- **A, typed just before a click.**
  1. In thread T1 you type "check the logs".
  2. Within 350 ms you click thread T2.
  3. The save for T1 never happens. Back in T1, the box holds whatever was saved before "check the logs".

  The same happens when you click T1 itself: the box is reset to the older saved draft.
- **B, typed just after a click on the open thread.** This is what broke the dark-mode test.
  1. You click T1, which is already open.
  2. While the backend answers, you type "make the arrow visible".
  3. The answer arrives with T1's saved draft (empty) and wipes what you typed.

## Implementation criteria (each yes/no)

**I1. `/tree` is off in the app.**
- `apps/desktop/electron/rpc-desktop-driver.ts`: `supportsTree = false`, with a comment giving the reason and Sudhir's words.
- The existing flag then hides `/tree` from the slash menu (`App.tsx`, `allowTreeCommand`).
- The tree dialog, the driver's tree code and the IPC stay in place, unreachable. Nothing is deleted.

Check: the slash menu in a thread no longer lists `/tree`, and `/compact` is still listed. Evidence: Verification Round 1.

**I2. A typed `/tree` is refused.**
- In a thread's chat box, `/tree` + Enter shows the error "/tree is turned off in Alamelu Pi.".
- It opens no dialog and sends nothing to pi. The same applies to `/tree` with arguments.
- The new-thread screen already refuses `/tree`, and stays as it is.

Check: the changed `ux-repair.spec.ts` test (I4) types `/tree`, presses Enter and expects that error, with no tree dialog. Evidence: VR1.

**I3. The tree tests are disabled, not deleted, with the reasons written in the test files.**
- `tests/core/tree-command.spec.ts`: both tests skipped. A comment at the top says:
  - what the tests covered;
  - why `/tree` is off: pi's RPC mode has no in-place branch switch, so the driver used `fork`, which writes a new thread file the app never tracks; the driver ignores the summary choice; and the app's transcript reader shows every branch's messages mixed together;
  - what reviving them would need: today's seeding fails because it writes outside the app's sessions folder and adds no catalog entry; workspaces start collapsed; and the test typed straight after a thread click.
- `tests/live/tree-command.spec.ts`: skipped, with a short comment pointing to the core file.
- The uncommitted probe edits to the tree fixtures and the spec were reverted just before these criteria were written. What they taught goes into that comment instead, so the committed tree fixtures stay as they were.

Check: Playwright reports these tests as skipped, none failed. Evidence: VR1.

**I4. The `ux-repair.spec.ts` test "/tree is offered now that the driver implements it" changes to check that `/tree` is off.**
- It checks that `/tree` is not offered, `/compact` still is, and a typed `/tree` gives the I2 error.
- Without this change it would fail on every run once I1 lands.

Check: it passes. Evidence: VR1.

**I5. Race A is fixed.**
- When you click a thread, `handleSelectSession` first saves any unsaved text for the thread you are leaving (`api.updateComposerDraft`), then selects.
- The save goes to the thread still selected in the backend, which is the one being left.

Check: a throwaway spec, not committed, run before and after the fix. It types in T1, clicks T2 at once, goes back to T1 and expects the text. It also types in T1 and clicks T1 at once, and expects the text. Expected result: fails before the fix, passes after. Evidence: VR1.

**I6. Race B is fixed for the open thread.**
- In the hydrate effect, a "selection" draft sync for the thread already in the box no longer overwrites the box. The box holds the newer text, so it is treated like the existing "persist" and "state" sources.
- A switch to a different thread still loads that thread's draft through the existing key-change branch.

Check: the dark-mode test in `composer-controls.spec.ts` goes back to the plain `selectSession` (no wait), so it is the lasting check. Without the fix that test failed 3 of 3 runs; with it, it should pass 3 of 3. Evidence: VR1.

**I7. One edge stays, and is recorded.** You click a *different* thread and type in the old thread's box during the moment before it loads. That text may be lost; it is ambiguous which thread it belongs to. It needs a very fast typist. One line in the implementation record, no code.

**I8. No regressions.**
- Run: unit tests, typecheck, Electron build and `pnpm run verify:upgrade`.
- Run the core specs that touch drafts or `/tree` before the change (baseline) and after, with the lane settings: `composer-controls`, `composer-draft-sync`, `navigation`, `persistence`, `sidebar-ordering`, `queued-messages`, `timeline-pinning`, `ux-repair`, `compacted-model-switch` and `tree-command`.
- Nothing that passed before fails after. Any that failed before is named.

Evidence: VR1.

**I9. The docs that need updating.**
- `apps/desktop/README.md`, "Test Lanes": a short note that on this Mac the Electron lanes need two settings, `PI_GUI_DRIVER=rpc` and `PI_GUI_BRAND=alpi`. Without them the window never opens ("DesktopAppStore requires an explicit session driver"). With Homebrew pi, the lanes also need `PI_GUI_PI_BIN` set to pi's `dist/cli.js`, because the test helper looks for pi's files next to the launcher and Homebrew's `bin/pi` is a wrapper.
- I found this gap along the way. Without the note the documented `test:e2e:core` command fails on this Mac.
- No user-facing doc describes `/tree`. Only past plan and audit records mention it, and those stay as history.

Evidence: the diff in VR1.

**I10. Rebuild, sign, install.**
1. `pnpm run package:tauri`, then `sign:tauri`.
2. `codesign -dvvv` shows Authority=Alamelu Pi Local Code Signing.
3. Gate 5 records the backend hash. It will change, because `rpc-desktop-driver.ts` is backend code, so the change is recorded, not treated as a failure.
4. The old app is moved aside, the new one installed with `ditto`, and launched in the background (`open -g`).
5. The backend process and `PI_GUI_PI_BIN` are checked.

Gates 1–4 are not run, because no pi, adapter, compaction or model-switch code changes. Evidence: VR2.

**I11. Sudhir's check in the installed app.**
- `/tree` is gone from the menu.
- Text typed quickly before a thread click is kept.
- Up-arrow recall still works.

His words are recorded.

**I12. Persistence.**
- Commit only this change's files and push.
- CI "Native builds" is green.
- After Sudhir's check, the old app copy goes to the Trash.
- The records are committed with `[skip ci]`.

**I13. Repo-memory cards:** none.

## Owner agreement

2026-11-07 ~20:08 IST. Sudhir agreed and widened the scope in one message: "Fix the 7 also. I do not want things hanging because "it was not my fault" Everything here is our baby, sweetheart. We do not want any errors, as far as possible. Go ahead and fix everything." Then, 20:10: "Everything as in the tests and docs, nothing else".

## Owner changed the scope: from "/tree and the race" to "every failing core test" (2026-11-07, his words above)

What triggered it. The 19:59 baseline ran ten core files: 25 passed, 9 failed, 1 skipped. Two failures are the tree tests. The other seven were already failing on this Mac:
- `navigation.spec.ts:14`
- `persistence.spec.ts:49`
- `persistence.spec.ts:149`
- `queued-messages.spec.ts:99`
- `queued-messages.spec.ts:155`
- `timeline-pinning.spec.ts:366`
- `timeline-pinning.spec.ts:418`

Earlier only the files the change touched had been run; the whole core lane never had. That is why failures came in one at a time.

Updated criteria:
- **I8 becomes I8a.** Run the whole core lane, all 31 files, before the change, to get the full list of failing tests. Done in two parts: the ten files above, then the other 21 at 20:10.
- **I14 (new).** Every core test that fails in that baseline is diagnosed. Its cause is written in the implementation record with evidence. It is then fixed so that the app does what the tests and docs say (Sudhir: "Everything as in the tests and docs, nothing else"):
  - Where the app is wrong, fix the app.
  - Where the test is out of date with the app's documented behaviour, fix the test.
  - Nothing beyond what the tests and docs ask.
  - The only tests disabled are the `/tree` ones (I3).
- **I8b.** After the change, the whole core lane runs: 0 failed. The skipped tests are only the `/tree` ones, plus any that skip by design without real logins. Evidence: the final Verification Round.
- **I15 (new).** The live and native lanes are not run. The live lane needs real provider logins and skips cleanly without them. The native lane takes the screen and focus, so it runs only when Sudhir says. This is stated in the report, not left out.

The rest stands. I9 (the docs) also covers any doc a fix shows to be wrong.

### I14 in detail: the full baseline and each test's fix (2026-11-07, after four Opus helpers diagnosed it)

The 31-file baseline at 0f900cc: 37 core tests failed, 52 passed, 1 skipped. That is 9 failed in the ten-file part and 28 in the other 21 files. The production `packaged-smoke` test was matched by name by accident; it is not core, so it is not counted. Each verdict below has evidence in the helpers' notes in `/private/tmp/tree-off-race.6mAjxJ/diag/`, and it is restated in the implementation record.

**App fixes: the app breaks what the tests or docs say.**
- **A1.** `packages/pi-rpc-driver/src/pi-rpc-driver.ts` `assertExistingLabSessionId`: a thread pi has not written yet, because no message was sent, may be opened. Before this, the restart failed with "RPC lab session not found". Tests: `persistence:49`, `unread-state:52`, `reopen-state:16` (the whole sidebar came up empty), and possibly `persistence:149`.
- **A2.** `external-pi-runtime-supervisor.ts` `providerRecord`: use pi's subscription name only when the provider is signed in by subscription, or has no API-key setup. An API-key OpenAI is "OpenAI", not "OpenAI (ChatGPT subscription)". Tests: `provider-settings:14/74/186/236` and `new-thread-composer:258`. Record: alpi_ux_repair §3.5.
- **A3.** `ExternalPiRuntimeSupervisor.refreshRuntime`: turn on the models of signed-in providers when no enabled model can be picked. This step came from the upstream supervisor, and no record dropped it. Test: `new-thread-composer:368`.
- **A4.** The Skills view under RPC is always empty (`skills: []` is hard-wired). Fill it from the skill commands pi already returns. Record: alamelu_tauri_plan.md, "skills/extensions lists load". Test: `skills-settings:6`.
- **A5.** The deferred-title test hook (`generateThreadTitleOverride`) is passed to the store, then dropped. Wire it into the auto-title step; it is used in test mode only, and the product is unchanged. Tests: `new-thread-auto-title` :19, :82, :123, :160 and :194.

**Off by design: disabled with a note that points to the test of the off state, as with `/tree`.**
- **D1.** Worktrees (`supportsWorktrees = false`; alpi_ux_repair §1.4(d); the off state is checked by `ux-repair.spec.ts:22`): `worktrees.spec.ts` ×3 and `new-thread-auto-title:49`.
- **D2.** Queue editing (`supportsQueueEditing = false`; commit 288a725). The file's own header has said "Kept for history; not run" since 13 Sep, but nothing skipped it. The display-only state is checked by `compaction-status.spec.ts:139`. Covers `queued-messages.spec.ts` ×2.
- **D3.** The "no folders yet" screen can never appear, because Alamelu Pi always has the Others (No Repository) folder (alpi_sidebar_no_repository §2; checked by `new-thread-composer:205`). Covers `provider-settings:295`.

**Test fixes: the test is out of date with a recorded decision, or its environment leaks.**
- **T1. Harness.**
  - The harness sets `PI_GUI_BRAND=alpi` unless a spec overrides it. README.md says specs must set it, and 20+ specs never did. The README sentence is updated to match.
  - The fixture helper finds pi's files in Homebrew's layout, so `PI_GUI_PI_BIN` is not needed.
  - `PROVIDER_ENV_VARS` adds the Google Cloud variables. This shell's Google Vertex settings made a provider "connected" in tests.
- **T2. Sidebar starts collapsed** (alpi_sidebar_no_repository). One shared helper expands a thread's workspace. `clickSession` uses it, and so do `navigation:14`, `persistence:149`, `smoke:53`, `unread-state:52` and `timeline-pinning:366/418`; the last two lose their dead `data-collapsed` lines.
- **T3. Display decisions:**
  - `smoke:12`: three "New thread" buttons, and the heading is "Alamelu Pi".
  - `archive:10`: rows have Rename and Archive buttons, and the hover opacity is on `.session-row__actions`.
  - `reopen-state:16`: replies show only when finished, displaying "Preparing response…" meanwhile (commit a8a9832).
  - `compaction-status:52`: the elapsed slot is `.composer__elapsed` (commit 3c02194).
  - `provider-settings:349/402`: "Use subscription", not "Login".
  - `model-scope-toggle:19`: model labels, the badge title, the Others folder in the picker, and the local environment.
  - `new-thread-composer:368`: model labels.
- **T4. Skills tests:** the seeded skills get the `name` and `description` frontmatter pi requires. They get `defaultProjectTrust: "always"`, because pi loads a workspace's skills only when the project is trusted. They get a temporary HOME, because they were reading the real `~/.agents/skills`.

**Raised with Sudhir, not done** (found along the way, outside these tests):
- "Create permanent worktree" in the workspace menu is still enabled, and it errors when clicked. **Moved into this change as I18 (2026-11-08).**
- A workspace's own skills load in the real app only if Sudhir's pi trust settings allow it.
- `/status` clears attachments on screen, but not in the saved file. **Moved into this change as I19 (2026-11-08).**
- ~~Every core test still sees the real HOME, through pi's `~/.agents/skills`. Only the skills tests get a temporary HOME.~~
  - **Done harness-wide instead (2026-11-07 ~20:38; answers audit I1-1).** The first full run showed the `/tree` test picking up Sudhir's real skill `using-git-worktrees` from `~/.agents/skills`. His standing rule is "Tests never touch the real HOME". So `buildDesktopLaunchEnv` now gives every launched app its own HOME inside its user-data folder.
  - This also applies to the live, native and production lanes, which were not run (I15).
- A thread closed in the middle of its first run, whose catalog title is also stale, does not take pi's saved name on reopen (audit I1-5). It matters only if the catalog save is lost, because `RpcDesktopDriver.renameSession` writes the catalog too. The auto-title reopen test waits for the run to end. No code.
- A3 matches `enabledModels` by exact `provider/model` only, as upstream did. pi also allows patterns such as `anthropic/*:high`. With a pattern-only list, a refresh would add all signed-in providers' models to `~/.pi/agent/settings.json` (audit I1-6; once, not on every refresh, as audit I3-2 found). Today his settings have no `enabledModels`, so nothing happens. A one-line guard needs his yes. **Moved into this change as I17 (2026-11-08).**
- With his real skills, `/tree` + Enter picks `/skill:using-git-worktrees` from the slash menu rather than showing the "turned off" error (audit I1-2). Showing the error for an exact `/tree` ahead of the menu is a small change that needs his yes. **Moved into this change as I16 (2026-11-08).**

## Owner changed the scope again: the four raised items are fixed in this change (2026-11-08)

His words, after I listed four raised items with a "Your call" block:
1. "WTF? Are we interested in doing things just because we can? But 3 makes sense. So, may as well fix everything. Using debate-loop. And do NOT tell me things piecemeal. What I do NOT want is another list of 4 items --> do you want to fix these? Also, I am NOT using Alamelu Pi Tauri right now. So, make sure that you finish the entire thing including installation."
2. Then, when I read the first message as dropping items 1 and 2: "No. If you had not suggested 1-4, I would have been OK with 1 and 2. But now that you have done so, fix all 4 at the same time. No, dropping 1 and 2, lol."

So the raised list's four code items move into this change, in the same debate-loop lifecycle (next audit round is 3). Each is yes/no:

- **I16. Exact `/tree` + Enter in a thread shows the "turned off" message** (raised list, audit I1-2).
  - In a thread's box, an exact `/tree` + Enter shows "/tree is turned off in Alamelu Pi.", even when the slash menu holds an entry that contains "tree", such as a skill `using-git-worktrees`. The menu entry is not picked, and the box keeps `/tree`.
  - Nothing else changes: other slash entries, Enter on any other text, and the new-thread box behave as before.
  - Check: `ux-repair.spec.ts`'s `/tree` test also seeds a skill whose name contains "tree" and presses Enter on an exact `/tree`. Evidence: Verification Round 3.
- **I17. The model auto-enable (A3) leaves pattern lists alone** (raised list, audit I1-6).
  - A3 runs only when every `enabledModels` entry is a plain `provider/model`. Per pi's own rules (`dist/core/model-resolver.js`), an entry with `*`, `?` or `[`, one without a `/`, or one ending in a thinking level (`:off` … `:max`) is a pattern. With any such entry, a refresh writes nothing to `settings.json`.
  - A plain list still behaves as before.
  - Check: a unit test in `external-pi-runtime-supervisor.test.mjs` covers both cases, a pattern list (no write) and a plain list with nothing selectable (write); `new-thread-composer:368` still passes. Evidence: VR3.
- **I18. With worktrees off, the workspace menu does not offer "Create permanent worktree".**
  - The other menu items are unchanged. "Remove worktree" still appears only for a linked worktree.
  - Check: `ux-repair.spec.ts`'s worktrees-off test opens the menu of a project workspace and finds no such item. (Corrected 2026-11-08 after audit I3-1: the test uses a plain folder, and the item was never limited to git folders.) Evidence: VR3.
- **I19. Host commands keep the box's attachments, on screen and in the saved file.** This covers `/status`, `/model`, `/thinking`, `/session`, `/name`, `/compact` and `/reload`.
  - The command text is still cleared. The attachments stay for the next message, because a command sends none.
  - This direction, rather than also emptying the saved file, is what the tests already say: `persistence.spec.ts` ×2 expects the attachments to come back after `/status` and a restart.
  - Check: `persistence:49` also checks that both attachments are still on screen right after `/status`. Evidence: VR3.
- **I8b again, after these changes:** the whole core lane, 0 failed. Unit, driver and typecheck pass.
- **I10, I12: unchanged.**
  - The app was not running at 14:01 (checked with `pgrep`), and Sudhir says he is not using it. So the install goes ahead in this change: old copy moved aside, new one in, opened in the background.
- **I11 becomes:** Sudhir checks when he next uses the app. He gets the three earlier checks plus one line each for I16, I18 and I19.
  - Meanwhile I check the installed app myself: its signature, that the backend starts, and `PI_GUI_PI_BIN`.
- **I9:** no user-facing doc describes these four behaviours (grep of README.md, apps/desktop/README.md and documents/*.md at 14:03). The raised list above marks the four as moved here.
- **Not in this change:** the stale-title edge (audit I1-5) is not one of the four. It stays recorded in the raised list above, with no code.
