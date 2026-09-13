# Alamelu Pi Tauri — UI / attach / paste — audit

Append-only. Plan audits start at Round 1. POC iterations do not count.

## Plan Audit Round 1

**Date:** 2026-09-13
**Reviewer:** claude (fable, effort high)
**Session:** ECA4E294-412C-47C6-8B29-051ACB02B016

### Restated outcome, scope, done criteria

**Outcome.** Ship the approved 2026-09-13 POC as the Tauri product: brand-to-repo-list gap, no folder tile on repo rows (chevron stays), composer that does not jump, `+` = Attach via native picker on both composers, Cmd/Ctrl+V and drag-drop for images and documents. Then Tauri-relevant tests, GitHub Actions running them, signed `.app` installed on this Mac. Windows install later.

**Scope.** `/Users/sudhirjha/playground/alamelu-tauri` only. Reuse the POC files; two production fixes on top (no double attach on drop; native clipboard files for Cmd/Ctrl+V of documents). No Electron work, no Playwright port, no WebDriver, no Windows install, no notarization.

**Done criteria (from the plan).** 1 packaged app shows the approved UI; 2 `+` opens native picker and attaches images or documents; 3 paste and drop attach images and documents without doubling; 4 text-only paste still inserts text; 5 new Tauri tests run in Actions on the Mac job (unit + cargo + packaged smoke on the CI `.app`), Windows job runs unit + cargo and still builds NSIS; 6 signed `.app` installed to `/Applications/Alamelu Pi Tauri.app` with a backup of the previous copy.

**Review basis.** Full plan, POC note, and the listed source files in the working tree (`sidebar.css`, `sidebar.tsx`, `composer-height.ts`, `composer-attachments.ts`, `tauri-native-attachments.ts`, `tauri-main.tsx`, `App.tsx` diff, `new-thread-view.tsx` diff, `lib.rs` commands and tests, `Cargo.toml`/`Cargo.lock`, `native-build.yml`, `smoke-tauri-packaged.mjs`, `package.json` scripts, `tauri.conf.json`, `tauri-bridge.ts`). Uncertain claims were checked against the vendored `wry 0.55.1`, `tauri-runtime-wry 2.11.4`, and `arboard 3.6.1` sources in the cargo registry.

**Confirmed as stated in the plan (no finding).** `.sidebar__section` has `padding-top: 28px`; `FolderIcon` is gone from repo rows and the chevron remains; `fitComposerTextarea` no longer collapses to 0 first; session `+` goes through `api.pickComposerAttachments()` → `native_pick_attachments` (`tauri-bridge.ts:196`) and new-thread `+` calls it directly with the HTML input fallback; `native_attachments_from_paths`, `native_read_clipboard_image`, `attachment_from_path` exist and are registered; `arboard 3.6.1` already exposes `Get::file_list()` on macOS, Windows and Linux, so plan fix 3 needs no extra crate; `Cargo.lock` already carries `arboard`/`png`; `sign:tauri`, `package:tauri`, `smoke:tauri:packaged` scripts exist; Node engines `>=22.19.0` and CI Node 24 strip TypeScript types natively, so `node --test` can import the `.ts` helpers directly.

### Findings

**R1-01 — MEDIUM — Paste step 2 cannot "preventDefault only when something attaches"**
- Owner requirement: done criteria 3 and 4 (attach on Cmd/Ctrl+V; text-only paste still inserts text).
- Evidence: plan "Production fixes" item 2 says: call native clipboard image, then native clipboard files, "and `preventDefault` only when something attaches". Both native calls are `invoke` round-trips (`tauri-native-attachments.ts:5-12`), so they resolve after the paste event has finished dispatching. The browser runs the default paste action as soon as the handler returns; a `preventDefault()` issued inside the `.then` is a no-op. The POC already had to choose: `App.tsx` `handleImagePaste` calls `event.preventDefault()` synchronously before `requestNativeClipboardImage()` and then swallows the paste even when native returns `null`.
- Consequence: the step is not implementable as written. Whoever builds it must pick a synchronous rule, and the plan does not say which, so criterion 4 is undefined for the "image-looking types, nothing attaches" case.
- Smallest remedy: rewrite step 2 as a synchronous decision. Suggested wording: "If the web clipboard has image/file items → attach, `preventDefault`. Else if `types` look like an image or a file list and there is no `text/plain` → `preventDefault` and call native image then native files; if both return nothing, nothing is inserted. Else (text present, or nothing recognisable) → leave the event alone." State that outcome explicitly so criterion 4 is testable.

