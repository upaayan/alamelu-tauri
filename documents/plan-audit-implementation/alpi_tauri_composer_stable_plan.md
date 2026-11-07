# Alamelu Pi Tauri — composer stability + dead-RPC restart

## Outcome

Ship the approved composer POC as product behavior, and apply the existing Luna child-restart to every provider so a dead `pi --mode rpc` pipe does not leave Cursor/Grok/Sol/Terra stuck on “RPC client is closed”.

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

## Owner rulings carried in

- Composer POC approved 2026-09-13. Reuse it; do not start over.
- Idle demo clock did not prove a live tick. Owner assumes the reserved slot will hold a real run timer. Implementation must drop the idle demo clock. Show elapsed only while the session is running, using the existing `runningLabel` / `useBusyLabel` path. Keep a reserved elapsed slot so hint/model/buttons do not shift when seconds change. Slot width is 36ch so the longest real label (`Compacting conversation for 59m 59s`) fits; 26ch was a POC number for `Working for Ns` only.
- No “Cursor; Fast Mode on” dock inside the chat box. `ExtensionDock` stays unrendered in the composer. Do not delete the dock/dialog module; other surfaces may still use the dialog.
- Transcript must scroll while the composer is focused. Keep the POC wheel hand-off and textarea `overflow-y: hidden` until the 220px cap.
- Dead-RPC / “Your next message will restart it” for all providers is in this plan. Use the Luna strategy already in `PiRpcDriver`: mark the idle child for replacement after settle/end, replace it immediately before the next idle prompt. Do not invent a new restart architecture.
- Owner later said they hit “the cursor issue” again during the POC look. That card (`Cursor shell did not complete` / `missing completion`) stays out of this plan. It is parked at `/Users/sudhirjha/playground/alamelu/documents/TODO-cursor-error-diagnosis.md`. This plan does not change `pi-cursor-sdk`.
- Planning + Fable/high critic now. Implementation only after explicit owner approval. Mac install after implementation PASS. Windows later.
- No Electron repo changes.

## Done when

1. Idle composer has no ticking “Working for Ns” demo. The elapsed slot is reserved and empty (or equivalent spacer) when idle.
2. During a real run, the same slot shows the real `runningLabel` and the hint/model/buttons do not shift as seconds change.
3. Composer does not render the extension dock.
4. Wheel over the transcript while the composer is focused scrolls the transcript. No click-to-unfreeze.
5. After a Cursor/Grok/Sol/Terra/Luna child pipe dies or a run settles, the next idle prompt uses a fresh same-session Pi child. The second prompt must not fail with `RPC client is closed`.
6. Existing Luna replacement guards stay: same Pi session id, same provider/model/thinking, generation-bound events, failed replacement leaves the old child and sends no prompt.
7. Relevant driver tests and the existing Tauri helper unit tests pass. Packaged signed candidate is built for Mac inspect. Install to `/Applications` only after implementation approval.

## Reuse (already in the tree)

POC note: `documents/plan-audit-implementation/alpi_tauri_composer_stable_poc.md`  
Undo backup stays until ship: `.poc-composer-stable-20260913/`

Keep and tidy, do not rewrite:

- `apps/desktop/src/composer-panel.tsx` — dock not rendered; elapsed slot. Remove `pocStartedAt` / `pocElapsed` / idle ticker.
- `apps/desktop/src/composer-surface.tsx` — no `ExtensionDock` render.
- `apps/desktop/src/styles/main.css` — `.composer__elapsed` 36ch + tabular nums; textarea `overflow-y: hidden`; `.timeline-pane` outline none. `.composer__hint` may keep `min-width: 0` and must drop `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` so the inline model/thinking dropdowns stay visible/clickable and the footer row (Send/Attach) still fits at reachable widths (wide sidebar or min window + diff panel). The reserved slot keeps seconds from shoving the hint; wrapping the hint is allowed.
- `apps/desktop/src/composer-height.ts` — overflow auto only at the 220px cap. `new-thread-view.tsx` must pass 220, not 260, so the helper and CSS cap match.
- `apps/desktop/src/conversation-timeline.tsx` — capture-phase wheel hand-off while `footer.composer` textarea is focused; `tabIndex={-1}` on the pane. Only steal the wheel when `pane.contains(event.target)`. If an ancestor of the target inside the pane can scroll in that wheel direction (`overflow` auto/scroll and room to move), do not `preventDefault`; let that scroller have the event.
- `apps/desktop/src/App.tsx` — already computes `runningLabel` via `useBusyLabel`. Pass that through. Do not add a second timer.

