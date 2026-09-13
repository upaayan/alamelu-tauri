# Composer footer, wrap reserve, thinking accept — audit

Critic: Codex gpt-6-astra / high. Plan audits start at Plan Audit Round 1.

## Plan Audit Round 1

- Phase: plan. Role: critic. Numeric round: 1.
- Actual model: `gpt-6-astra`. Reasoning effort: `high`.
- Session ID: `01a09bc1-f8a2-7c22-b067-ea9f5a504706`.
- Reviewed the complete plan, supplied owner brief and history, global/project instructions, Codex-local `debate-poc-loop` criteria, and relevant current source/POC evidence. No earlier findings or owner responses exist in this audit.

### Outcome, scope, and done criteria

Review only the three approved changes: left-aligned session hint/model/thinking followed by an empty-or-running reserved 36ch time slot with horizontal breathing room and stable right-side actions; a 72px session textarea well that grows after filling and caps at 220px; and accepting Pi's reported thinking level after successful replacement state retrieval while preserving provider/model mismatch errors. Implementation verification must cover the relevant existing unit lanes and the approved live Tauri smoke after rebuild, including `xai-i2o` / `grok-4.6` / requested `xhigh` without a thinking-mismatch banner. This is a plan audit, not implementation, rebuilding, installation, or an expansion into other composer/runtime behavior.

### Findings

#### CFWT-P1-01 — medium — Planned shared min-height edit also changes new-thread

- **Owner requirement:** The approved wrap change concerns the session composer. The plan's own done criterion (line 27) says new-thread remains unchanged at its existing 120px minimum.
- **Evidence/consequence:** `apps/desktop/src/styles/main.css:1230` defines `.composer textarea` with `min-height: 24px` at line 1239. Its specificity is `(0,1,1)`, higher than `.new-thread__textarea` at line 2159, specificity `(0,1,0)`, whose declared minimum is 120px. `apps/desktop/src/new-thread-view.tsx:175` places the new-thread surface inside `className="new-thread__composer composer"`; line 213 passes `new-thread__textarea` to the textarea rendered by `composer-surface.tsx:324`. Thus the later 120px declaration does not win today. Following plan line 34 literally changes the effective new-thread CSS minimum from 24px to 72px as well as changing the session composer, and does not satisfy the claimed preservation of 120px.
- **Smallest remedy:** Keep the shared 24px declaration and add the 72px minimum under a session-only selector, for example `.composer:not(.new-thread__composer) textarea`. Correct the plan's claim that 120px is the current effective minimum; describe preserving existing new-thread behavior instead. This prevents this task from changing new-thread and needs no helper changes or additional tests. Making new-thread actually use 120px would be a separate behavior correction requiring an owner ruling; that correction is **not required for PASS**.

### Other scope checks and verification

- **Footer:** `composer-panel.tsx:174–196` currently renders elapsed before hint inside the flexible status area, followed by the actions block. The planned order change removes the left reservation. `main.css:1274` already fixes elapsed flex-basis/width at 36ch and uses tabular numerals; preserving those rules and adding the requested spacing is consistent with the brief. No additional footer finding.
- **Wrapping:** `composer-height.ts` reads actual scroll/client height, respects the supplied 220px cap, and relies on CSS for minimum height. The proposed session-only CSS minimum can supply the reserve without changing the helper. Existing helper assertions use plain object dimensions and need not change solely because of CSS. No additional wrap finding.
- **Thinking:** `pi-rpc-driver.ts:681–688` already checks successful `get_state`, session identity, and restored configuration. Lines 706–707 merge the reported configuration into the snapshot. `sessionConfigFromState` preserves a reported thinking string; removing only the thinking comparison at lines 1344–1346 leaves provider/model throws intact. Existing fake-client replacement cases in `test/rpc-client.test.mjs` provide the planned test pattern. No thinking finding.
- Confirmed both planned unit commands exist in their package scripts. Source/plan consistency review completed; no application tests, rebuild, or live smoke were run in this planning-only round. Those remain implementation verification, as the plan explicitly states.
- No speculative hardening, extra files to modify, extra tests, or unresolved owner decision are required by this audit. Only this audit artifact and the requested heartbeat were written.

### Builder response Round 1

- **CFWT-P1-01 Accepted.** Plan now keeps the shared `.composer textarea` min-height at 24px and puts the 72px well on `.composer:not(.new-thread__composer) textarea`. Done-when 3 no longer claims new-thread is effectively 120px; it says new-thread height behavior is unchanged. No extra tests.