**R1-02 — MEDIUM — CI test steps are ordered before the assets they need**
- Owner requirement: done criterion 5 (unit + cargo tests run in the Mac and Windows jobs).
- Evidence: plan "GitHub Actions" puts `test:tauri:unit` and `cargo test` "before the existing app build". (a) `tests/unit/tauri-backend-transport.test.mjs:26` asserts `out/tauri-backend/main.cjs` exists ("build the Tauri backend first") and spawns it. (b) `tauri.conf.json` sets `frontendDist: "../out/tauri"`; `tauri::generate_context!` in `lib.rs` embeds that directory at compile time and fails when it is missing, which is why the repo's own `check:tauri` script runs `build:tauri:assets` before `cargo check`/`cargo test`. In the current workflow those directories are only produced by `beforeBuildCommand` inside `tauri build`, which runs after the planned test steps.
- Consequence: both new CI steps fail on a clean runner, on Mac and Windows, and the workflow never reaches the artifact build.
- Smallest remedy: add one step before the tests in each job: `pnpm --filter @alamelu-pi/desktop run build:tauri:assets` (it also covers the existing session-driver/pi-rpc-driver builds). Alternatively move the two test steps after `tauri build`. Either is one line per job; no new harness.

**R1-03 — MEDIUM — Packaged smoke in CI needs a Pi runtime the runner does not have; escape hatch does not cover it (owner ruling needed)**
- Owner requirement: done criterion 5 says the packaged smoke runs in Actions "against the CI-built `.app`", and the owner pre-approved the implement → Actions → deploy sequence.
- Evidence: `smoke-tauri-packaged.mjs` launches the app with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and asserts `ping === "pi desktop ready"`, `providerCount > 10`, `modelCount > 100`, plus theme, transparency and workspace-picker round-trips. The app resolves `pi` from PATH or home-directory candidates (`lib.rs` `resolve_executable`, `resolve_pi_executable`) and errors when it is absent; `verify:external-runtime` confirms Pi is not bundled. A GitHub `macos-14` runner has no Pi install, no `~/.pi` config and no user GUI session guarantee. The plan's only fallback is "if the runner cannot launch a GUI app, record the exact failure"; the likelier failure is the backend/provider assertions, not window launch.
- Consequence: as written, criterion 5 cannot be met without either installing Pi on the runner (scope growth, not in the brief) or accepting that the CI smoke is best-effort. The plan chooses neither, so the builder will have to decide alone.
- Smallest remedy: owner decides one of: (a) recommended — keep the CI smoke step but widen the fallback to "if the runner cannot run the packaged smoke for an environmental reason (no GUI session, no Pi runtime), record the exact failure in the implementation doc and treat unit + cargo + artifact build as the CI gate"; reword criterion 5 to match; the packaged smoke remains a required local step before the Mac install. Or (b) add a CI step that installs Pi on the runner so the existing assertions can pass; that is scope expansion and needs explicit approval. Dependent CI work is paused until this is ruled.

**R1-04 — LOW — Fix 1 ("no double attach on drop") rests on an unverified premise**
- Owner requirement: done criterion 3 ("without doubling"), owner rule 4 (no hardening code unless it breaks done criteria).
- Evidence: `tauri.conf.json` does not set `dragDropEnabled`, so Tauri's native drag-drop is on. `tauri-runtime-wry 2.11.4` `src/lib.rs:4865-4895` returns `true` from the drag-drop handler, and `wry 0.55.1` `src/wkwebview/drag_drop.rs:90-92` only forwards to WebKit's default `performDragOperation` when the handler returns `false`. So on macOS the HTML5 `drop` in `App.tsx` `handleAttachmentDrop` never receives Finder files while the native listener is installed; there is one path, not two. The POC note does not report doubling either.
- Consequence: a guard written for a case that cannot occur is exactly the "hardening" the owner rules exclude, and it would carry an untestable branch.
- Smallest remedy: make fix 1 conditional on evidence: builder drops one PNG on the packaged app and counts attachments; if one, record that and leave the HTML5 handler untouched (fix 1 = no change); if two, apply the planned guard. Windows behaviour is compiled in only, per the POC note, and stays as is.

