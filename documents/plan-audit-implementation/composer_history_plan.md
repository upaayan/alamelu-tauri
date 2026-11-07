# Up-arrow message recall in the chat box: plan

Criteria: [composer_history_criteria.md](composer_history_criteria.md), agreed by Sudhir on 2026-11-07 at 18:41 IST. Audit: [composer_history_audit.md](composer_history_audit.md). Implementation record: [composer_history_implementation.md](composer_history_implementation.md).

Revision 3:
- Revision 2, written after Plan Audit Round 1, took in P1-1 to P1-5, changed how the end-to-end test seeds its thread after a baseline run of the lane, and put criterion I3 to Sudhir.
- On I3, Sudhir chose "option 2" at 18:58 IST: fix the two old tests in this change. See the criteria's "Owner changes" and the new section "Fixing the two old tests (P9)" below.

## Outcome

In a thread's chat box, Up in an empty box brings back your earlier messages from that thread, one at a time, like a terminal. Down comes forward again. Nothing else about the chat box changes.

## Behaviour (P1, P2, P4)

Here "history" means the text of your own messages in the selected thread, oldest to newest. It comes from `activeTranscript` in `App.tsx`, the transcript the app already loads for the selected thread: items with `kind === "message"`, `role === "user"`, and non-blank text. Image-only messages have blank text, so they are skipped. Assistant messages, summaries, tool rows and other threads' messages are never included. For a branched thread, the transcript is the active branch, so recall follows what you see.

Recall state is one small record kept in a `useRef`: the thread key (`selectedSessionKey`), the history position, and the text that was put in the box. You are "recalling" only while all three still hold: the thread key matches, the box text equals the recalled text, and `history[position]` is still that text.

The handler acts only on plain ArrowUp or ArrowDown: no Shift, Alt, Cmd or Ctrl, and not during IME composition.

- **Up, not recalling.** If the box is strictly empty (`""`) and has no attachments, and history is not empty, put the newest message in the box. Otherwise do nothing new; the key works as today.
- **Up, recalling.** Go one older. At the oldest, keep the oldest; the key is still consumed, so the cursor doesn't jump.
- **Down, recalling.** Go one newer. Past the newest, empty the box and stop recalling.
- **Down, not recalling.** Do nothing new.

When we act, `preventDefault()` is called and the draft is set through the existing `setComposerDraft`. The browser puts the cursor at the end of the new text, and the existing effects grow the box and save the draft, as they do for typed text.

Recall ends in these ways:
- **Editing:** the text no longer matches.
- **Sending:** the box becomes `""`.
- **Switching thread:** one added line clears the recall state, `composerHistoryRef.current = undefined`, in the existing `[selectedSessionKey]` layout effect (`App.tsx:1312-1320`). This is needed because drafts are kept per thread (P1-1). An unedited recalled text is saved as the thread's draft and comes back when you return to the thread. Without the reset, the next Up would keep recalling there instead of moving the cursor.

The next Up in an empty box starts again from the newest message.

## What stays the same (P3)

- The new step goes in `handleComposerKeyDown` after the clipboard, `@`-mention and `/`-menu handlers. A key those menus use never reaches it.
- It runs only for a strictly empty box or an unchanged recalled text. In typed or edited text, Up and Down move the cursor as now.
- It runs only for Up and Down, so the Enter, Shift+Enter and Cmd+Enter branches are untouched.
- `event.nativeEvent.isComposing` skips it during IME input.
- `handleNewThreadComposerKeyDown` (the new-thread screen) is not changed.

Accepted consequences, none of which needs code:
- **Multi-line messages.** In a multi-line recalled message you haven't edited, Up and Down switch messages instead of moving between lines. Typing anything, or clicking and typing, ends recall.
- **Menus (P1-2).** A recalled message that ends in `@word` or `/word` opens that menu, as typed text would. The menu then takes Up, Down, Enter and Tab, so recall pauses there. This is what P3 asks for: the menus keep their keys.
- **Skills and templates (P1-3).** pi stores `/skill:…` and prompt-template messages already expanded. Once the transcript has been reloaded from pi (after a restart, for example), Up brings back the expanded text that the transcript shows, not the short command that was typed.

## Files (P5)

- New `apps/desktop/src/composer-history.ts`, about 40 lines. It holds two pure functions:
  - `composerHistoryEntries(transcript)` returns the history list.
  - `stepComposerHistory({ key, draft, hasAttachments, history, sessionKey, state })` returns `{ draft, state }` when the key is handled, or `undefined` to leave the key alone.

  It imports only types (`import type`), like `composer-attachments.ts`. `node --test` loads the `.ts` file directly, and a value import from another `.ts` file would fail there.