### Verdict: REVISE

One medium finding; zero high and zero low findings. The plan does not yet meet the skill's PASS threshold. Resolve CFWT-P1-01 within the approved session-composer scope and submit the revised plan for review.

## Plan Audit Round 2

- Phase: plan. Role: critic. Numeric round: 2.
- Actual model: `gpt-6-astra`. Reasoning effort: `high`.
- Session ID: `01a09bc1-f8a2-7c22-b067-ea9f5a504706` (continued critic).
- Re-read the required global/project instructions, entire revised plan, entire audit including Builder response Round 1, binding owner brief/history, and relevant current source evidence. Applied the previously read Codex-local `debate-poc-loop` criteria.

### Outcome, scope, and done criteria

The plan covers only: (1) left-aligned session hint/model/thinking followed by a reserved 36ch elapsed slot, empty while idle and filled while running, with space on both sides and stable right-side actions; (2) a session-only 72px textarea well, growth after filling, and the existing 220px cap with overflow at the cap; (3) quietly accepting Pi's reported thinking after successful replacement `get_state`, retaining provider/model mismatch throws and using the returned thinking in the snapshot. New-thread behavior remains unchanged. Done requires the planned relevant unit checks and, after implementation approval/rebuild, the real Tauri footer/wrap checks and `xai-i2o` / `grok-4.6` / requested `xhigh` smoke without a thinking-mismatch banner. This round audits the plan only; no implementation, rebuild, installation, Playwright, or additional behavior is required now.

### Prior finding disposition

**CFWT-P1-01 — medium — Resolved.** The revised Files section explicitly retains the shared `.composer textarea` minimum at 24px, adds 72px only under `.composer:not(.new-thread__composer) textarea`, and leaves `.new-thread__textarea` alone. Done-when 3 now preserves new-thread behavior without claiming an effective 120px minimum. Source confirms the session root is `<footer className="composer">` (`composer-panel.tsx:130`), while the new-thread root includes `new-thread__composer` (`new-thread-view.tsx:175`). The proposed selector therefore addresses the approved session surface without changing new-thread. The accepted response fully resolves the finding; it is not reopened.

### Complete-scope verification

- **Footer:** Rechecked `composer-panel.tsx:123–124,174–196` and `main.css:1266–1289,1470–1474`. The elapsed label is already empty when idle; its 36ch flex reservation and tabular numerals already exist. Moving it after the hint, preserving the actions block, and adding horizontal spacing matches the requested plan. The accepted POC also retains an empty 36ch slot. The plan preserves clickable pickers and explicitly includes live position checks.
- **Wrap:** Rechecked `main.css:1230–1246,2159–2168`, `composer-height.ts`, the existing helper assertions, and the new-thread render/height call. The session-specific minimum works with the existing scroll/client-height helper and 220px cap. No helper rewrite or extra test is needed merely to introduce this CSS minimum.
- **Thinking:** Rechecked `pi-rpc-driver.ts:674–714,1323–1347`. Successful state retrieval precedes validation; returned thinking is parsed and merged into the snapshot. Removing only the thinking comparison preserves provider/model checks. The fake-client replacement pattern in `test/rpc-client.test.mjs:1002–1052` supports the planned mismatch case.
- **Verification plan:** Both specified package scripts exist. The plan retains unit verification and the approved real Tauri smoke after implementation/rebuild. Planning source-consistency checks passed. Application tests and live UI checks were not run in this planning-only round and are not claimed as passing implementation evidence.

### Findings

None new. Open findings: zero high, zero medium, zero low. No unresolved owner decision or scope expansion is required for this verdict.

### Verdict: PASS

The revised plan meets the plan-review PASS criteria. Stop the planning audit loop here. This verdict does not authorize implementation; the plan retains the separate owner-approval gate. Only the audit file and requested heartbeat were written.

## Owner ruling after Plan Audit Round 2 PASS

2026-09-13: Owner rejected keeping provider/model mismatch throws. Alamelu Pi Tauri is a wrapper around Pi, not a harness validator. If Pi is fine, the GUI is fine — provider, model, and thinking. Session-id identity check stays. Plan updated in place. Next critic round is Plan Audit Round 3. CFWT-P1-01 remains accepted and is not reopened.

## Plan Audit Round 3