**R1-05 — LOW — Rust test bullet re-adds a `.txt` case that already exists**
- Owner requirement: tests copy the idea, no duplicate work (owner rule 1).
- Evidence: plan "Tests → Rust" says "add `attachment_from_path` for a tiny png and a `.txt`". `lib.rs` already has `native_attachment_preserves_file_metadata`, which writes `note.txt` and asserts kind, name, `sizeBytes`, `fsPath`.
- Smallest remedy: change the bullet to "add the tiny-png case beside the existing `.txt` test (`native_attachment_preserves_file_metadata`)".

**R1-06 — LOW — Build-order step 5 commits and pushes `main` while the POC undo backup is untracked and not ignored**
- Owner requirement: plan "Undo backup stays until ship"; repo rule "never delete temp artifacts without approval"; owner git vocabulary rule (untracked ≠ dirty).
- Evidence: `.poc-ui-attach-20260913/` is untracked and `git check-ignore` reports it is not ignored. Same for the four `documents/plan-audit-implementation/*.md` files. Step 5 says only "Commit and push `alamelu-tauri` `main`".
- Consequence: a broad `git add` would commit the backup copies of eleven source files into `main`; a narrow add leaves the backup's fate unstated after ship.
- Smallest remedy: in step 5 say "add only the listed source, test, workflow and document files; the `.poc-ui-attach-20260913/` backup stays untracked and is not committed; after the Mac install is verified, ask the owner before removing it".

### Out-of-scope commentary (not blocking, no action unless the owner wants it)

- C1. `sidebar.css` still carries `.workspace-row__icon-folder { display: none; }` although the element is gone; the plan's "tidy them" step can drop those three lines. The new-thread `+` also dispatches the event with the string literal `"alamelu-native-attachments"` instead of `NATIVE_ATTACHMENTS_EVENT`; same tidy.
- C2. Criterion 4 edge worth one manual check, not code: spreadsheet apps on macOS can put an image rendition on the pasteboard alongside text. If WebKit surfaces that as an image type, `clipboardLooksLikeImage` would swallow a text paste. The wording in R1-01 ("no `text/plain`") covers it if adopted; otherwise add "paste text copied from Numbers/Excel" to the manual verification list.
- C3. Plan could state in one line that unit tests import the `.ts` helpers directly under Node's built-in type stripping (engines `>=22.19.0`, CI Node 24), so nobody reaches for `tsx` or a compile step.

### Verdict

**REVISE.** Three MEDIUM findings (R1-01 paste step not implementable as written; R1-02 CI test steps ordered before required assets; R1-03 CI packaged smoke depends on a Pi runtime and needs an owner ruling). Three LOW findings (R1-04, R1-05, R1-06). No HIGH. R1-03 is an unresolved owner decision; dependent CI work is paused until ruled. Everything else in the plan is consistent with the approved POC and the owner brief.

## Response to Plan Audit Round 1

Builder accepted all six findings. Plan updated in place. No scope expansion.

- R1-01 Accepted. Paste step 2 is now a synchronous rule: web image/file items → attach + preventDefault; image/file types with no text/plain → preventDefault then native image/files (empty result inserts nothing); else leave the event alone.
- R1-02 Accepted. Both CI jobs run `build:tauri:assets` before unit + cargo.
- R1-03 Accepted as critic option (a), aligned with owner no-scope-growth. Packaged smoke remains required locally. CI may try it; environmental failure (no GUI / no Pi on runner) is recorded and does not fail the gate. Unit + cargo + artifact is the CI gate. Do not install Pi on the runner. Not treated as a remaining owner pause: (b) would expand scope, which the owner already forbids.
- R1-04 Accepted. Fix 1 is now "drop one PNG and count; guard only if it doubles."
- R1-05 Accepted. Rust tests add only the tiny-png case beside the existing `.txt` test.
- R1-06 Accepted. Commit lists only source/test/workflow/lock/docs. POC backup stays untracked; ask before deleting it.
- C2 adopted as a manual check (Numbers/Excel text paste). C1/C3 noted; C1 tidy allowed under "tidy the POC files."

