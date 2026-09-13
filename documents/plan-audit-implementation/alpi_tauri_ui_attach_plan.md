# Alamelu Pi Tauri — UI, attach, paste/drop

## Outcome

Ship the approved POC as the Tauri product: sidebar spacing and no folder tile, a chat box that does not jump, `+` as Attach (native explorer), and Cmd/Ctrl+V plus drag-drop for images and documents. Add Tauri-relevant tests (ideas from the Electron suite, not those specs). GitHub Actions builds and runs those tests. Install the signed app on this Mac. Windows install is later.

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

## Owner rulings carried in

- POC approved 2026-09-13. Reuse it; do not start over.
- First row = Alamelu Pi brand. Rest = repo list. Gap under the brand is already `padding-top: 28px` on `.sidebar__section` (more than double the old 14px). Keep that.
- Folder tile on each repo row is gone. Chevron stays for expand/collapse.
- `+` in the composer is Attach. Keep the plus glyph. Title `Attach`. Native picker on session and new-thread composers.
- Image and document paste: Cmd+V on Mac, Ctrl+V on Windows. Drag-drop on both.
- Tests: copy the *idea*, not Playwright `_electron` specs.
- Owner then asked: write this plan, Claude Fable/high critic, show the plan, implement, GitHub Actions, deploy on Mac. Windows deploy is a later owner step.
- No Electron repo changes. No retiring Electron.

## Done when

1. Packaged Tauri app shows the approved UI.
2. `+` opens the native file picker and attaches images or documents.
3. Paste and drop attach images and documents without doubling.
4. Text-only paste still inserts text (does not steal ordinary Cmd/Ctrl+V).
5. New Tauri tests cover those behaviors. GitHub Actions Mac and Windows jobs run `build:tauri:assets`, then the Pi-free unit list (not the transport test), then cargo, then the artifact. Packaged smoke is required locally on this Mac before install. CI may try the packaged smoke after ad-hoc sign; if it fails for an environmental reason (no GUI session, no Pi runtime on the runner), record the exact failure in the implementation doc and treat unit + cargo + artifact as the CI gate. Do not install Pi on the runner.
6. Signed `.app` installed to `/Applications/Alamelu Pi Tauri.app` on this Mac, with a backup of the previous copy.

## Reuse (already in the tree)

Keep these POC files; tidy them, do not rewrite:

- `apps/desktop/src/styles/sidebar.css` — brand-to-list gap; folder CSS gone
- `apps/desktop/src/sidebar.tsx` — no `FolderIcon` on repo rows
- `apps/desktop/src/styles/main.css` — composer wrap / scrollbar-gutter
- `apps/desktop/src/composer-height.ts` + callers in `App.tsx` and `new-thread-view.tsx`
- `apps/desktop/src/composer-attachments.ts` — `extractAttachableClipboardFiles`, `clipboardLooksLikeImage`
- `apps/desktop/src/tauri-native-attachments.ts`
- `apps/desktop/src/tauri-main.tsx` — native `onDragDropEvent`
- `apps/desktop/src-tauri/src/lib.rs` — `native_pick_attachments`, `native_attachments_from_paths`, `native_read_clipboard_image`
- `apps/desktop/src-tauri/Cargo.toml` / `Cargo.lock` — `arboard`, `png`

POC note: `documents/plan-audit-implementation/alpi_tauri_ui_attach_poc.md`  
Undo backup stays until ship: `.poc-ui-attach-20260913/`

## Production fixes on top of the POC

1. No double attach on drop — only if a real drop doubles. On macOS Tauri's native handler returns true, so WebKit never gets the Finder HTML5 drop. Builder drops one PNG on the packaged app and counts attachments. If one: record that and leave the HTML5 handler as-is. If two: ignore HTML5 file drops when the native listener is installed. Windows stays compiled-in only.

2. Paste order (session and new thread). Native `invoke` is async, so `preventDefault` must be decided on the event, not in a `.then`. Files win over text. Native paths are the source of truth when files are present.
   - If `types`/items include `Files` or file items → `preventDefault`; extract the web `File` objects synchronously in the handler (before the native call); call native `file_list()` and attach from those paths; only if that returns empty, use the captured web `File` list (keeps the synthesized-paste smoke green).
   - Else if `types` look like an image and there is no `text/plain` → `preventDefault`, then native image. If nothing attaches, nothing is inserted.
   - Else leave the event alone so typed/copied text still pastes (including Numbers/Excel text that also has an image rendition).
   - `tauri-bridge` `readClipboardImage()` staying `null` is fine.

