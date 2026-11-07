# Alamelu Pi Tauri — composer stability + dead-RPC restart — audit

Append-only. Plan audits start at Plan Audit Round 1. POC iterations do not count.

## Plan Audit Round 1 — 2026-09-13 17:25 IST

Phase: plan. Role: critic. Round: 1 of 3 (pre-existing defects window; round 3 is last).
Critic: Claude Fable 5.1 (`claude-fable-5-1`), effort high, Claude Code session `f1b1ddcc-637d-4992-b7da-969552d63171`, run token `alpi-composer-stable-plan-r1-6Z5IFh`.
Artifact reviewed: `documents/plan-audit-implementation/alpi_tauri_composer_stable_plan.md` (entire file), POC note `alpi_tauri_composer_stable_poc.md`, POC working-tree diff (5 files), backup `.poc-composer-stable-20260913/`.
Writes: this file only.

### Restatement

- **Outcome.** Ship the approved composer POC as product behaviour (no dock in the composer, reserved elapsed slot fed by the existing `runningLabel` only while running, transcript wheel-scroll while the composer is focused) and widen the existing Luna idle-child replacement in `PiRpcDriver` to every provider so a dead `pi --mode rpc` pipe never leaves Cursor/Grok/Sol/Terra failing with `RPC client is closed`.
- **Scope.** `/Users/sudhirjha/playground/alamelu-tauri` only. Reuse the POC files; remove the idle demo clock; rename/widen `lunaChildNeedsRotation` / `rotateLunaChildBeforePrompt`; set the flag on `agent_settled`, `endRun` and the benign idle `rpc_transport_closed` path; keep `replaceIdleClient` unchanged; invert the Sol/Terra long-lived-child test; add one dead-pipe test; extend the CI name pattern; Mac candidate build. No Electron, no Windows deploy, no new restart architecture, no mid-run replay, no `pi-cursor-sdk` change, no hiding incomplete-tool cards. Planning only now.
- **Done criteria** (plan "Done when" 1–7): idle slot empty; running slot shows real `runningLabel` with no hint/model/button shift; no dock rendered; wheel over transcript scrolls it while composer focused; second prompt after a dead pipe or a settle uses a fresh same-session child for all providers; existing Luna guards intact; driver + Tauri helper unit tests pass and a signed Mac candidate exists (install only after approval).

### What was verified (claims checked against source before challenging)

- Driver: Luna-only gates confirmed at `pi-rpc-driver.ts:658` (rotate), `:786` (`agent_settled`), `:900` (`endRun`); benign idle transport-closed return at `:763-766` (`isBenignInactiveStreamFailure`, `:1273`); `replaceIdleClient` guards at `:674-715` (same session id, `assertRestoredSessionConfig`, closed/active re-checks, generation bump, old child closed last); `isLunaSession` has no users outside the driver. `RPC client is closed` originates at `rpc-client.ts:96`. The banner "Your next message will restart it" is `apps/desktop/electron/user-facing-errors.ts:48` and reaches the Tauri app because the Tauri backend bundles `electron/tauri-backend-transport.ts` (`scripts/build-tauri-backend.mjs:15`). The plan's driver section is accurate.
- Tests: Sol/Terra test at `rpc-client.test.mjs:1110-1152` (fixed factory client, asserts `factoryCalls === 1`, `closed === false`); Luna reopen / failed-reopen / ordering / config-restore tests at `:1002-1467`. It was introduced by `ae57e89 fix: recover Luna transport without app restart` with no recorded technical reason to keep other providers long-lived, so the owner's inversion has no hidden hazard on record. `compaction-queue.test.mjs` tests V7/V8/V11 will now traverse rotation after Stop, but their harness returns one shared `ScriptedClient` whose `get_state` echoes the adopted session id, so they stay green; they are covered by the plan's `pnpm --filter @alamelu-pi/pi-rpc-driver test` line. Not a finding.
- CI: `native-build.yml:56` and `:112` run `node --test --test-name-pattern="WSL|mapRpcEventToSessionDriverEvents" packages/pi-rpc-driver/test/rpc-client.test.mjs` on both jobs. Claim accurate.
- Composer: `runningLabel` is computed once in `App.tsx:164-199` (`useBusyLabel`) and passed at `:2567`; POC diff matches the plan's Reuse list except for the `.composer__hint` / `.composer__status` CSS it does not mention (see F1). `ExtensionDock` is now rendered nowhere; `ExtensionDialog` still renders from `App.tsx:2588`, so not deleting the module is correct. `composer-surface.tsx:53-55` still declares the optional dock props (plan already calls their removal optional). Backup `RESTORE.md` covers all five changed files.
- Empirical: with the real `main.css` loaded in headless Chromium (script under `/tmp/alpi-composer-stable-plan-r1-6Z5IFh/clipcheck/`), an open `.model-selector__dropdown` inside the POC `.composer__hint` is not hit-testable (`elementFromPoint` on a menu item returns the page background); with `overflow: visible` it returns the item. Same result for `composer__hint new-thread__hint`. `.composer__elapsed` with "Compacting conversation for 12m 34s" measures scrollWidth 184 vs clientWidth 156.