## Plan Audit Round 2

**Date:** 2026-09-13
**Reviewer:** claude (fable, effort high)
**Session:** ECA4E294-412C-47C6-8B29-051ACB02B016

### Restated outcome, scope, done criteria

Unchanged from Round 1. Outcome: ship the approved POC as the Tauri product (brand gap, no folder tile, non-jumping composer, `+` = Attach via native picker, Cmd/Ctrl+V and drag-drop for images and documents), add Tauri-relevant tests, run them in GitHub Actions, install the signed `.app` on this Mac. Scope: `alamelu-tauri` only; reuse POC files; no Electron, Playwright, WebDriver, Windows install, notarization, or Pi on the runner. Done criteria 1-6 as in the plan, with criterion 5 now reading: unit + cargo after `build:tauri:assets` on both jobs, artifact build, local packaged smoke required before install, CI smoke best-effort with environmental failures recorded.

### Round 1 repairs verified in the plan text

- R1-01: "Production fixes" item 2 now states the synchronous rule (web items → attach + `preventDefault`; image/file types with no `text/plain` → `preventDefault` then native image, native files, empty result inserts nothing; otherwise leave the event alone). Matches. Closed.
- R1-02: "GitHub Actions" runs `build:tauri:assets` before unit + cargo in both jobs; done criterion 5 says the same. Matches. Closed.
- R1-03: done criterion 5 and the Actions section adopt option (a): no Pi on the runner, local packaged smoke required, CI smoke failure recorded and not a gate. Owner ruling relayed by the orchestrator as closed. Closed; no open owner decision from Round 1.
- R1-04: fix 1 is now "drop one PNG on the packaged app and count; guard only if it doubles; Windows compiled-in only". Matches. Closed.
- R1-05: Rust test bullet keeps the existing `.txt` case and adds only the tiny-png case. Matches. Closed.
- R1-06: build-order step 5 lists what is added, keeps `.poc-ui-attach-20260913/` untracked and uncommitted, and asks before removal. Matches. Closed.
- C2 adopted in the manual verification list; C3 adopted in the tests section. C1 covered by "tidy them".

### Findings

**R2-01 — MEDIUM — `test:tauri:unit` in CI includes a test that requires a Pi executable, which the ruling forbids on the runner**
- Owner requirement: done criterion 5 ("unit + cargo + artifact" is the CI gate; "Do not install Pi on the runner").
- Evidence: the plan's Actions step 2 runs `pnpm --filter @alamelu-pi/desktop run test:tauri:unit` ("updated list"). That script already includes `tests/unit/tauri-backend-transport.test.mjs`, whose `findPi()` (lines 13-24) looks for `PI_GUI_PI_BIN` or a `pi` on `PATH` and throws `"Pi executable is required for the Tauri backend test"` when neither exists, before any assertion runs. A GitHub `macos-14` or `windows-2022` runner has no Pi. R1-02's asset step fixes the "build the Tauri backend first" assertion but not this one. I missed this in Round 1; it is a pre-existing defect surfaced within rounds 1-3.
- Consequence: the CI unit step fails on both jobs on every push, so the gate the owner approved in R1-03(a) is red from the first run, and the workflow never reaches `tauri build`.
- Smallest remedy: give CI a Pi-free list. Either add a `test:tauri:unit:ci` script that runs `tauri-api-parity.test.mjs` plus the new helper tests (clipboard helpers, `fitComposerTextarea`, native-attachment event helper) and call that from both jobs, or pass the explicit file list on the CI command line. Keep the transport test in the local `test:tauri:unit` list. No source change to the transport test, no Pi on the runner.

