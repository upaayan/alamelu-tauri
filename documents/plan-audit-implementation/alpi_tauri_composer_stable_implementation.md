# Alamelu Pi Tauri — composer stability + dead-RPC restart — implementation

Status: installed to `/Applications/Alamelu Pi Tauri.app`. Live inspect still owner-driven.

I1-F1 deploy-gate note: the first git push of this work must show a green Windows job. If that job is red, narrow both CI jobs' `rpc-client.test.mjs` name pattern to `Terra child|dead-pipe` (the two `os.tmpdir()` tests). This does not block Mac package/sign/inspect/install; Windows deploy stays later.

Plan: `documents/plan-audit-implementation/alpi_tauri_composer_stable_plan.md`  
Audit: `documents/plan-audit-implementation/alpi_tauri_composer_stable_audit.md`

## What shipped

Composer (reuse approved POC, drop demo clock):

- `apps/desktop/src/composer-panel.tsx` — removed `pocStartedAt` / `pocElapsed` / idle ticker. Elapsed slot shows `runningLabel` only while `selectedSession.status === "running"`; idle is empty. Dock still not rendered.
- `apps/desktop/src/composer-surface.tsx` — unchanged: no `ExtensionDock` render.
- `apps/desktop/src/styles/main.css` — `.composer__elapsed` is 36ch with tabular nums. `.composer__hint` keeps `min-width: 0` and drops `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`.
- `apps/desktop/src/composer-height.ts` — already overflow auto only at the cap.
- `apps/desktop/src/new-thread-view.tsx` — `fitComposerTextarea(..., 220)`.
- `apps/desktop/src/conversation-timeline.tsx` — wheel hand-off only when the composer textarea is focused and `pane.contains(event.target)`. Nested pane scrollers with `overflow` auto/scroll and room in that wheel direction keep the event.
- `apps/desktop/src/App.tsx` — already passes `runningLabel` from `useBusyLabel`. No second timer.

RPC (Luna strategy, all providers):

- `packages/pi-rpc-driver/src/pi-rpc-driver.ts`
  - `lunaChildNeedsRotation` → `childNeedsRotation`
  - `rotateLunaChildBeforePrompt` → `rotateChildBeforePrompt` (no `isLunaSession` gate)
  - `prepareIdleLunaClientForMutation` → `prepareIdleClientForMutation`
  - Flag set on `agent_settled`, `endRun`, and the benign idle `rpc_transport_closed` return
  - `replaceIdleClient` unchanged
  - `isLunaSession` deleted

Tests / CI:

- Inverted Terra test: `PiRpcDriver rotates a Terra child before the second idle prompt` (`os.tmpdir()` lab root).
- Added `PiRpcDriver rotates a dead-pipe idle child before the next prompt` (Grok, `os.tmpdir()`).
- Existing Luna reopen / failed-reopen / mutation-ordering tests kept.
- Desktop unit asserts `overflowY` hidden below the 220px cap and auto at the cap.
- `.github/workflows/native-build.yml` name pattern now includes `reopen|rotat|dead-pipe|tainted Luna` on Mac and Windows jobs.

Mac candidate (after Implementation Audit PASS):

- `pnpm --filter @alamelu-pi/desktop run package:tauri` — built `apps/desktop/src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`
- `pnpm --filter @alamelu-pi/desktop run sign:tauri` — valid on disk, designated requirement satisfied
- `pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged` — OK (47 providers, 748 models, 91 API members)
- Bundled CSS: `.composer__elapsed` is 36ch; `.composer__hint` is color/font-size/`min-width: 0` only (no overflow/ellipsis/nowrap). No `26ch`, no idle demo clock.

Install (2026-09-13, owner authorized after quit):

- Backup of previous Applications copy: `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13-composer-stable` (binary mtime 2026-09-13 13:30:39; earlier same-day backup `bak-2026-09-13` left untouched)
- Installed signed candidate to `/Applications/Alamelu Pi Tauri.app` (binary mtime 2026-09-13 18:58:00; sha256 matches the packaged candidate)
- `codesign --verify --deep --strict` on the installed app: OK
- Opened the installed app so the owner can inspect

Live inspect still needed on this copy: model/thinking pickers on session footer and New thread; elapsed ticks without shoving the hint; wheel over transcript vs tall tool/code; Cursor, Grok, and Sol/Terra second-prompt plus kill-child recovery.

Windows install later. Commit / push not done.

Out of scope (untouched): `pi-cursor-sdk`, Electron, new restart architecture.

## Verification Round 1 — 2026-09-13

Builder: Cursor Grok 4.6. Project: `/Users/sudhirjha/playground/alamelu-tauri`.

```
pnpm --filter @alamelu-pi/pi-rpc-driver test
```

Result: 75 pass, 0 fail. Includes inverted Terra test, dead-pipe test, and existing Luna rotation / failed-reopen / mutation-ordering tests.

```
pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci
```

Result: 4 pass, 0 fail (composer helpers + Tauri API parity).

```
node --test --test-name-pattern="WSL|mapRpcEventToSessionDriverEvents|reopen|rotat|dead-pipe|tainted Luna" packages/pi-rpc-driver/test/rpc-client.test.mjs
```

Result: 11 pass, 0 fail (CI name pattern after `pi-rpc-driver` build from the full driver test run).