3. Native clipboard files. Owner asked for documents on Cmd/Ctrl+V, not only screenshots. Use `arboard` `Get::file_list()` (already in 3.6.1 on macOS/Windows) and reuse `attachment_from_path`. Skip if empty. No extra crate.

4. New-thread `+` already uses `native_pick_attachments` with HTML file-input fallback. Keep that.

5. Commit `Cargo.lock` with `arboard`/`png` so CI `--frozen-lockfile` / cargo stays reproducible.

## Tests (Tauri-relevant, not Electron copies)

Ideas taken from `composer-drag-drop`, `paste`, attach-picker, and sidebar specs:

- Unit (node:test): clipboard helpers (image vs file vs text), `fitComposerTextarea` grow/wrap/shrink without collapsing to 0 first, native-attachment event helper.
- Rust: keep `encodes_clipboard_png_header` and the existing `.txt` case (`native_attachment_preserves_file_metadata`); add a tiny-png `attachment_from_path` case beside it.
- Unit tests import the `.ts` helpers directly (Node `>=22.19.0` / CI Node 24 type stripping). No `tsx`.
- Packaged smoke (`tauri-main.tsx` + `smoke-tauri-packaged.mjs`): assert no folder tile; brand-to-list gap >= 28px; attach button `title="Attach"`; native path drop via `native_attachments_from_paths` adds a `.txt`; existing native picker and synthesized paste stay. Point the smoke script at `ALAMELU_TAURI_APP_PATH` so CI can use `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Alamelu Pi Tauri.app`.

Wire `test:tauri:unit` to include the new helper tests. Do not port Playwright `_electron` or add WebDriver.

## GitHub Actions

File: `.github/workflows/native-build.yml`

In both Mac and Windows jobs, after `pnpm install --frozen-lockfile` and before `tauri build`:

1. `pnpm --filter @alamelu-pi/desktop run build:tauri:assets` (creates `out/tauri` and `out/tauri-backend/main.cjs`, which unit + cargo need)
2. Pi-free unit list only: `tauri-api-parity.test.mjs` plus the new helper tests (clipboard helpers, `fitComposerTextarea`, native-attachment event helper). Do not run `tauri-backend-transport.test.mjs` in CI (it requires a `pi` executable). Keep that file in the local `test:tauri:unit` script.
3. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Mac job after ad-hoc sign and after `upload-artifact`: try packaged smoke with `ALAMELU_TAURI_APP_PATH` pointing at the CI `.app`, `continue-on-error: true`. If it fails because the runner has no GUI session or no Pi runtime, record the exact failure in the implementation doc; the job stays green; unit + cargo + artifact remain the CI gate. Do not install Pi on the runner.

Windows job: same assets + unit + cargo; keep the NSIS artifact. No Windows install.

## Mac deploy (this machine)

1. If `/Applications/Alamelu Pi Tauri.app` exists, copy it to `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13` and record that path in the implementation doc.
2. `pnpm --filter @alamelu-pi/desktop run package:tauri`
3. `pnpm --filter @alamelu-pi/desktop run sign:tauri` (existing AWS secret `alamelu/pi-codesign`)
4. `pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged`
5. `ditto` the signed `.app` to `/Applications/Alamelu Pi Tauri.app`

Windows laptop install is owner-later. Do not do it in this round.

## Build order

1. Paste/drop production fixes + native clipboard files
2. Smoke + unit + cargo tests
3. CI workflow
4. Local package, sign, smoke, install
5. Commit and push `alamelu-tauri` `main` so Actions runs. Add only the listed source, test, workflow, lock, and document files. `.poc-ui-attach-20260913/` stays untracked and is not committed. After the Mac install is verified, ask the owner before removing that backup.
6. One line in `/Users/sudhirjha/playground/alamelu/documents/progress.md` (Alamelu operational log only; no alamelu-pi-gui code)

## Out of scope

- `alamelu-pi-gui` / Electron product
- Porting the Electron Playwright suite
- Windows deploy
- Fixing `tauri dev` unsigned-bundle notification crash (packaged/signed app is the ship path)
- Changing `window.piApp.platform` Linux fallback or notification Settings URL
- Auto-update, notarization, Homebrew

## Verification

- `node --test` on the new/updated unit files
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged` on the signed Mac candidate
- GitHub Actions Mac job green for tests + `.app` artifact; Windows job still produces the installer
- Manual: gap, no folder tile, type/wrap/Enter, `+`, screenshot paste, drop a PNG and a `.txt`, text-only paste, paste of text copied from Numbers/Excel if handy
