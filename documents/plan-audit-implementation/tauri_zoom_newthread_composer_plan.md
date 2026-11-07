# New-thread composer jump + Cmd+ zoom

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

## Outcome

Two owner-approved items, nothing else.

1. **New chat composer jump.** The first-prompt box must keep a real well so wrapping lines do not bounce the text. After a thread exists, leave the session composer alone (owner: the problem disappears there).
2. **Text size.** `Cmd+` / `Cmd=` zoom in, `Cmd-` zoom out, `Cmd+0` reset, in the Tauri webview. Same idea as Electron’s View menu zoom, without adding a View menu.

## Owner rulings

- HTML scratch POC did not show a bounce in Safari/Chrome. Owner will take the source diagnosis. Do not treat the HTML demo as disproof.
- Owner: jump is **new chat only**. Once a chat starts, it stops.
- Previous wrap work (`composer_footer_wrap_thinking_*`) deliberately left new-thread “unchanged.” A critic already noted that `.new-thread__textarea { min-height: 120px }` loses to `.composer textarea { min-height: 24px }`, and making 120px actually apply needed an owner ruling. This task is that ruling.
- Critic is Claude Fable / high. Keep her inside these two items. Scope-expanding findings need an owner ruling, not a silent extra fix.
- Plan audit first. Implement only after explicit owner approval of a PASS plan. Mac rebuild/install is implementation, not this plan.
- POC directory stays; do not edit product files in this planning phase.

## Why this is the right solution

Shipped new thread (`new-thread-view.tsx`):

- Root is `className="new-thread__composer composer"`. Textarea class `new-thread__textarea`.
- Height runs in `useEffect` (after paint) via `fitComposerTextarea(composer, 220)`.
- CSS `.new-thread__textarea { min-height: 120px }` is specificity `(0,1,0)`.
- CSS `.composer textarea { min-height: 24px }` is `(0,1,1)` and wins. Effective well is **one line**.

Shipped session composer (`App.tsx` / `composer-panel.tsx`):

- Root is `<footer className="composer">` (no `new-thread__composer`).
- Height runs in `useLayoutEffect` (before paint).
- `.composer:not(.new-thread__composer) textarea { min-height: 72px }` wins. Wrapping stays inside three lines.

So the first prompt grows/shrinks on wrap, after paint. The session box does not. That matches the owner.

Do **not** rewrite `fitComposerTextarea` (still used by the session box that already works). Do **not** change session min-height.

Item 1 is: make the existing 120px well actually apply, and fit new-thread before paint like the session box.

Item 2 is Tauri’s built-in zoom hotkeys (v2.11.5 already in this tree): window `zoomHotkeysEnabled: true` plus `core:webview:allow-set-webview-zoom`. On macOS that injects Cmd - / = / + / 0 and calls `set_webview_zoom` in 0.2 steps. No custom JS, no View menu.

## Done when

1. New-thread textarea effective `min-height` is 120px (a selector that beats `.composer textarea`). Session 72px well unchanged. Shared `.composer textarea` stays 24px.
2. New-thread calls `fitComposerTextarea(..., 220)` from `useLayoutEffect` on `prompt`, not `useEffect`. Focus `useEffect` stays. Session `useLayoutEffect` in `App.tsx` untouched.
3. `fitComposerTextarea` source unchanged.
4. Main window has `zoomHotkeysEnabled: true`. Default capability includes `core:webview:allow-set-webview-zoom`.
5. Existing `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci` still passes (helper unchanged; no new test file unless that script fails).
6. After implementation approval and Mac rebuild (not this plan): new chat, wrap a line, text does not bounce; `Cmd+` / `Cmd=` / `Cmd-` / `Cmd+0` change webview zoom.

## Files

- `apps/desktop/src/styles/main.css` — add one winning rule, e.g. `.composer.new-thread__composer textarea { min-height: 120px; }` (specificity `(0,2,1)`). Do not retarget font-size, `resize`, or session selectors. Leave `.new-thread__textarea` in place.
- `apps/desktop/src/new-thread-view.tsx` — import `useLayoutEffect`; switch only the `fitComposerTextarea` effect to `useLayoutEffect`. Same deps `[composerRef, prompt]`.
- `apps/desktop/src-tauri/tauri.conf.json` — on the existing `main` window object, `"zoomHotkeysEnabled": true`.
- `apps/desktop/src-tauri/capabilities/default.json` — add `"core:webview:allow-set-webview-zoom"` to `permissions`.

## Out of scope

- Rewriting `composer-height.ts` / clone-measure / session composer.
- Restoring new-thread `font-size: 18px` or `resize: vertical`.
- A View menu, zoom persistence, or App.tsx shortcut map for `+`/`-`.
- Electron, Windows install, `/Applications` in this planning phase.
- Footer, dock, RPC, transcript scroll, deleting the POC folder.
- Extra unit/Playwright files.

## Verify (implementation, not this planning phase)

- `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci`
- Before any Rust: `documents/REBUILD-PROTECTION.md` (`pnpm run verify:upgrade`)
- After owner implementation approval: Mac package/sign per existing desktop scripts, then live new-thread wrap and Cmd zoom on the candidate. No `/Applications` until the owner says to install.