- Phase: plan. Role: critic. Numeric round: 3.
- Actual model: `gpt-6-astra`. Reasoning effort: `high`.
- Session ID: `01a09bc1-f8a2-7c22-b067-ea9f5a504706` (continued critic).
- Re-read the required global/project instructions, entire current plan, entire audit and builder/owner responses, supplied brief/history, and cited source evidence. Applied the previously read Codex-local `debate-poc-loop` PASS criteria. This round follows the explicit owner change after Round 2 PASS, not an automatic minimum-round requirement.

### Outcome, scope, and done criteria

The unchanged UI scope is a left-aligned session hint/model/thinking, followed by a permanently reserved 36ch time slot with horizontal spacing and stable right-side actions; and a session-only 72px textarea well that grows after filling, caps at 220px, and leaves new-thread behavior unchanged.

The latest owner ruling supersedes earlier requirements to preserve provider/model mismatch throws. After successful replacement `get_state` with the same Pi session id, accept Pi's provider, model, and thinking values when present. Remove `assertRestoredSessionConfig` and its call. Keep the session-id mismatch throw and existing lifecycle guards; introduce no other validator.

Done requires those behaviors, the plan's existing unit lanes and single fake-client success case, and the approved real Tauri footer/wrap and `xai-i2o` / `grok-4.6` / requested `xhigh` smoke after implementation approval and rebuild. This review does not implement, rebuild, install, add tests, or expand the task.

### Prior finding and owner ruling

- **CFWT-P1-01 — medium — remains resolved.** The plan still preserves the shared 24px rule and applies 72px with `.composer:not(.new-thread__composer) textarea`. The accepted finding is not reopened.
- **Owner ruling after Round 2 — honored.** Outcome 3, owner rulings, done criterion 4, the driver/test file descriptions, and out-of-scope boundaries consistently accept provider/model/thinking differences while retaining session identity. Earlier audit statements requiring provider/model throws are historical and do not govern this revised plan.

### Complete-scope verification

- **Footer:** Rechecked `composer-panel.tsx:123–124,174–196`, `main.css:1259–1289,1470–1474`, and the accepted POC footer. The existing elapsed label is empty while idle, and its width/flex-basis is fixed at 36ch with tabular numerals. The planned hint-then-elapsed order and spacing preserve the approved reservation and actions arrangement. No plan defect found.
- **Wrap:** Rechecked `main.css:1230–1246,2159–2168`, `composer-height.ts`, helper assertions, and the new-thread markup/220px helper call. The plan retains the accepted session-only selector and existing cap/height helper. No new-thread behavior change or extra helper work is required.
- **Pi configuration acceptance:** `pi-rpc-driver.ts:681–685` separately checks `get_state` success and session identity before config handling. The call at line 688 invokes the provider/model/thinking comparisons at lines 1337–1347. Removing that call and helper removes those mismatch throws without dropping the distinct session-id check or closed/active guards. `sessionConfigFromState` at lines 1323–1334 already extracts all three reported fields, and the merge at lines 706–707 gives those returned values precedence over the GUI snapshot. The proposed removal therefore directly implements the latest owner ruling without another validator or merge rewrite.
- **Verification plan:** The fake-client pattern in `test/rpc-client.test.mjs:1002–1052` supports the single planned replacement-success case. No additional cases are required by this audit. Both named package scripts exist. The later live Tauri smoke remains explicitly scheduled after approval/rebuild.
- Planning source-consistency verification passed. No application tests, rebuild, or live UI checks were run; this verdict does not claim implementation verification.

### Findings

None. Open findings: zero high, zero medium, zero low. No unresolved owner decision, speculative hardening, or scope expansion is required.

### Verdict: PASS

The complete revised plan meets the plan-review PASS criteria under the owner's latest ruling. Stop this audit here. Round 3 closes discovery of pre-existing plan defects; any subsequently missed old defect must be marked LATE and taken to the owner, while a later new finding requires causal evidence of a builder-introduced regression. Implementation remains subject to the plan's separate owner approval. Only this audit file and the requested heartbeat were written.

## Implementation Audit Round 1

- Phase: implementation. Role: critic. Numeric round: 1.
- Actual model: `gpt-6-astra`. Reasoning effort: `high`.
- Session ID: `01a09bda-58d8-7e00-9d22-efb71c6f6883`.
- Re-read the required global/project instructions (including active Codex globals and applicable desktop guidance), entire current plan, entire audit history and responses, entire implementation record, and binding owner brief. Reviewed the changed source and surrounding behavior for all three approved items using the Codex-local `debate-poc-loop` criteria.

### Outcome, scope, and done criteria