**R2-02 — MEDIUM — Paste rule ordering can leave Finder-copied documents unattached, defeating fix 3**
- Owner requirement: owner brief "Cmd/Ctrl+V for images AND documents"; done criteria 2-3; fix 3 exists precisely so documents attach on paste.
- Evidence, verified: fix 2 bullet 1 says "if the web clipboard has image or file items → attach those and `preventDefault`". For a non-image `File` item with no filesystem path, `readFileAttachmentFromFile` (`composer-attachments.ts:147-171`) returns `null` because WebKit `File` objects have no `.path` and `tauri-bridge.ts:79` `getPathForFile` returns `""`. So bullet 1 consumes the event, attaches nothing, and the native `file_list()` call in bullet 2 is never reached. Bullet 2 is additionally gated on "no `text/plain`", and a Finder copy commonly carries the file name as plain text.
- Evidence, not verified: whether WKWebView exposes `File` items and/or `text/plain` for a Finder-copied file. I attempted a live pasteboard probe from this session; it stalled on a macOS automation-permission prompt and I stopped it rather than keep driving the desktop (clipboard restored). WebKit has supported `clipboardData.files` for Finder-copied files since Safari 11, so the trigger is likely, but treat that as the builder's one-paste check, not a proven fact.
- Consequence: if either trigger holds, the most common macOS document-paste path (copy in Finder, Cmd+V) attaches nothing, and text-only paste protection from R1-01 becomes the reason. The rule as written does not define the "web file item yields no attachment" case at all, so it needs a decision either way.
- Smallest remedy (wording only, no new code paths beyond fix 3): reorder precedence so files win over text and native paths are the source of truth when files are present. Suggested: (1) if `types`/items include `Files` or file items → `preventDefault`; call native `file_list()` and attach from paths; only if that returns empty, fall back to the web `File` objects (this keeps the existing synthesized-paste smoke green, since a synthetic `DataTransfer` has no OS files behind it). (2) Else if `types` look like an image and there is no `text/plain` → `preventDefault`, native image. (3) Else leave the event alone. Ordinary text has no `Files` type, so R1-01's protection stands; spreadsheet copies (C2) have image types plus `text/plain` and no `Files`, so text still wins there.

**R2-03 — LOW — Mac deploy backup has no stated destination**
- Owner requirement: done criterion 6 ("with a backup of the previous copy"); repo rule against losing artifacts.
- Evidence: "Mac deploy" step 1 says "Back up `/Applications/Alamelu Pi Tauri.app` if present" with no path or naming.
- Consequence: criterion 6 cannot be checked, and the owner cannot find the copy to roll back.
- Smallest remedy: name the destination in step 1, for example `~/Desktop/Alamelu Pi Tauri.app.bak-2026-09-13` (or beside the original with a dated suffix), and record it in the implementation doc.

### Verdict

**REVISE.** Two MEDIUM findings (R2-01 CI unit list needs a Pi executable the ruling forbids; R2-02 paste precedence can defeat document paste), one LOW (R2-03 backup destination). No HIGH. No open owner decision: both MEDIUM remedies stay inside the approved scope and reduce, not add, work. Round 1 findings are all verified closed and are not re-raised.

## Response to Plan Audit Round 2

Builder accepted all three findings. Plan updated in place.

- R2-01 Accepted. CI runs a Pi-free file list (parity + new helpers). Transport test stays local-only.
- R2-02 Accepted. When Files are present: preventDefault, native `file_list()` first, web File objects only if native is empty. Image-only path unchanged. Text (including spreadsheet + image rendition) still left alone.
- R2-03 Accepted. Backup path is `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13`.

## Plan Audit Round 3

**Date:** 2026-09-13
**Reviewer:** claude (fable, effort high)
**Session:** ECA4E294-412C-47C6-8B29-051ACB02B016

### Restated outcome, scope, done criteria

Unchanged from Rounds 1 and 2. Ship the approved POC as the Tauri product (brand gap, no folder tile, non-jumping composer, `+` = Attach via native picker, Cmd/Ctrl+V and drag-drop for images and documents), add Tauri-relevant tests, run the Pi-free unit list + cargo in GitHub Actions on both jobs, build the artifacts, run the packaged smoke locally, install the signed `.app` on this Mac with a dated backup. Scope: `alamelu-tauri` only; no Electron, Playwright, WebDriver, Windows install, notarization, or Pi on the runner.

### Round 2 repairs verified in the plan text

- R2-01: done criterion 5 and Actions step 2 now run a Pi-free list (`tauri-api-parity.test.mjs` plus the new helper tests), exclude `tauri-backend-transport.test.mjs` from CI with the reason stated, and keep it in the local `test:tauri:unit` script. Matches. Closed.
- R2-02: fix 2 now says files win over text and native paths are the source of truth; bullet 1 calls native `file_list()` first when `Files`/file items are present and falls back to web `File` objects only if native returns empty; bullet 2 (image types, no `text/plain`) and bullet 3 (leave alone) are unchanged. Matches. Closed.
- R2-03: Mac deploy step 1 names `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13` and records it in the implementation doc. Matches. Closed.