- `apps/desktop/src/App.tsx` gets:
  - the import;
  - one `useRef` for the recall state;
  - one reset line in the `[selectedSessionKey]` layout effect;
  - about 12 lines in `handleComposerKeyDown`, placed after the slash-menu handler.
- Test files: `tests/unit/composer-helpers.test.mjs`, `tests/core/composer-controls.spec.ts` (the new test, plus the two test-only fixes of P9), and one new fixture in `tests/helpers/electron-app.ts` (see Verification).
- Nothing in `src-tauri/`, `electron/`, `packages/`, scripts or pi config.

## Verification (P6)

1. **Unit tests** go in the existing `apps/desktop/tests/unit/composer-helpers.test.mjs`. CI's `test:tauri:unit:ci` already runs that file, so `package.json` doesn't change. The cases:
   - what the history includes (only user text, blank skipped, order);
   - Up from empty;
   - Up again, and staying at the oldest;
   - Down, and Down past the newest;
   - typed text left alone;
   - attachments block the start;
   - a thread-key change ends recall;
   - an edited recalled text ends recall.
   - Run: `node --test tests/unit/composer-helpers.test.mjs`.
2. **The real surface.** One new `test(...)` in the existing `apps/desktop/tests/core/composer-controls.spec.ts`, background mode.

   The baseline run of the lane on this Mac (2026-11-07, before any change) showed:
   - the Electron surface starts only with `PI_GUI_DRIVER=rpc` and `PI_GUI_BRAND=alpi`;
   - with those settings, `seedBranchedTreeSessionFixture`'s thread never appears. It writes to pi's default session folder and doesn't register the thread in the app's catalog.

   So the new test gets its own small fixture, `seedComposerHistorySessionFixture`, in `tests/helpers/electron-app.ts`. It copies the proven `seedCompactedModelSwitchSessionFixture`, which passed today: the session file goes in `dirname(agentDir)/sessions`, and the thread is registered in `catalogs.json`. Its messages are user "First question", assistant "First answer", user "Second question", assistant "Second answer", and the title "Composer history fixture". The test launches with `envOverrides: { PI_GUI_BRAND: "alpi", PI_GUI_DRIVER: "rpc" }`, as the compacted-model-switch spec does.

   The test first checks the transcript shows both questions, then:
   - Up gives "Second question", Up gives "First question", and Up keeps "First question";
   - Down gives "Second question", and Down gives `""`;
   - typed text plus Up keeps the typed text;
   - after `createNamedThread` makes a second, empty thread, Up keeps its box empty (current thread only);
   - back in the fixture thread (P1-1, made tighter by P2-2):
     - press Up, then `expect.poll` until `getDesktopState(window).composerDraft` is "Second question" (saved);
     - switch away and back, with the nonce wait;
     - assert the box shows the restored "Second question";
     - press Up and assert it is still "Second question", not "First question".

   Run: `pnpm --filter @alamelu-pi/desktop run build`, then `PI_GUI_PI_BIN=<keg>/dist/cli.js PI_GUI_DRIVER=rpc PI_GUI_BRAND=alpi pnpm --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts`. This runs the whole file, so the two old tests, fixed per P9, must pass too. Their before (failing) and after (passing) runs are both recorded. Here `<keg>` is `/opt/homebrew/opt/pi-coding-agent/libexec/lib/node_modules/@earendil-works/pi-coding-agent`. The helper finds pi's `core/session-manager.js` next to the launcher, and Homebrew's `bin/pi` is a shell wrapper in another folder.