Review the implemented session footer with hint/model/thinking on the left, followed by a permanently reserved 36ch elapsed slot with space on both sides and the existing attachment/send actions; the session-only 72px textarea well that grows after filling and caps at 220px while preserving new-thread height behavior; and acceptance of Pi's provider/model/thinking after successful replacement `get_state` for the same session. Pi's returned config must take precedence when present, and the session-id mismatch throw must remain.

This is the implementation critic checkpoint. Relevant unit verification must pass. The owner explicitly schedules the real Tauri footer/wrap and `xai-i2o` / `grok-4.6` / requested `xhigh` smoke, GitHub Actions Mac build, and Mac deployment after this audit PASS. They remain required downstream work, not completed evidence in this audit. No Windows port, extra tests, Playwright, Cursor settings changes, or placeholder clock text are required.

### Prior finding and owner rulings

- **CFWT-P1-01 — medium — remains resolved.** The actual CSS keeps the shared 24px minimum and applies 72px only to `.composer:not(.new-thread__composer) textarea`. The new-thread root includes `new-thread__composer` and retains its existing height helper call. The resolved finding is not reopened.
- **Latest configuration ruling — honored.** Earlier historical requirements to retain provider/model mismatch throws are superseded. All three config comparisons are removed; the separate session identity check remains.
- The working tree also contains earlier composer-stability and all-provider child-rotation work. Its implementation record establishes that the extension-dock removal, height helper, new-thread cap, rotation generalization, and Terra/dead-pipe cases predate this three-item change. They are not misattributed as scope expansion by this builder round. Unrelated tracked changes and untracked local files were left untouched.

### Complete-scope verification

- **Footer:** `apps/desktop/src/composer-panel.tsx:123–124,174–205` renders an always-present elapsed element after the hint/model selector and before the existing actions block. It uses `runningLabel` while running and an empty string while idle. `apps/desktop/src/styles/main.css:1262–1295` retains the flexible left status area and fixed `flex: 0 0 36ch` / `width: 36ch` elapsed reservation, adds `margin: 0 18px`, and centers tabular digits. Elapsed content therefore does not change its layout width as seconds tick. The hint has no overflow clipping, ellipsis, or nowrap rule; the attachment button remains. Actual rendered geometry remains part of the scheduled live Tauri smoke.
- **Textarea well:** `main.css:1230–1250` preserves the shared 24px minimum and 220px maximum, adding only the session-specific 72px minimum. `composer-height.ts:1–15` measures content height, caps at the supplied maximum, and enables overflow only at the cap. The session call at `app.tsx:1412` and new-thread call at `new-thread-view.tsx:128` both retain 220px. New-thread markup at line 175 excludes it from the new minimum. No helper rewrite or new-thread minimum correction is necessary.
- **Pi configuration:** `packages/pi-rpc-driver/src/pi-rpc-driver.ts:674–714` still requires successful state retrieval, checks the returned session id before accepting the replacement, preserves closed/active guards, and closes the replacement on failure. `assertRestoredSessionConfig` and its call are absent. The merge at lines 705–707 gives `restoredConfig` precedence, and `sessionConfigFromState` at lines 1322–1334 extracts the reported provider, model id, and thinking string when present. No replacement config-mismatch throw remains.
- **Required regression case:** `packages/pi-rpc-driver/test/rpc-client.test.mjs:1053–1111` starts with `xai-i2o` / `grok-4.6` / `xhigh`, returns the same session id with `cursor` / `composer-2.5` / `high` from the replacement, and asserts closure of the old client, delivery of the second prompt to the replacement, and the returned config in the last session snapshot. This covers all three approved config differences in the single planned case.
- **Existing verification evidence reused:** The owner brief and implementation Verification Round 1 report a successful driver build, **76/76** driver tests including the new rotate-accept case, and **4/4** desktop `test:tauri:unit:ci` checks. Package scripts and the relevant test assertions were inspected. No new changes, failures, or unresolved concern justified rerunning those passed checks, so this critic did not rerun tests or claim independent execution. Source consistency checks found no conflict with the reported results.

### Findings

None. Open findings: zero high, zero medium, zero low. No unresolved owner decision or scope-expanding remedy is needed.

### Verdict: PASS

The three-item implementation meets this audit checkpoint's PASS criteria using the recorded passing unit verification. Stop the audit loop here. The owner-authorized GitHub Actions Mac build, Mac deployment, and real Tauri smoke remain downstream; this verdict does not claim they have run. Only this audit artifact and the requested heartbeat were written. No implementation, commit, deployment, or additional agent was started by this critic.