### Findings

**R1-F1 — HIGH — POC hint CSS clips the model and thinking pickers; plan carries it.**
- Owner requirement: done-when 2 ("hint/model/buttons do not shift"), out-of-scope "extra composer chrome"; Codex-style UX is a product feature. The plan's Reuse entry for `main.css` lists only `.composer__elapsed`, the textarea overflow and `.timeline-pane` outline, so the regression would ship as "keep and tidy".
- Evidence: POC diff adds to `.composer__hint` `min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (`main.css` ~`:1288-1294`). The hint is now a flex item of `.composer__status` (blockified, computed `display: block`), and in the new-thread view it is a `div` (`new-thread-view.tsx:284`), so `overflow: hidden` takes effect. `ModelSelector` renders its dropdown inline, no portal (`model-selector.tsx:101-116`), `position: absolute; bottom: 100%` inside `.model-selector { position: relative }` (`main.css:1353-1395`), i.e. inside the clipped box. Hit test above: clipped in both views.
- Consequence: model and thinking-level selection from the composer footer and the new-thread screen is invisible/unclickable after this ships.
- Smallest remedy: in the plan's `main.css` item, state that `.composer__hint` keeps at most `min-width: 0; white-space: nowrap` and drops `overflow: hidden; text-overflow: ellipsis` (the fixed elapsed slot already prevents seconds-driven shifting). Add "open the model picker and thinking picker from the composer footer and from New thread" to the Mac inspect list.

**R1-F2 — MEDIUM — 26ch slot silently truncates the compaction label.**
- Owner requirement: done-when 2 ("the same slot shows the real `runningLabel`"); ruling "keep the 26ch reserved slot" was about non-shifting, with 26ch being the POC's number.
- Evidence: `runningLabel = useBusyLabel(compactingSince ?? runningSince, compactingSince ? "Compacting conversation" : "Working")` (`App.tsx:552-557`); longest value "Compacting conversation for 59m 59s" is 35 characters. `.composer__elapsed` is `width: 26ch; white-space: nowrap; overflow: hidden` with no ellipsis. Compaction (automatic inside a run, or manual) sets status running (`compaction-queue.test.mjs` V4 asserts it), so `isRunning` routes it into the slot. Measured overflow 184 px vs 156 px.
- Consequence: during every compaction the footer shows a cut-off label such as "Compacting conversation fo", with no indication.
- Smallest remedy (owner decision required on which): (a) size the slot to the longest real label (36ch) — one CSS number, keeps the fixed-slot design, costs ~10ch more idle whitespace; or (b) keep 26ch and route a shorter compaction wording into the slot only (e.g. "Compacting for 59m 59s", 22ch) while the header keeps the long form. Recommend (a).

**R1-F3 — MEDIUM — wheel hand-off overrides nested scrollers and anything overlapping the pane rectangle.**
- Owner requirement: done-when 4 and repo rule "transcript/timeline behaviour … are product features". Plan: "Keep the scroll hand-off."
- Evidence: the POC handler (`conversation-timeline.tsx` diff, capture-phase `window` wheel listener) fires whenever the composer textarea is focused and the pointer is inside `pane.getBoundingClientRect()`, then calls `preventDefault()` and applies `deltaY` to the pane. It does not check the event target. Inside the pane there are independent scrollers: `.timeline-tool__body { overflow-y: auto }` (`main.css:603`, rendered `timeline-item.tsx:180`), `.message__content pre { overflow: auto }` (`:1113`), `.message__content table { overflow-x: auto }` (`:3626`). The model dropdown opens upward over the pane area (`z-index: 20`), and WebKit does not move focus to a clicked button, so the textarea stays `activeElement` while it is open.
- Consequence: with the composer focused (the normal state after sending), wheel over a tall tool output or code block scrolls the whole transcript instead of the block, horizontal wheel over a wide code block or table is cancelled, and wheel over the open model list scrolls the transcript behind it. Pre-POC these worked once the pane had been clicked.
- Smallest remedy: in the same handler, (a) replace the rectangle test with `pane.contains(event.target)`; (b) return without `preventDefault` when an ancestor of the target inside the pane can itself scroll in the wheel direction (`scrollHeight > clientHeight` for `deltaY`, `scrollWidth > clientWidth` for `deltaX`, overflow `auto`/`scroll`). Same file, no new module.

**R1-F4 — MEDIUM — no real-surface verification of dead-child recovery for the newly covered providers.**
- Owner requirement: repo `AGENTS.md` "Desktop work is not done until it is verified on the real [desktop] surface, not only by unit tests"; done-when 5.
- Evidence: the plan's verification is fake-client unit tests plus "Packaged signed candidate is built for Mac inspect" with no stated inspection steps. `replaceIdleClient` has real-run proof only for Luna (owner history). For Cursor (`pi-cursor-sdk`), Grok, Sol and Terra there is no evidence that a fresh child's `get_state` reports the same provider/model/thinking as the record; a mismatch throws (`assertRestoredSessionConfig`, `pi-rpc-driver.ts:1340-1350`) and surfaces as "Restarting this thread's engine hit a mismatch" (`user-facing-errors.ts:56-58`).
- Consequence: because the flag is now set after every settle/end for every provider, an unverified mismatch would turn a rare "RPC client is closed" into a failure on every second prompt for that provider. That is worse than today and only a real run can exclude it.
- Smallest remedy: add to the plan's Build/deploy step a short manual checklist on the Mac candidate before install: for one Cursor thread, one Grok thread and one Sol/Terra thread — prompt → settle → second prompt succeeds; prompt → settle → kill the thread's `pi --mode rpc` child → next prompt succeeds with no `RPC client is closed`. Plus one composer pass: label ticks without hint shift during a run; wheel over the transcript while focused. Verification only, no code.

**R1-F5 — LOW — widen list misses `prepareIdleLunaClientForMutation`.**
- Evidence: `pi-rpc-driver.ts:646` gates every idle mutation (`setSessionModel`, thinking, compact, `:411-523`) through the rotation and keeps "Luna" in its name after the widening; the plan renames only the flag and `rotateLunaChildBeforePrompt`.
- Smallest remedy: add the rename (e.g. `prepareIdleClientForMutation`) to the widen list. Behaviour is unchanged.

**R1-F6 — LOW — `overflow-y: hidden` exposes the new-thread 260/220 mismatch.**
- Evidence: `new-thread-view.tsx:128` calls `fitComposerTextarea(composer, 260)`; its textarea sits inside `.new-thread__composer composer` (`:174`) so the shared `.composer textarea { max-height: 220px; overflow-y: hidden }` (`main.css:1239-1241`) applies, and `.new-thread__textarea` (`:2162`) sets no max-height. The helper switches to `auto` only at `nextHeight >= 260`, which CSS never lets it reach visibly; between 220 and 260 px of content the last line is clipped with no scroll. Pre-POC `overflow-y: auto` masked the mismatch. `App.tsx:1412` passes 220 for the main composer, consistent.
- Smallest remedy: pass 220 in `new-thread-view.tsx` (one token), noted in the plan's `composer-height.ts` item.

**R1-F7 — LOW — CI pattern extension has no Windows fallback stated.**
- Evidence: the Luna reopen tests build drivers with POSIX lab paths (`/tmp/alamelu-pi-rpc-…`, `/Users/example/…`) and have never run on the Windows job; `validateLabPaths` (`path-guards.ts:73`) canonicalises with `fs.realpathSync.native` and containment checks whose Windows outcome is untested. The new rotation/dead-pipe tests will follow the same shape.
- Smallest remedy: one line in the Tests section — if the Windows job rejects the lab paths, the new tests use `os.tmpdir()` like `compaction-queue.test.mjs` does, or the pattern extension is Mac-only; no Pi install on the runner either way.

### Not raised (checked and fine, or out of scope)

- Compaction-queue V-tests under rotation (see verification). Cursor "shell did not complete" card: out of scope, untouched. Per-prompt child restart cost for all providers: owner ruling, not re-litigated. Benign idle `rpc_transport_closed` flag: plan's addition is needed for never-prompted sessions (`suppressRunEvents` unset), correct as written.

### Verdict

**REVISE.** 1 HIGH (F1), 3 MEDIUM (F2, F3, F4), 3 LOW (F5–F7). PASS requires zero HIGH/MEDIUM and no unresolved owner decision; F2 needs an owner ruling on slot width vs. label wording. All remedies stay inside the plan's existing files and verification steps; none adds modules, tests frameworks or architecture.

## Builder Response to Plan Audit Round 1 — 2026-09-13

Plan updated in place. No new modules, no Playwright, no `pi-cursor-sdk`.

- **R1-F1 Accepted.** `.composer__hint` drops `overflow: hidden` and `text-overflow: ellipsis`. Mac inspect now includes opening model and thinking pickers on the session footer and New thread.
- **R1-F2 Accepted as (a).** Not parked for the owner. Done-when 2 already requires the real `runningLabel` to show. 26ch was a POC number for `Working for Ns`. Slot is 36ch so `Compacting conversation for 59m 59s` fits. No new compaction copy.
- **R1-F3 Accepted.** Wheel hand-off only when `pane.contains(event.target)`, and nested pane scrollers keep the event when they can scroll in that direction.
- **R1-F4 Accepted.** Manual Mac checklist added: Cursor, Grok, and Sol/Terra second-prompt plus kill-child recovery; composer picker/timer/wheel pass. Verification only.
- **R1-F5 Accepted.** `prepareIdleLunaClientForMutation` → `prepareIdleClientForMutation`.
- **R1-F6 Accepted.** New-thread `fitComposerTextarea` cap is 220.
- **R1-F7 Accepted.** New/inverted driver tests use `os.tmpdir()` lab roots.

No Owner decision required remains. Ready for Plan Audit Round 2.

## Plan Audit Round 2 — 2026-09-13 17:32 IST

Phase: plan. Role: critic. Round: 2 of 3 (pre-existing defects window; round 3 is last).
Critic: Claude Fable 5.1 (`claude-fable-5-1`), effort high, Claude Code session `f1b1ddcc-637d-4992-b7da-969552d63171`, run token `alpi-composer-stable-plan-r2-BDBCXI`.
Artifact reviewed: revised `alpi_tauri_composer_stable_plan.md` (entire file), this audit (entire), POC note (unchanged, md5 `d64d5c6b…`), POC working tree (unchanged since Round 1: same 5 files, 106+/36−), owner brief with Round 1 rulings.
Writes: this file only.

### Restatement

Unchanged from Round 1. Outcome: ship the approved composer POC as product behaviour and widen the existing Luna idle-child replacement to every provider. Scope: Tauri repo only; reuse POC files; remove the idle demo clock; 36ch reserved slot fed by the real `runningLabel` while running; no dock in the composer; wheel hand-off with target containment and nested-scroller guard; driver flag/rename widening with `replaceIdleClient` untouched; invert Sol/Terra test, add one dead-pipe test on `os.tmpdir()` roots; extend the CI name pattern; Mac candidate with the inspect checklist before install. Out of scope unchanged (pi-cursor-sdk card, Electron, Windows deploy, new restart architecture, mid-run replay). Done criteria 1–7 unchanged in wording.

### Round 1 remedies — confirmed in the plan text

- R1-F1: `main.css` item — `.composer__hint` "must drop `overflow: hidden; text-overflow: ellipsis`"; inspect checklist opens model and thinking pickers on the session footer and New thread. Present.
- R1-F2: 36ch in Owner rulings, `main.css` item and Production fix 1; done-when 2 unchanged (real `runningLabel`). Present. Accepted by the owner as 36ch; no decision outstanding.
- R1-F3: `conversation-timeline.tsx` item — `pane.contains(event.target)` and "if an ancestor of the target inside the pane can scroll in that wheel direction … do not `preventDefault`"; Production fix 3 references it; inspect checklist includes "wheel over a tall tool/code block still scrolls that block". Present.
- R1-F4: Build/deploy inspect list — composer pass and dead-child pass for Cursor, Grok, Sol/Terra (second prompt; kill child then prompt). Present.
- R1-F5: `prepareIdleLunaClientForMutation` → `prepareIdleClientForMutation` in the widen list. Present.
- R1-F6: `composer-height.ts` item — `new-thread-view.tsx` must pass 220. Present.
- R1-F7: Tests — new/inverted tests use `os.tmpdir()` lab roots like `compaction-queue.test.mjs`. Present.

None re-raised. No revision-introduced regression in the driver, test or CI sections.

### Complete-scope re-review (what was checked this round)

- No other wheel handlers exist besides the pane's passive pin-release listener (`App.tsx:817-826`) and the `stopPropagation` handlers on the model dropdown, slash and mention menus; the guarded hand-off does not interfere with them (capture listener never stops propagation; the menus are in-flow inside the composer, outside the pane).
- Reachable thread-column widths: window `minWidth` 1200 (`src-tauri/tauri.conf.json:19`); sidebar 240–620 (`App.tsx:130-132`); with the diff panel open the main area is `grid-template-columns: 1fr 400px` (`main.css:22-24`) and `.main` is `overflow: hidden` (`:18`). So the composer column can be 580 px (sidebar at max) or about 508 px (default sidebar plus diff panel) at the minimum window size.
- Empirical layout with the real `main.css` plus the plan's CSS (36ch slot; hint without overflow hidden), headless Chromium, script under `/tmp/alpi-composer-stable-plan-r2-BDBCXI/layout/`: see R2-F1.

### Findings

**R2-F1 — MEDIUM — no-wrap hint plus the reserved slot make the footer row wider than the composer at reachable widths; action buttons get clipped.**
- Owner requirement: done-when 2 ("hint/model/buttons do not shift") and the product rule that Codex-style UX is a feature. The revised `main.css` item says `.composer__hint` "may keep `min-width: 0; white-space: nowrap`".
- Evidence: `white-space: nowrap` (POC-added) makes the hint's min-content width its full single-line text; `.composer__footer` is a grid (`main.css:1254`), so the row cannot be narrower than that min-content plus the fixed slot and the actions, and it overflows instead of shrinking. Measured, running state ("Enter to queue · Cmd+Enter to steer · gpt-5.6-terra · xhigh", slot 36ch = 216 px): row right edge 645 px in a 508 px and in a 580 px column (row needs ≈ 673 px incl. composer padding); fits only from ≈ 675 px. Pre-POC the hint wrapped (no `nowrap`), so the row always fit. 36ch (R1-F2) adds ≈ 60 px to the threshold versus the POC's 26ch but is not the cause. Not a re-raise: R1-F1 was dropdown clipping, R1-F2 slot width; this is row overflow.
- Consequence: with the sidebar dragged wide, or with the diff panel open at the minimum window size, the Send/Stop and attach buttons are pushed past the composer box and clipped by `.main { overflow: hidden }`. This is a defect the revision would ship, since the plan explicitly permits `nowrap`.
- Smallest remedy: change the `main.css` item so `.composer__hint` also drops `white-space: nowrap` (keep `min-width: 0`). Measured with that single change: row right edge 480 px in a 508 px column and 552 px in a 580 px column; the hint wraps to a second line (row height 54 / 34 px) and, because the slot is fixed-width, the wrap point does not move when seconds change. No new CSS; one line removed.

### Not raised

- Root cause of the original "wheel dies while the composer is focused" is not identified in the tree; the plan's guard defers to the nested scroller's default action, and the inspect item "wheel over a tall tool/code block still scrolls that block" is the right place to confirm that on the real surface. No plan change needed.
- Inverted Sol/Terra test: the fixed fake client already answers `get_state` with the same `terra-session` id, so the replacement path can be asserted with a second factory call and the first client closed. Test-design detail, left to implementation.
- Out-of-scope items untouched by the revision: `pi-cursor-sdk` card, Electron, Windows deploy, restart architecture.

### Verdict

**REVISE.** 0 HIGH, 1 MEDIUM (R2-F1), 0 LOW. No owner decision outstanding. The remedy is one CSS declaration removed in an item the plan already edits; once the plan says the hint drops `white-space: nowrap`, nothing else in this audit blocks PASS.

## Builder Response to Plan Audit Round 2 — 2026-09-13

- **R2-F1 Accepted.** `.composer__hint` also drops `white-space: nowrap`. Hint may wrap. Reserved 36ch slot still prevents seconds-driven horizontal shove. Send/Attach stay in the composer at reachable widths.

Ready for Plan Audit Round 3.

## Plan Audit Round 3 — 2026-09-13 17:36 IST

Phase: plan. Role: critic. Round: 3 of 3 (last round for pre-existing defects; later findings need a builder-introduced regression with causal evidence).
Critic: Claude Fable 5.1 (`claude-fable-5-1`), effort high, Claude Code session `f1b1ddcc-637d-4992-b7da-969552d63171`, run token `alpi-composer-stable-plan-r3-z4sfst`.
Artifact reviewed: revised `alpi_tauri_composer_stable_plan.md` (entire file), this audit (entire), POC note (unchanged, md5 `d64d5c6b…`), POC working tree (unchanged since Round 1: same 5 files, 106+/36−), owner brief.
Writes: this file only.

### Restatement

Unchanged from Rounds 1–2. Outcome: ship the approved composer POC as product behaviour and widen the existing Luna idle-child replacement in `PiRpcDriver` to every provider. Scope: Tauri repo only; reuse the POC files; remove the idle demo clock; 36ch reserved slot fed by the real `runningLabel` only while running; no dock in the composer; wheel hand-off with `pane.contains(target)` and nested-scroller guard; hint drops overflow/ellipsis/nowrap; new-thread cap 220; driver flag and three renames widened to all providers with `replaceIdleClient` untouched; Sol/Terra test inverted plus one dead-pipe test on `os.tmpdir()` roots; CI name pattern extended; Mac candidate inspected per checklist before install. Out of scope unchanged. Done criteria 1–7 unchanged.

### Round 2 remedy — confirmed in the plan text

- R2-F1: `main.css` item now reads that `.composer__hint` "may keep `min-width: 0` and must drop `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`", with the reason (dropdowns visible; Send/Attach fit at reachable widths) and "wrapping the hint is allowed". Present and matches the accepted remedy. Round 2 measurement already showed that with wrapping the row fits at 508 px and 580 px and the fixed slot keeps the wrap point stable as seconds change.

### Complete-scope re-review

- Diff between the Round 2 and Round 3 plan is that one sentence; no other section changed, so no regression can have been introduced in the driver, tests, CI or build sections. Re-read in full regardless.
- Done-when 2 with a wrapping hint: the hint's available width is fixed by the 36ch slot, so label changes cannot move the wrap point; the criterion still holds.
- Rounds 1–2 findings R1-F1…F7 and R2-F1: all accepted and present; none re-raised.
- No pre-existing defect remains unraised within the plan's scope. Items previously listed under "Not raised" (compaction-queue tests traversing rotation with the shared fake client; unknown root cause of the original wheel symptom, covered by the inspect checklist; per-prompt child restart cost, owner ruling) stand.

### Findings

None.

### Verdict

**PASS.** 0 HIGH, 0 MEDIUM, 0 LOW. No owner decision outstanding. The plan matches every accepted remedy, stays inside the owner's scope, and adds no modules, frameworks or architecture. Implementation may start only after the owner's explicit approval, per the plan's own gate.

## Implementation Audit Round 1 — 2026-09-13 18:55 IST

Phase: implementation. Role: critic. Round: 1 of 3 (pre-existing defects window; round 3 is last).
Critic: Claude Fable 5.1 (`claude-fable-5-1`), effort high, Claude Code session `1d71101f-591e-4537-a79c-bace3a478c35`, run token `alpi-composer-stable-impl-r1-YEPOPP`.
Artifact reviewed: working tree against `HEAD` (`74d801e`) for every in-scope file; `alpi_tauri_composer_stable_implementation.md` (entire, incl. Verification Round 1); `alpi_tauri_composer_stable_plan.md` (entire, PASS at Plan Audit Round 3); this audit (entire); POC note; owner brief for implementation (approved 2026-09-13).
Writes: this file only. Scratch under `/tmp/alpi-composer-stable-impl-r1-YEPOPP/`.

### Restatement

- **Outcome.** Ship the approved composer POC as product behaviour (no dock rendered in the composer; 36ch reserved elapsed slot that shows the real `runningLabel` only while running and is empty when idle; transcript wheel-scroll while the composer textarea is focused, with target containment and a nested-scroller guard), and widen the existing Luna idle-child replacement in `PiRpcDriver` to every provider so a dead `pi --mode rpc` pipe or a settled run never leaves the next idle prompt failing with `RPC client is closed`.
- **Scope.** `alamelu-tauri` only. Composer: `composer-panel.tsx`, `composer-surface.tsx`, `composer-height.ts`, `new-thread-view.tsx` (cap 220), `conversation-timeline.tsx`, `main.css` (hint keeps `min-width: 0`, drops overflow/ellipsis/nowrap), `App.tsx` unchanged. Driver: three renames, drop the `isLunaSession` gate, set the flag on `agent_settled`, `endRun` and the benign idle `rpc_transport_closed` return, `replaceIdleClient` untouched, `isLunaSession` deleted. Tests: invert Sol/Terra, add one dead-pipe case, both on `os.tmpdir()`; keep Luna reopen / failed-reopen / mutation-ordering; extend the CI name pattern. Excluded: Playwright, `pi-cursor-sdk`, Electron, Windows deploy, new restart architecture, new workflow, Mac package/sign/inspect/install (after implementation PASS).
- **Done criteria** (plan "Done when" 1–7): reviewed 1–6 in code and 7's test half; 7's packaged candidate is a post-PASS step and was not demanded this round per the owner brief.

### Plan items confirmed in the code (complete scope, not only the diff)

- Idle demo clock removed: no `pocStartedAt` / `pocElapsed` / ticker in `composer-panel.tsx`; `elapsedLabel = isRunning ? runningLabel : ""` fills `<span class="composer__elapsed">`; `runningLabel` still comes from the single `useBusyLabel` in `App.tsx:164-183` and is passed at `:2567`. No second timer. Done-when 1.
- Slot: `.composer__elapsed { flex: 0 0 36ch; width: 36ch; tabular-nums; nowrap; overflow: hidden }` (`main.css:1274-1283`). Measured with the real stylesheet in headless Chromium (`/tmp/…/layout/run.mjs`): slot 216 px; "Compacting conversation for 59m 59s" scrollWidth − clientWidth = 0 (fits); across "Working for 9s" → "Working for 10s" → compaction label the hint left, both model badges and the actions block keep identical coordinates at 508, 580, 700 and 900 px columns. Done-when 2.
- Hint: `.composer__hint { color; font-size; min-width: 0 }` only (`:1285-1289`); no `overflow`, `text-overflow` or `white-space`. Row right edge 480 px in a 508 px column and 552 px in 580 px (Send/Attach inside the box, R2-F1 remedy holds); an open `.model-selector__dropdown` item inside the hint is returned by `elementFromPoint` (R1-F1 remedy holds).
- Dock: `composer-surface.tsx` no longer imports or renders `ExtensionDock`; `composer-panel.tsx` accepts the three dock props as `_`-prefixed unused bindings; `ExtensionDialog` still renders from `App.tsx:2588`; `extension-session-ui.tsx` intact. Done-when 3. Prop cleanup left optional, as the plan allows.
- Textarea: `.composer textarea { max-height: 220px; overflow-y: hidden }`; `fitComposerTextarea` sets `overflowY` to `auto` only at `nextHeight >= maxHeight`; `new-thread-view.tsx:128` passes 220; unit test asserts hidden at 80 px and auto at the cap.
- Wheel: capture-phase `window` listener in `conversation-timeline.tsx:183-205`; fires only when `document.activeElement` is a textarea inside `footer.composer` and `pane.contains(event.target)`; `nestedPaneScrollerKeepsWheel` walks target → pane ancestors and returns without `preventDefault` when one has `overflow` auto/scroll on the dominant axis and room to move that way; otherwise `preventDefault` + `pane.scrollTop += deltaY`. Propagation is not stopped, so the pane's passive pin-release wheel listener (`App.tsx:817-826`) and `onScroll` still run. `tabIndex={-1}` on the pane; `.timeline-pane { outline: none }`. Done-when 4 as specified (real-surface confirmation stays on the post-PASS inspect list).
- Driver: `childNeedsRotation` (`:81`), `rotateChildBeforePrompt` gated only by the flag (`:657-658`), `prepareIdleClientForMutation` at the same seven call sites (`:411, :422, :433, :458, :496, :523, :646`), flag set at `agent_settled` (`:787`), `endRun` (`:901`) and the benign idle stream-failure return (`:764`); `replaceIdleClient` (`:674-716`) byte-identical apart from the flag name; `isLunaSession` deleted, no remaining references in `.ts/.tsx/.mjs/.yml` (only historical audit/plan docs mention the old names). Ordering check: `suppressRunEvents` short-circuits before the benign branch, which is correct because every path that sets `suppressRunEvents` (`endRun`) already sets the flag; a never-prompted session (no `suppressRunEvents`) reaches the benign branch and is now marked. Failed replacement still keeps the old child, sends no prompt, and leaves the flag set for the next attempt. Done-when 5 and 6.
- Tests: Terra inversion asserts first child closed and prompts split FIRST/SECOND; dead-pipe (Grok) emits `agent_settled` then `rpc_transport_closed`, throws `RPC client is closed` on any second prompt to the dead child, asserts the second prompt reaches FRESH. Both use `fs.mkdtempSync(path.join(os.tmpdir(), …))` with `t.after` cleanup. Luna tests at `:1002, :1053, :1224, :1278, :1395, :1496` unchanged.
- CI: both jobs' pattern is `WSL|mapRpcEventToSessionDriverEvents|reopen|rotat|dead-pipe|tainted Luna`; no new workflow, no Pi install.

### Verification (re-run by the critic, matching Verification Round 1)

```
pnpm --filter @alamelu-pi/pi-rpc-driver test                       → 75 pass, 0 fail
node --test --test-name-pattern="WSL|…|tainted Luna" …/rpc-client.test.mjs → 11 pass, 0 fail
pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci           → 4 pass, 0 fail
pnpm --filter @alamelu-pi/desktop run typecheck                    → exit 0 (renderer + electron tsconfigs)
```

The typecheck was not in Verification Round 1; it covers the in-scope claim that the unused `_extensionDock` bindings and the removed `ExtensionDock` import compile, so it is added here rather than demanded of the builder.

### Findings

**I1-F1 — LOW — CI pattern also sends six POSIX-path Luna tests to the Windows job, unverified there.**
- Owner requirement: plan Tests — "extend the existing `rpc-client.test.mjs` name pattern so the rotation / dead-pipe tests run on Mac and Windows jobs. New/inverted tests use `os.tmpdir()` lab roots … so Windows does not fail on `/tmp/...` paths" (accepted R1-F7).
- Evidence: `reopen`, `rotat` and `tainted Luna` match the pre-existing tests at `rpc-client.test.mjs:1002, :1053, :1224, :1278, :1395` which construct the driver with `/tmp/alamelu-pi-rpc-*` and `/Users/example/...` literals. None of these has ever run on either CI job (old pattern was `WSL|mapRpcEventToSessionDriverEvents`). Reading `path-guards.ts`: `canonicalizePath` falls back to the nearest existing ancestor, containment is checked on the resolved drive-letter paths, and `createSession` with a fake factory performs no filesystem writes (`fs` use in the driver is confined to session listing/reopen, `:935-989`), so they should pass on `windows-latest`. That is a reading, not a run; the plan's stated intent was to keep POSIX-path tests off Windows.
- Consequence: if the reading is wrong, the Windows job goes red on the first push and its NSIS artifact is not produced. No product behaviour is affected.
- Smallest remedy: no code change now. Record in the implementation doc that the first push after PASS must show a green Windows job before the Mac install step, and if it is red, narrow both jobs' pattern to `Terra child|dead-pipe` (matches exactly the two `os.tmpdir()` tests). Either way stays inside the existing workflow.

### Not raised (checked; no finding)

- The dead-pipe test cannot detect a regression of the benign-branch flag on its own because `agent_settled` sets the same flag first; the branch was verified by reading (`:761-766`). A never-prompted-session variant would isolate it, but the plan specified this test's shape and no extra tests were asked for. Raised as information only; no change required.
- `ComposerPanelProps` still requires the three dock props and `App.tsx:2583-2585` still passes them; `ComposerSurfaceProps` still declares them and imports `type ExtensionDockModel`. The plan makes this cleanup optional. Typecheck passes.
- Four Electron-only Playwright live specs (`tests/live/extension-dock*.spec.ts`, `extensions*.spec.ts`) reference the dock test ids the composer no longer renders. They need Electron plus Pi, are not in CI, and Electron/Playwright are excluded by the owner. Outside this plan.
- Idle vs running hint text differs ("Enter to send · Shift+Enter for newline" vs "Enter to queue · Cmd+Enter to steer"), so badges move on state change; that is pre-existing wording, not a seconds-driven shift.
- `formatBusyLabel` returns "Working…" until `runningSince` is set; the old hint showed the same string. Unchanged behaviour.
- `alpi_tauri_ui_attach_implementation.md` diff is a CI-run note for the previous feature, another stream; untouched.
- Real-surface items (pickers, tick without shove, wheel over tool/code blocks, Cursor/Grok/Sol-or-Terra second-prompt and kill-child recovery incl. the `assertRestoredSessionConfig` risk from R1-F4) remain on the post-PASS Mac inspect list per the owner brief and were not demanded here.

### Verdict

**PASS.** 0 HIGH, 0 MEDIUM, 1 LOW (I1-F1, remedy is a deploy-gate note, no code). Every plan item is present in the code; relevant verification re-run green; no owner decision outstanding. Next: builder records the I1-F1 gate in the implementation doc, then Mac package/sign/inspect per the plan checklist; install to `/Applications` only after the owner's approval of that inspection.

## Builder Response to Implementation Audit Round 1 — 2026-09-13

- **I1-F1 Accepted as a note, not as a Mac-install blocker.** Implementation doc now records: on the first push after this work, both CI jobs must stay green; if Windows is red, narrow both jobs' pattern to `Terra child|dead-pipe`. Owner already ruled Windows deploy is later and Mac install follows implementation PASS. The six POSIX-path Luna tests are a later-push CI risk, not a product defect.

Implementation Audit PASS. Closing this critic lifecycle. Mac package/sign/inspect next.
