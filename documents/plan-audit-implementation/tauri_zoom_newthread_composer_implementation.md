# New-thread composer jump + Cmd+ zoom — implementation

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

Plan: `documents/plan-audit-implementation/tauri_zoom_newthread_composer_plan.md`  
Audit: `documents/plan-audit-implementation/tauri_zoom_newthread_composer_audit.md`

Status: signed candidate copied to `/Applications/Alamelu Pi Tauri.app` on 2026-09-20. This running process is still the old binary until quit/reopen.

## What changed

- `apps/desktop/src/styles/main.css` — `.composer.new-thread__composer textarea { min-height: 120px; }` so the first-prompt well beats `.composer textarea { min-height: 24px }`. Session `.composer:not(.new-thread__composer) textarea { min-height: 72px }` untouched.
- `apps/desktop/src/new-thread-view.tsx` — imported `useLayoutEffect`; the `fitComposerTextarea(..., 220)` effect is now `useLayoutEffect` with the same `[composerRef, prompt]` deps. Focus `useEffect` unchanged.
- `apps/desktop/src-tauri/tauri.conf.json` — `"zoomHotkeysEnabled": true` on the `main` window.
- `apps/desktop/src-tauri/capabilities/default.json` — `"core:webview:allow-set-webview-zoom"`.

Unchanged: `composer-height.ts`, session composer, Electron, View menu.

## Verification Round 1 — 2026-09-20

Builder: Grok. Project: `/Users/sudhirjha/playground/alamelu-tauri`.

```
pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci
```

Result: 4 pass, 0 fail (`clipboard helpers`, `fitComposerTextarea`, `dispatchNativeAttachments`, Tauri API parity).

JSON parse of `tauri.conf.json` and `capabilities/default.json`: ok.

Live Cmd+ zoom and new-chat wrap need a Mac rebuild after Implementation Audit PASS and owner install approval.

## Verification Round 2 — 2026-09-20 Mac candidate (not installed)

Builder: Grok. Project: `/Users/sudhirjha/playground/alamelu-tauri`.

```
pnpm run verify:upgrade
PATH="$HOME/.cargo/bin:$PATH" pnpm --filter @alamelu-pi/desktop run package:tauri
pnpm --filter @alamelu-pi/desktop run sign:tauri
pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged
```

Results:

- Upgrade gate: 31 pass + 8 protection tests OK
- Bundle: `apps/desktop/src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app` (binary mtime 2026-09-20 00:42:12, sha256 `a2fea8aaeeb5f142d29df39f6cf71b855a24ef9706717eaa7f30410ddf0b22d0`)
- Bundled CSS contains `.composer.new-thread__composer textarea{min-height:120px}`
- `codesign --verify --deep --strict`: OK
- Packaged smoke: OK (47 providers, 744 models, 91 API members). Smoke used an isolated temp user-data dir, not this session.
- `/Applications/Alamelu Pi Tauri.app` binary mtime still 2026-09-14 21:41:51, sha256 `6dc400988963ec24c4d72798707d853defa83b76f568f4e4aac3790a256616fc` (different file, not replaced)

Live wrap + Cmd+ zoom still need you to open the candidate. Not copied to `/Applications`.

## Install — 2026-09-20, owner authorized copy

- Backup: `/Applications/Alamelu Pi Tauri.app.bak-20260920-005256` (sha256 `6dc400988963ec24c4d72798707d853defa83b76f568f4e4aac3790a256616fc`, binary mtime 2026-09-14 21:41:51)
- Installed: `/Applications/Alamelu Pi Tauri.app` (sha256 `a2fea8aaeeb5f142d29df39f6cf71b855a24ef9706717eaa7f30410ddf0b22d0`, matches candidate, binary mtime 2026-09-20 00:42:12)
- `codesign --verify --deep --strict`: OK
- This session was not restarted.
