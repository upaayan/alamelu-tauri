# New-thread composer jump + Cmd+ zoom — audit

Critic: Claude Fable / high. Plan audits start at Plan Audit Round 1.

Append-only. Do not overwrite history.

## Plan Audit Round 1

- Phase: plan. Role: critic. Round: 1.
- Model: Claude Fable 5.1 (`claude-fable-5-1`). Effort: high.
- Session ID: `DE10310D-7B12-4A26-A92D-328E99A3D931`.
- Date: 2026-09-20.
- Artifact reviewed: `documents/plan-audit-implementation/tauri_zoom_newthread_composer_plan.md` (entire file), owner brief, history, and the cited source files. Product files were not edited.

### Restated outcome, scope, done criteria

Outcome. Two items only, in `alamelu-tauri`:

1. New-chat (first prompt) composer stops bouncing on multiline input. Fix is to make the already-declared 120px new-thread well actually win over `.composer textarea { min-height: 24px }`, and to fit the new-thread textarea in `useLayoutEffect` (before paint) the way the session composer does. `fitComposerTextarea` is not rewritten. The session 72px well is not changed.
2. `Cmd+` / `Cmd=` / `Cmd-` / `Cmd+0` zoom the Tauri webview, via Tauri 2's built-in `zoomHotkeysEnabled` window option plus the `core:webview:allow-set-webview-zoom` permission. No View menu.

Scope. Four file edits at implementation time: `apps/desktop/src/styles/main.css` (one new min-height rule), `apps/desktop/src/new-thread-view.tsx` (`useEffect` to `useLayoutEffect` for the fit effect only), `apps/desktop/src-tauri/tauri.conf.json` (`zoomHotkeysEnabled: true` on the `main` window), `apps/desktop/src-tauri/capabilities/default.json` (add the permission).

Out of scope, per owner: clone-measure helper rewrite, session composer, restoring 18px font / `resize: vertical`, Electron, Windows install, extra tests, View menu, zoom persistence, footer/dock/RPC, transcript scroll, POC folder deletion.

Done criteria (from the plan, accepted as written): (1) effective new-thread `min-height` is 120px via a selector that beats `.composer textarea`; session 72px and shared 24px untouched. (2) new-thread fit runs from `useLayoutEffect` on `[composerRef, prompt]`; focus `useEffect` stays; `App.tsx` session layout effect untouched. (3) `fitComposerTextarea` source unchanged. (4) `zoomHotkeysEnabled: true` on the main window and `core:webview:allow-set-webview-zoom` in the default capability. (5) `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci` still passes. (6) After implementation approval and Mac rebuild: new chat wrap does not bounce and Cmd zoom keys change webview zoom.

### Source verification (complete scope)

Item 1 — every factual claim in "Why this is the right solution" was checked against the tree and holds:

- `apps/desktop/src/new-thread-view.tsx:174` root is `className="new-thread__composer composer"`. Line 213 passes `textareaClassName="new-thread__textarea"`, rendered as the textarea `className` at `composer-surface.tsx:326`. Lines 122–129 run `fitComposerTextarea(composer, 220)` from `useEffect` with deps `[composerRef, prompt]`. Lines 118–120 are the separate focus `useEffect`. Line 1 imports `useEffect, useRef` only, so `useLayoutEffect` must be added to the import, as the plan says.
- `apps/desktop/src/styles/main.css:1230–1245` `.composer textarea` sets `min-height: 24px; max-height: 220px; overflow-y: hidden` at specificity (0,1,1). Line 1248 `.composer:not(.new-thread__composer) textarea { min-height: 72px }` is (0,2,1) and excludes new-thread. Line 2165 `.new-thread__textarea { min-height: 120px }` is (0,1,0) and therefore loses to line 1239. Effective new-thread well today is one line. Confirmed.
- `apps/desktop/src/composer-panel.tsx:130` session root is `<footer className="composer">`. `apps/desktop/src/App.tsx:1400–1427` fits the session textarea inside `useLayoutEffect`. Confirmed.
- `apps/desktop/src/composer-height.ts` (14 lines) sets inline `height` only; it never sets `min-height`. With a 120px CSS min-height the `height: auto` re-measure branch (line 12) still resolves to 120px, so the helper keeps working unchanged and the well holds until content exceeds 120px. No helper change is needed.
- The proposed selector `.composer.new-thread__composer textarea` is (0,2,1). It beats (0,1,1), matches only the new-thread root (both classes are on line 174), and cannot match the session `<footer class="composer">`. The session 72px rule and the shared 24px rule are untouched. Confirmed.
- New-thread and session use different refs (`newThreadComposerRef` at `App.tsx:2449`, `composerRef` at `App.tsx:2537`), so the session layout effect does not double-fit the new-thread textarea.
- Mechanism: with a one-line well and `overflow-y: hidden`, the wrapped line is painted clipped and scrolled to the caret before the after-paint `useEffect` grows the box, then the box grows and re-lays out. That is a visible bounce on every wrap or unwrap. The session box has a three-line well and fits before paint, so it never shows that frame. This matches the owner's "new chat only" report, and the two proposed changes address both halves. I did not use the HTML POC as evidence either way, per the owner ruling.
- `apps/desktop/tests/unit/composer-helpers.test.mjs` only imports `fitComposerTextarea`; it does not read `main.css` or `new-thread-view.tsx`. Baseline run today: `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci` → 4 pass, 0 fail. Done-criterion 5 is satisfiable without new test files.