R1-01 through R1-06 remain as verified in Round 2. Nothing is re-raised.

### Findings

**R3-01 — LOW — Fix 2 fallback must capture the web `File` objects before awaiting native**
- Owner requirement: done criterion 3 (paste attaches images and documents); the plan's own note that bullet 1's fallback "keeps the synthesized-paste smoke green".
- Evidence: bullet 1 says "call native `file_list()` ... only if that returns empty, fall back to the web `File` objects". Per the Clipboard API, a trusted paste event's `clipboardData` is put into disabled mode once the handler returns, and WebKit implements this by invalidating the `DataTransfer` after dispatch, so `items`/`files` read after an `await` come back empty. `File` objects extracted synchronously inside the handler stay readable. The plan does not say when the extraction happens.
- Consequence: if the builder reads `event.clipboardData` inside the `.then`, the fallback yields nothing, and the existing synthesized-paste smoke (`tauri-main.tsx` dispatches a `DataTransfer` with a PNG `File`) fails. The smoke would catch it, so this is a wording precision, not a shipping risk.
- Smallest remedy: add one clause to bullet 1: "extract the web `File` objects synchronously in the handler (before the native call) and use that captured list as the fallback".

**R3-02 — LOW — The CI packaged-smoke step is described as non-gating, but nothing makes it non-blocking in Actions**
- Owner requirement: done criterion 5 and R1-03(a) ("unit + cargo + artifact remain the CI gate"); Verification line "GitHub Actions Mac job green for tests + `.app` artifact".
- Evidence: the Actions section says "try packaged smoke ... if it fails because the runner has no GUI session or no Pi runtime, record the exact failure". A failing step fails the job unless it is marked `continue-on-error: true` or placed after the artifact upload; the current workflow uploads the artifact as the last step. As written, the first environmental failure turns the Mac job red, contradicting the "job green" verification line, and the builder would then have to guess between removing the step and marking it non-blocking.
- Smallest remedy: state in the Actions section that the smoke step is `continue-on-error: true` (or runs after `upload-artifact`), so a recorded environmental failure leaves the job green and the gate is exactly unit + cargo + artifact.

### Commentary (not blocking)

- C4. Bullet 1's native-first rule reads the real OS clipboard even for the synthesized paste in the packaged smoke. If the builder's clipboard happens to hold files when running the local smoke, the attachment name will not match `tauri-smoke-paste.png` and the assertion fails. Run the local smoke with no files on the clipboard; no code change needed.

### Verdict

**PASS.** Zero HIGH, zero MEDIUM, two LOW (R3-01, R3-02), no unresolved owner decision. All Round 1 and Round 2 findings are verified closed in the plan text. The two LOW items are wording precisions inside the approved scope; fold them into the plan or apply them during implementation and note that in the implementation doc. Round 3 was the last round for pre-existing plan defects; any later finding requires a builder-introduced regression with causal evidence.

## Response to Plan Audit Round 3

Trivial in-scope LOWs folded into the plan; no extra review.

- R3-01 Accepted. Bullet 1 now extracts web `File` objects synchronously before the native call.
- R3-02 Accepted. CI packaged smoke is after `upload-artifact` and `continue-on-error: true`.
- C4 noted: local smoke with no files on the OS clipboard.

## Implementation Audit Round 1

**Date:** 2026-09-13
**Reviewer:** claude (fable, effort high)
**Session:** C8ACA415-604E-43D2-8623-59707DC3F408
**Phase:** implementation. Plan findings R1-R3 are closed and are not re-opened; only builder-introduced regressions would count.

### Restated outcome, scope, done criteria

**Outcome.** Ship the approved 2026-09-13 POC as the Tauri product: brand-to-repo-list gap, no folder tile on repo rows (chevron stays), a composer that does not jump, `+` = Attach via the native picker on both composers, Cmd/Ctrl+V and drag-drop for images and documents. Tauri-relevant tests run in GitHub Actions (Pi-free unit list + cargo on Mac and Windows, artifact build, best-effort packaged smoke on Mac). Signed `.app` installed on this Mac with a dated backup.