RPC reuse, widen only:

- `packages/pi-rpc-driver/src/pi-rpc-driver.ts`
  - `lunaChildNeedsRotation` → `childNeedsRotation` (same flag, all providers).
  - `rotateLunaChildBeforePrompt` → `rotateChildBeforePrompt`; drop the `isLunaSession` gate.
  - `prepareIdleLunaClientForMutation` → `prepareIdleClientForMutation` (same call sites, same behavior).
  - Set the flag on `agent_settled` and `endRun` for every session, not only Luna.
  - On benign idle `rpc_transport_closed` (the path that currently returns without failing the run), still set the flag so the next prompt replaces a dead idle child.
  - Keep `replaceIdleClient` as-is: `get_state`, same session id, `assertRestoredSessionConfig`, generation bump, close previous child.
  - Delete `isLunaSession` if nothing else needs it.

## Production fixes on top of the POC

1. Remove the idle demo clock. The reserved elapsed slot (36ch) stays so a live `Working for 9s` → `Working for 10s` (or the compaction label) cannot shove the hint.
2. Do not render `ExtensionDock` in the composer. Passing unused props can be deleted only if that is a small local cleanup; not required.
3. Keep the scroll hand-off, with the target/nested-scroller guard above. Do not add focus-stealing on hover.
4. Dead child: Luna behavior for all providers. Invert the old Sol/Terra “leave the child running” test. That old behavior is what leaves Cursor stuck on a closed RPC client.

## Tests (relevant only)

- Driver (`packages/pi-rpc-driver/test/rpc-client.test.mjs`):
  - Keep the existing Luna reopen / failed-reopen / mutation-ordering tests.
  - Change `PiRpcDriver leaves Sol and Terra children running across successful idle prompts` so Terra (and the same pattern for Cursor `composer-2.5` or Grok) rotates before the second prompt, matching Luna.
  - Add one dead-pipe case: first prompt settles, client emits `rpc_transport_closed` / rejects with `RPC client is closed`, second prompt goes to the replacement child.
- Desktop unit already covers `fitComposerTextarea`. Add a small helper assertion only if the elapsed-slot / overflow change is not already covered. No Playwright port.
- Local: `pnpm --filter @alamelu-pi/pi-rpc-driver test` and `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci`.
- CI (`.github/workflows/native-build.yml`): extend the existing `rpc-client.test.mjs` name pattern so the rotation / dead-pipe tests run on Mac and Windows jobs. New/inverted tests use `os.tmpdir()` lab roots like `compaction-queue.test.mjs` so Windows does not fail on `/tmp/...` paths. Do not add a new workflow. Do not install Pi on the runner.

## Build / deploy

- After implementation approval: tidy POC leftovers, run the tests above, package and sign the Mac candidate, then inspect before install:
  - Composer: open the model picker and the thinking picker from the session footer and from New thread; both must be visible and clickable. During a real run the elapsed slot ticks without shoving the hint. Wheel over the transcript while the composer is focused; wheel over a tall tool/code block still scrolls that block.
  - Dead child, one thread each for Cursor, Grok, and Sol or Terra: prompt → settle → second prompt succeeds; prompt → settle → kill that thread’s `pi --mode rpc` child → next prompt succeeds with no `RPC client is closed`.
  - Then install to `/Applications/Alamelu Pi Tauri.app` with a backup of the previous copy.
- Windows install is a later owner step.
- This planning phase does not implement, commit, or deploy.

## Out of scope

- `Cursor shell did not complete` / `missing completion` (`pi-cursor-sdk`).
- Electron.
- Windows deploy.
- New restart/supervisor design, mid-run auto-replay, or hiding the incomplete-tool card.
- Extra composer chrome, settings for the dock, or new test frameworks.