Item 2 — checked against the crates actually locked in the tree:

- `apps/desktop/src-tauri/Cargo.lock`: `tauri 2.11.5`, `tauri-runtime-wry 2.11.4`, `wry 0.55.1`; registry also has `tauri-utils 2.9.3` and `tauri-runtime 2.11.3`.
- `tauri-utils-2.9.3/src/config.rs:2133–2143` `WindowConfig.zoom_hotkeys_enabled` (JSON `zoomHotkeysEnabled`) is documented as: macOS/Linux inject a polyfill for `ctrl/command + -/=`, 20% per step, 20%–1000%, and "Requires `webview:allow-set-webview-zoom` permission". The app's `@tauri-apps/cli` config schema contains `zoomHotkeysEnabled`, so the CLI will accept it.
- `tauri-runtime-2.11.3/src/webview.rs:452` `From<&WindowConfig>` forwards `.zoom_hotkeys_enabled(config.zoom_hotkeys_enabled)`, so a config-declared window gets the flag. The `main` window is declared in `tauri.conf.json` (`app.windows[0].label = "main"`) and `src-tauri/src/lib.rs` only calls `get_webview_window("main")`; there is no Rust builder that would bypass the config.
- `tauri-2.11.5/src/manager/webview.rs:554–572` injects `webview/scripts/zoom-hotkey.js` as a main-frame initialization script on desktop non-Windows when the flag is set. The script (checked) uses `metaKey` on macOS, handles `-`, `=`, `+`, `0`, steps 0.2, and invokes `plugin:webview|set_webview_zoom`. So Cmd+= and Cmd+Shift+= both zoom in, Cmd- zooms out, Cmd+0 resets. Matches the owner's four keys.
- `tauri-2.11.5/build.rs:143` lists `("set_webview_zoom", false)`: not in `core:webview:default`, hence not in `core:default`. Current `capabilities/default.json` has only `core:default`, `core:event:default`, `core:window:default`, `notification:default`, targeting `windows: ["main"]`. Adding `core:webview:allow-set-webview-zoom` is therefore required, and the identifier exists in `src-tauri/gen/schemas/desktop-schema.json`. Without it the injected script's invoke would be denied by the ACL and the keys would do nothing.
- `wry-0.55.1/src/wkwebview/mod.rs:933–941` `zoom()` calls `WKWebView.setPageZoom` (macOS 11+); the bundle sets `minimumSystemVersion: "12.0"`. Works on the supported OS floor.
- App-side interference: the global keydown handler at `App.tsx:1253–1291` calls `preventDefault` only for matched commands and never `stopPropagation`; the shortcut map in `ipc.ts:241–246` only claims comma, B, J, O, so `=`, `-`, `0` are free. Every `stopPropagation` in the renderer is on click or wheel handlers, none on keydown. The injected listener is registered at document start and does not check `defaultPrevented`, so it will fire from the composer, timeline, and elsewhere.

### Findings

None at HIGH or MEDIUM. None at LOW.

Informational notes, no remedy required, not counted as findings and not conditions for PASS:

- N1. The built-in polyfill also registers a `mousewheel` listener that zooms on Ctrl+wheel (`zoom-hotkey.js`, second listener). This comes with the chosen mechanism and cannot be split off without custom JS, which the owner excluded. Recorded for awareness only.
- N2. The polyfill tracks its zoom level in page JS starting at 1.0 per page load. Zoom persistence is out of scope by owner ruling; nothing to do here.

### Verdict

**PASS.**

I agree the two-item solution is correct, with source evidence as recorded above. For item 1 the diagnosis is confirmed in the shipped CSS and TSX: the 120px well is declared but defeated by a higher-specificity rule, and the fit runs after paint; the session composer differs in exactly those two respects and does not bounce. The smallest correct fix is the one planned: one higher-specificity min-height rule scoped to the new-thread root, and switching the existing fit effect to `useLayoutEffect`, leaving `fitComposerTextarea` and the session 72px well alone. For item 2 the locked Tauri 2.11.5 provides the hotkeys natively; `zoomHotkeysEnabled: true` on the config-declared `main` window plus `core:webview:allow-set-webview-zoom` in the default capability is both necessary and sufficient, and no View menu or custom shortcut code is needed.

Zero HIGH/MEDIUM, zero LOW, relevant verification passing (unit baseline 4/4), no unresolved owner decision. Implementation remains gated on explicit owner approval per the plan.

## Implementation Audit Round 1