**Scope.** `alamelu-tauri` only. Reuse the POC files; production additions limited to the paste order, native clipboard files via `arboard` `file_list()`, the drop-doubling check, tests, CI, and the Mac deploy. No Electron, Playwright, WebDriver, Windows install, Pi on the runner, notarization. `.poc-ui-attach-20260913/` stays untracked.

**Done criteria.** 1 packaged app shows the approved UI; 2 `+` opens the native picker and attaches images or documents; 3 paste and drop attach images and documents without doubling; 4 text-only paste still inserts text; 5 new tests exist, both Actions jobs run `build:tauri:assets` → Pi-free unit list → cargo → artifact, Mac smoke after upload with `continue-on-error`, packaged smoke required locally; 6 signed `.app` at `/Applications/Alamelu Pi Tauri.app` with backup at `/Applications/Alamelu Pi Tauri.app.bak-2026-09-13`.

### Review basis

Full plan, implementation doc, POC note, all prior audit rounds, and the working-tree diff of every listed file plus `composer-panel.tsx` (one-line `title="Attach"` not in the brief's list but part of the change). Independently re-ran: `node --test tests/unit/composer-helpers.test.mjs tests/unit/tauri-api-parity.test.mjs` (4 pass, Node 26.5.0); `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` (8 pass, including `encodes_clipboard_png_header` and `native_attachment_reads_tiny_png`); `smoke-tauri-packaged.mjs` with `ALAMELU_TAURI_APP_PATH=/Applications/Alamelu Pi Tauri.app` → `OK (47 providers, 748 models, 91 API members)`, so the installed copy itself passes the four new display/drop assertions. `shasum` of the installed executable equals the `target/release` bundle; `codesign --verify --deep --strict` passes on the installed app; backup directory exists with the 01:32 binary. Checked `arboard 3.6.1` sources: `Get::file_list()` is implemented in `platform/osx.rs` and `platform/windows.rs`, so the Windows cargo step compiles the new command. Verified the two macOS-only and one unix-only Rust tests are `cfg`-gated, so `cargo test` on `windows-2022` builds.

### Plan-to-implementation trace

- **Fix 1 (drop doubling).** No guard added; HTML5 `handleAttachmentDrop` unchanged; native `onDragDropEvent` → `native_attachments_from_paths` → `dispatchNativeAttachments`. Matches the plan's "no change unless it doubles" branch on the R1-04 source evidence. The plan's PNG drop count was not performed (see I1-02).
- **Fix 2 (paste order).** `App.tsx` `handleImagePaste`: `hasFilesInDataTransfer` → `preventDefault`, web `File`s captured synchronously, then `requestNativeClipboardFiles()`; native result wins, captured list only when native is empty. Else `clipboardLooksLikeImage && !clipboardHasPlainText` → `preventDefault`, native image, nothing inserted when null. Else the event is left alone. Applied to both composers with per-composer native sinks. Matches R1-01, R2-02, R3-01 wording exactly.
- **Fix 3 (native clipboard files).** `native_read_clipboard_files` uses `clipboard.get().file_list()`, maps `ContentNotAvailable` to empty, filters `is_file()`, reuses `attachment_from_path`. No extra crate. Registered in the invoke handler. Matches.
- **Fix 4 (new-thread `+`).** Native picker first, file-input fallback only when invoke throws, dispatch through `dispatchNativeAttachments` (C1 tidy applied; folder CSS block removed; `data-collapsed` attribute dropped with no remaining CSS reference). Session `+` unchanged and now carries `title="Attach"` in `composer-panel.tsx`. Matches.
- **Fix 5 (`Cargo.lock`).** Carries `arboard 3.6.1` and `png 0.17.16`. Matches.
- **Tests.** Unit: image/file/text predicates, `fitComposerTextarea` grow/cap/shrink asserting no `0px`, native-attachment event helper; `.ts` imported directly. Rust: png header + tiny-png case beside the existing `.txt` case. Smoke: `noFolderTile`, `brandListGapPx >= 28`, `attachTitle`, `droppedFromPaths` via a `.txt`; `ALAMELU_TAURI_APP_PATH` honoured. `test:tauri:unit` includes the helper file; `test:tauri:unit:ci` is the Pi-free list. Matches R1-05, R2-01.
- **CI.** Both jobs: `build:tauri:assets` → `test:tauri:unit:ci` → `cargo test` → `tauri build` → artifact. Mac: ad-hoc sign, upload, then `Packaged smoke (best effort)` with `continue-on-error: true`. Windows keeps NSIS. Matches R1-02, R1-03(a), R3-02.
- **Mac deploy.** Backup path, package, sign, smoke, install all recorded and re-verified above. Matches R2-03 and criterion 6.
- **Repo hygiene.** `.poc-ui-attach-20260913/` untracked, not ignored, not staged. Nothing committed yet (see I1-01).

### Findings

**I1-01 — LOW — Build-order steps 5-6 and the Actions half of done criterion 5 are not yet executed or recorded**
- Owner requirement: done criterion 5 (Actions jobs run the tests and produce artifacts); plan "Build order" 5-6; owner authorized GitHub Actions in this round.
- Evidence: `git log` shows nothing committed today for this work; all fourteen tracked files are unstaged; `/Users/sudhirjha/playground/alamelu/documents/progress.md` has no line for it; the implementation doc has no Actions run URL and no recorded best-effort smoke outcome. This is sequencing, not a defect: local verification (unit, cargo, packaged smoke, install) is complete and passes.
- Consequence: criterion 5 cannot be called met until the Mac and Windows jobs have run green through unit + cargo + artifact, and the plan requires the exact CI smoke failure text (if any) to be recorded.
- Smallest remedy: commit only the listed source, test, workflow, lock and document files, including `apps/desktop/src/composer-panel.tsx` (the smoke's `attachTitle` assertion depends on it) and `Cargo.lock`; leave `.poc-ui-attach-20260913/` untracked; push `main`; append the run URL, both job results, and the smoke step's exact failure text to the implementation doc; add the one `progress.md` line. If unit, cargo or artifact goes red on either job, that is a builder fix and a Round 2, not a change to the gate.

**I1-02 — LOW — The plan's manual verification list is not recorded, and Finder-copied document paste has no check of any kind**
- Owner requirement: done criteria 3-4; plan "Verification → Manual" (gap, no folder tile, type/wrap/Enter, `+`, screenshot paste, drop a PNG and a `.txt`, text-only paste, Numbers/Excel text paste); plan fix 1 ("builder drops one PNG on the packaged app and counts").
- Evidence: the implementation doc records only automated checks and says the drop count was "not driven from this session". The native `file_list()` path (fix 3, the reason documents paste at all) cannot be unit-tested without a live clipboard, is not in the smoke, and is not in the manual list either. The fix-1 no-change decision itself is sound on the `wry 0.55.1` / `tauri-runtime-wry 2.11.4` evidence already verified in R1-04, so the drop count is confirmation rather than a gate.
- Consequence: criterion 3's "documents on Cmd/Ctrl+V" and criterion 4's "text-only paste" have not been observed on the real app by anyone; a WebKit `types` surprise would be found by the owner, not by the builder.
- Smallest remedy: run the plan's manual list once on the installed app and record pass/fail lines in the implementation doc; add two items: "copy a `.txt` in Finder → Cmd+V in the session and new-thread composers attaches it" and "drop one PNG → exactly one attachment". No code change unless an item fails.

### Commentary (not blocking)

- C5. The Mac job runs `cargo test` on the host target and then `tauri build --target aarch64-apple-darwin`, so Rust compiles twice into different `target/` subdirectories. Only relevant if the job approaches its 60-minute timeout; no action unless that happens.
- C6. `Cargo.lock` carries `png 0.17.16` (direct) and `png 0.18.1` (transitive). Cargo resolves both; nothing to do.

### Verdict

**PASS.** Zero HIGH, zero MEDIUM, two LOW (I1-01 outstanding commit/push/Actions record; I1-02 manual list not recorded). Relevant local verification passes and was re-run by the critic, including the packaged smoke against the installed `/Applications` copy. No unresolved owner decision. Every plan fix, test, CI step and deploy step is implemented as the Round 3 plan states, and no accepted plan finding regressed. PASS covers the implemented code and the local deploy; the Actions result must still be appended to the implementation doc per I1-01, and a red unit/cargo/artifact step on either job would open Round 2.
