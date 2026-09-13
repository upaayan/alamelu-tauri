# Alamelu Pi Tauri — UI / attach / paste — implementation

Owner authorized implement → GitHub Actions → Mac deploy after plan PASS (Claude Fable/high, Round 3).

Reused the approved POC. Production additions: native `file_list()` clipboard files, synchronous paste order (files first, captured web Files before await), Pi-free CI unit list, dated Applications backup.

## Verification Round 1

- `node --test tests/unit/composer-helpers.test.mjs tests/unit/tauri-api-parity.test.mjs` — 4 passed
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — 8 passed (includes `native_attachment_reads_tiny_png`)
- Backup: `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13`
- `pnpm --filter @alamelu-pi/desktop run package:tauri` — built `src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`
- `pnpm --filter @alamelu-pi/desktop run sign:tauri` — signed, designated requirement satisfied
- `pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged` — OK (47 providers, 748 models, 91 API members); includes no folder tile, gap >= 28, Attach title, native path drop `.txt`, synthesized paste
- Installed signed app to `/Applications/Alamelu Pi Tauri.app` (binary mtime 2026-09-13 13:30:39)
- Finder drop double-count: not driven from this session (avoids desktop automation prompts). macOS wry handler returns true so HTML5 Finder drop does not fire; smoke attached one `.txt` via `native_attachments_from_paths`. Leave HTML5 handler unchanged (plan fix 1 = no change).
- C4: packaged smoke passed; OS clipboard did not inject extra files into the synthesized paste.

## Implementation Audit Round 1

Claude Fable/high PASS (2 LOW). I1-01: commit/push/Actions next. I1-02: recorded below.

Manual / live (I1-02):
- Gap >= 28, no folder tile, Attach title: PASS (packaged smoke on installed `/Applications` copy, critic re-ran)
- Native `.txt` path attach: PASS (`droppedFromPaths`)
- Synthesized image paste: PASS (`pastedImageAdded`)
- Composer grow/wrap/shrink without `0px`: PASS (unit)
- Type/wrap/Enter in the live window, Finder `.txt` Cmd+V, one PNG drop count, text-only paste, Numbers/Excel paste: not driven from this session (same automation-permission risk as Round 2). Owner can check on the app now open as Alamelu Pi Tauri.