- Phase: implementation. Role: critic. Round: 1.
- Model: Claude Fable 5.1 (`claude-fable-5-1`). Effort: high.
- Session ID: `3916FF6F-7614-4846-992D-5A65DC053635`.
- Date: 2026-09-20.
- Artifacts reviewed: owner brief; entire plan; entire implementation doc; entire audit history; the four changed product files in full context (`apps/desktop/src/styles/main.css`, `apps/desktop/src/new-thread-view.tsx`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/default.json`); the deliberately unchanged `apps/desktop/src/composer-height.ts`. Plan Audit Round 1 findings were not re-opened. No product file was edited by the critic.

### Restated outcome, scope, done criteria

Outcome. Two items only: (1) the new-chat composer keeps a real 120px well and fits before paint so wrapping does not bounce, with `fitComposerTextarea` and the session 72px well untouched; (2) `Cmd+` / `Cmd=` / `Cmd-` / `Cmd+0` zoom the Tauri webview via `zoomHotkeysEnabled` plus `core:webview:allow-set-webview-zoom`, with no View menu.

Scope. Exactly four file edits: one winning min-height rule in `main.css`; `useEffect` to `useLayoutEffect` for the fit effect only in `new-thread-view.tsx`; `zoomHotkeysEnabled: true` on the `main` window in `tauri.conf.json`; the zoom permission in `capabilities/default.json`. Out of scope per owner: clone-measure, session composer, 18px font, Electron, Windows, extra tests, View menu, zoom persistence, footer/dock/RPC, Mac package/install.

Done criteria (plan items 1–5 apply to this round; item 6 is the post-rebuild live check the builder correctly deferred): effective new-thread `min-height` 120px via a selector beating `.composer textarea`, session 72px and shared 24px unchanged; fit runs from `useLayoutEffect` on `[composerRef, prompt]`, focus `useEffect` stays, `App.tsx` session layout effect untouched; `fitComposerTextarea` source unchanged; `zoomHotkeysEnabled: true` on `main` and `core:webview:allow-set-webview-zoom` in the default capability; `test:tauri:unit:ci` still passes.

### Verification of complete scope against the tree

Item 1, criterion 1 (CSS well):

- `git diff` on `main.css` is a single four-line insertion at lines 1252–1254: `.composer.new-thread__composer textarea { min-height: 120px; }`. Specificity (0,2,1) beats `.composer textarea` (0,1,1) at line 1230 and is placed after it. The session rule `.composer:not(.new-thread__composer) textarea { min-height: 72px }` at line 1248 is byte-identical to before, and the two (0,2,1) rules target disjoint elements (the session root is `<footer class="composer">` without `new-thread__composer`), so order between them is irrelevant. Shared `min-height: 24px` / `max-height: 220px` / `overflow-y: hidden` at lines 1239–1241 unchanged. `.new-thread__textarea` at line 2169 left in place as the plan required. No `@layer` or `@import` in `main.css`, and no other stylesheet in `apps/desktop/src/styles/` references `new-thread__textarea` or `new-thread__composer`, so nothing else competes for the property. The new-thread root still renders `className="new-thread__composer composer"` (`new-thread-view.tsx:174`) and the textarea still receives `new-thread__textarea` (line 213), so the selector matches the intended element and only it. Confirmed.

Item 1, criterion 2 (fit before paint):

- `git diff` on `new-thread-view.tsx` is exactly two hunks: line 1 adds `useLayoutEffect` to the React import; line 122 changes `useEffect(` to `useLayoutEffect(` on the fit effect. Body and deps `[composerRef, prompt]` are unchanged (lines 122–129). The focus `useEffect` at lines 118–120 is unchanged and still uses the retained `useEffect` import. `git status` shows `App.tsx`, `composer-panel.tsx`, `composer-surface.tsx` unmodified, so the session `useLayoutEffect` fit is untouched. Confirmed.

Item 1, criterion 3 (helper unchanged):

- `git status` / `git diff --stat` on `apps/desktop/src/composer-height.ts` report no change; the file is the same 14-line helper reviewed in Plan Audit Round 1. Its `height: auto` re-measure branch resolves to the CSS min-height, so the 120px well holds until content exceeds it and shrink-back never collapses below the well. Confirmed.

Item 2, criterion 4 (zoom hotkeys):

- `tauri.conf.json` parses; `app.windows[0]` is the `main` window and now carries `"zoomHotkeysEnabled": true` alongside the pre-existing keys, which are unchanged. The key exists in the installed `@tauri-apps/cli` 2.11.4 `config.schema.json` (`WindowConfig.zoomHotkeysEnabled`, boolean, macOS/Linux polyfill for `ctrl/command + -/=`, requires `webview:allow-set-webview-zoom`). `Cargo.lock` still pins `tauri 2.11.5`, matching the crate-level verification in Plan Audit Round 1. No `tauri.macos.conf.json` / `tauri.windows.conf.json` exists in `src-tauri/`, so nothing can override the window array per platform.
- `capabilities/default.json` parses; `core:webview:allow-set-webview-zoom` is present in `permissions` and the capability still targets `windows: ["main"]`. The identifier is present in `src-tauri/gen/schemas/desktop-schema.json`. No other permission was added or removed; no View menu or shortcut-map code was introduced (App.tsx / ipc.ts unmodified). Confirmed.

Criterion 5 (tests):

- Ran `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci` from a clean checkout of these edits: 4 pass, 0 fail (`clipboard helpers`, `fitComposerTextarea grows, wraps, and shrinks`, `dispatchNativeAttachments`, `Tauri bridge exposes every PiDesktopApi property`). Matches the builder's Verification Round 1. No new test file was added, as required.
- Additionally ran `tsc --noEmit -p apps/desktop/tsconfig.json` to confirm the renderer import change compiles: no errors. This is a read-only check of existing scope, not an added artifact.

Scope discipline:

- `git status` on the four files shows modified; the diff contains only the planned edits and nothing else. Untracked POC folders and planning docs in the tree are local clutter from the planning phase and are not part of this change. No out-of-scope file touched. Builder correctly deferred Mac package and `/Applications` install pending this audit and owner install approval.

### Findings

None at HIGH, MEDIUM, or LOW.

No informational notes beyond those already recorded in Plan Audit Round 1 (N1 Ctrl+wheel zoom comes with the polyfill; N2 zoom level resets per page load, persistence out of scope). Nothing new surfaced in the implementation.

### Verdict

**PASS.**

The implementation is exactly the plan: one higher-specificity min-height rule scoped to the new-thread root, the fit effect moved to `useLayoutEffect` with identical deps, `zoomHotkeysEnabled: true` on the config-declared `main` window, and the zoom permission in the default capability. `fitComposerTextarea`, the session 72px well, the shared 24px rule, and `App.tsx` are untouched. Both JSON files parse and validate against the installed schemas. Unit suite 4/4 and renderer typecheck clean. Zero HIGH/MEDIUM, zero LOW, no unresolved owner decision. Remaining plan item 6 (live new-chat wrap and Cmd zoom on the rebuilt Mac candidate) is post-rebuild verification that the owner has gated separately; it is not a condition for this round.