3. **Checks:** `pnpm run typecheck`, then `pnpm run verify:upgrade`, which the Tauri build also runs.
4. **Build and install**, following the 2026-11-07 Mac release route in `documents/REBUILD-PROTECTION.md`:
   - build the Tauri app;
   - sign it with "Alamelu Pi Local Code Signing";
   - check `codesign -dv`;
   - quit the running app, replace `/Applications/Alamelu Pi Tauri.app`, and relaunch it with the Finder environment;
   - check that it launches and finds Homebrew pi.

   Keep the current app aside until the new one is proven, then move it to the Trash (Sudhir's prudent path).

   Release gates (P1-5), from "Installed runtime release gates — both machines":
   - Gates 1–4 are not run. They test pi, the adapter, compaction and model switching, and this change touches none of them.
   - Gate 5 is run on the Mac: the new build's backend bundle hash must equal the installed app's. That also confirms the change is renderer-only.
   - This implementation record stands in for gate 6's dated release record.
   - Windows/WSL stays as P8 says: CI builds it, and it is not installed.
5. **Sudhir tries it** in the installed app.

## Documents (P7)

- **Markdown files.** A search of `README.md`, `apps/desktop/README.md`, `AGENTS.md`, `documents/` and `apps/desktop/tests/AGENTS.md` found no document that lists the chat box's keys.
- **Places in the app (P1-4).** The app lists some keys itself: Settings > General > Shortcuts (`settings-general-section.tsx:104-111`) and the composer hint (`composer-panel.tsx:177-179`). Both are left unchanged, because P5 limits the code to `App.tsx` and one helper. If Sudhir wants an "Up: previous message" row, that is a later change.
- **Written here:** only the four records. `REBUILD-PROTECTION.md` is unchanged, because this change adds no rebuild protection.

## Persistence (P8)

- One commit to `upaayan/alamelu-tauri` `main` with only these files, pushed after `git fetch` and a check for other people's commits.
- The record update comes in a follow-up commit marked `[skip ci]`.
- CI's native builds must pass for the code commit.
- On the Mac: the signed app in `/Applications`.
- Windows: CI builds the installer; it is not installed on Windows in this change.
- Repo-memory cards: none.

## Fixing the two old tests (P9)

Both tests are in `apps/desktop/tests/core/composer-controls.spec.ts`. They fail before any change: 3 of 3 runs on 2026-11-07. Both fixes are in the test file only and keep what each test checks.

**How the lane is run on this Mac.** Set:
- `PI_GUI_PI_BIN=<keg>/dist/cli.js`;
- `PI_GUI_DRIVER=rpc` and `PI_GUI_BRAND=alpi`.

Without the last two, the Electron surface stops at start with "DesktopAppStore requires an explicit session driver". The default brand picks the `sdk` driver, which the store refuses (`electron/app-store.ts:172-173`, `electron/rpc-driver-config.ts:88-95`). These are run settings only, as in earlier release records. The fix is not to bake them into the old tests, which run under whatever the lane sets.

**1. "supports keyboard shortcuts, slash menus, and topbar controls…" (fails at line 154).**
- **Cause.** `dblclick({ position: { x: 140, y: 12 } })` lands on a button inside `.topbar__left`. A diagnostic run measured `.topbar__left` at x 86–224, y 11–41, and the element at (140, 12) is `BUTTON.icon-button topbar__icon`. The top bar's handler ignores double-clicks on buttons and on `.topbar__left` on purpose (`src/topbar.tsx:66-76`). The left group grew (sidebar toggle, search, bell, folder), so the old fixed point now falls inside it. Every step before line 153, including the slash-menu arrows, passes.
- **Second problem.** Really maximising the hidden background window makes it appear on screen. The diagnostic showed `isVisible()` true after a real toggle. Sudhir's rule is that background test work must not put windows on his screen.
- **Fix:**
  - Double-click an empty part of the bar, worked out from the layout: 24 px right of `.topbar__left`'s right edge, at the bar's vertical middle. Before clicking, the test checks that `document.elementFromPoint` there is the top bar itself.
  - Replace that `BrowserWindow`'s `isMaximized`, `maximize` and `unmaximize` with a small in-memory flag, through `harness.electronApp.evaluate`. Do this before `maximizedBefore` is read, so both readings come from the same flag. The app's real handler (`electron/main.ts:1135-1147`) then runs its real toggle, but the window stays hidden.
  - The assertion is unchanged in form: `isMaximized()` flips.
  - What it now proves (P2-2): a double-click on an empty part of the bar reaches the app's real toggle handler, and the handler toggles. It no longer proves that the operating system maximises a real window, because a real maximise shows the hidden window on Sudhir's screen.
  - If `BrowserWindow.fromWebContents` turns out to return a different object from `getAllWindows()[0]`, patch through `fromWebContents(webContents)` on the window's own web contents instead.

**2. "dark mode keeps the send button visible before and after typing" (fails at line 209).**
- **Cause.** The test types the moment `selectSession` re-selects the open thread. The app's selection update (`composerDraftSyncSource: "selection"`) arrives a few milliseconds later. The hydrate effect (`src/App.tsx:1042-1063`) then puts the thread's saved draft, which is empty, back in the box. So the send button stays disabled.
- **Evidence.**
  - A screenshot at the failure shows an empty box.
  - The same steps with a little more time before typing pass: two diagnostic runs kept the text, and the next state event was the normal save 350 ms later.
- **Fix:** read `composerDraftSyncNonce` from `getDesktopState` before `selectSession`, and `expect.poll` until it goes up before typing. The contrast checks are unchanged.
- **The new recall test** uses the same wait after each thread selection, so the same race can't make it flaky.

**Seen but not fixed** (outside the two tests Sudhir named):
- `tree-command.spec.ts` fails for the same seeding reason as `seedBranchedTreeSessionFixture`.
- The app itself has a tiny real race: clicking the thread that is already open within about 350 ms of typing puts the saved draft back. This is reported to Sudhir in one line; no code change.
