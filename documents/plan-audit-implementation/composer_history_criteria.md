# Up-arrow message recall in the chat box: success criteria

Status: agreed. Written 2026-11-07 17:48 IST; Sudhir agreed at 18:41 IST: "great!! go ahead". His go-ahead covers the plan and the implementation these criteria describe.

## Sudhir's words

- 7 Nov 2026: "In Alamelu Pi Tauri, I wanted to implement the Up Arrow gets me the previous chat text functionality if the current chatbox is empty. Is this easy? difficult? does this require Rust build? Will it break anything?"
- His answers to the three choices put to him:
  - "1 --> (b) sounds nice". Option (b) was: "Pressing Up again goes further back and Down comes forward, like a terminal."
  - "2 --> yes. current thread only". The recommendation he accepted was "Your messages in the current thread. They come from the thread itself, so they're still there after you restart the app."
  - "3 --> yes. always debate-loop, darling. maker checker is the only useful thing accountants have invented in our entire history. May as well use it."
- These answers came after the "Will it break anything?" answer he was given, which this change must keep to:
  - Up only acts when the box is empty, so arrow keys in typed text still move the cursor.
  - The `/` and `@` menus keep their arrow keys.
  - Japanese-style (IME) input is left alone.
  - Only the text comes back, not attachments.
  - Getting it into the app needs a full rebuild and re-sign, although no Rust code changes.

Critic: Opus high (the default; Sudhir named no other).

## Plan criteria

- **P1 Behaviour.** The plan states the exact key behaviour in the thread chat box:
  - Plain Up (no Shift, Alt, Cmd or Ctrl) in an empty box (no text and no attachments) puts the text of the newest of your earlier messages in this thread into the box.
  - Each further Up goes one message older and stops at the oldest.
  - Down goes one message newer; Down past the newest leaves the box empty.
  - Checked: the plan has a behaviour section saying exactly this. Evidence: the plan.
- **P2 Which messages.** Only your own messages (role user) in the currently selected thread, oldest to newest, taken from the thread's transcript the app already loads. Messages with no text (image-only) are skipped. No other thread's messages and no assistant messages. Checked and evidenced in the plan.
- **P3 Nothing else changes.**
  - The `/` and `@` menus keep their arrow keys.
  - Up and Down in a box holding typed text, or recalled text you have edited, move the cursor as today.
  - IME composition is left alone.
  - Enter, Shift+Enter and Cmd+Enter behave as today.
  - The new-thread screen is unchanged.
  - Checked: the plan says how each of these is kept. Evidence: the plan.
- **P4 When recall ends.** The plan says recall stops when you type into or edit the recalled text, when you send, and when you switch thread. After that, Up in an empty box starts again from the newest message. Evidence: the plan.
- **P5 Smallest change.** The change is in the renderer only: `apps/desktop/src/App.tsx` plus at most one small helper file. No Rust, Electron main/backend, driver or pi changes. The plan names the files. Evidence: the plan.
- **P6 Verification.** The plan lists:
  - a unit test for the helper (`node --test`);
  - a core Playwright spec on the Electron surface, in background mode;
  - the existing `composer-controls.spec.ts` rerun;
  - `pnpm run typecheck`;
  - `pnpm run verify:upgrade`, which the build runs anyway;
  - the Tauri build, local signing and install in `/Applications`;
  - Sudhir's own check in the installed app.
  - Evidence: the plan.
- **P7 Documents.** The plan lists every document that changes, found by searching the repo's documents for chat-box keyboard behaviour, and says why other documents are not touched. Evidence: the plan.
- **P8 How it persists.**
  - A commit to `upaayan/alamelu-tauri` `main`, pushed.
  - On the Mac: the rebuilt app, signed with "Alamelu Pi Local Code Signing", installed in `/Applications`.
  - Windows: CI builds the installer; installing it on Windows is not part of this change.
  - Repo-memory cards: none.
  - Evidence: the plan.

## Implementation criteria

- **I1 It works.**
  - In a thread with at least two earlier messages: Up in an empty box shows the newest, a second Up shows the one before, Down comes back, and Down past the newest empties the box.
  - Checked by the new core Playwright spec, and by Sudhir in the installed app.
  - Evidence: Verification Round N of `composer_history_implementation.md`, with real output.
- **I2 Current thread only.** With two threads, Up in one never shows the other's messages. Checked by the same spec. Evidence: Verification Round N.
- **I3 Nothing else broke.**
  - Up and Down in typed text do not replace it.
  - The existing `composer-controls.spec.ts` (slash-menu arrows, shortcuts) passes.
  - Checked by the specs. Evidence: Verification Round N.
- **I4 Checks pass.**
  - the helper's unit tests
  - `pnpm run typecheck`
  - `pnpm run verify:upgrade`
  - the Tauri build
  - Evidence: Verification Round N.
- **I5 Installed.**
  - The rebuilt app is in `/Applications`, signed by "Alamelu Pi Local Code Signing" (`codesign -dv`).
  - It launches and still finds Homebrew pi.
  - Evidence: Verification Round N.
- **I6 Small diff.**
  - The code diff touches only the renderer files the plan names, plus tests.
  - Nothing in Rust, Electron main/backend, drivers or pi config.
  - Checked with `git diff --stat`. Evidence: Verification Round N.
- **I7 Records and documents.**
  - The documents listed in the plan are updated.
  - The four records (criteria, plan, audit, implementation) are complete.
  - Evidence: the files.
- **I8 Persisted.**
  - Committed (only this change's files) and pushed to `main`.
  - The CI run for the commit passes.
  - Repo-memory cards: none.
  - Evidence: Verification Round N, with the commit id and the CI run id.

## Owner changes

- **2026-11-07 18:58 IST.** I3 as agreed says the existing `composer-controls.spec.ts` passes. A baseline run before any change showed both of its existing tests already failing. Sudhir was offered two choices:
  1. Read I3 as "no change from the baseline".
  2. Fix the two old tests as part of this change.

  He chose: "option 2". So I3 now means both existing tests in `composer-controls.spec.ts` pass after the change. The plan gains **P9**, and the criteria change as follows:
  - **I3 (changed).** Up and Down in typed text do not replace it. Both existing tests in `composer-controls.spec.ts` pass: "supports keyboard shortcuts, slash menus, and topbar controls through the user surface" and "dark mode keeps the send button visible before and after typing". They are fixed in the test file only, with no app-code change, and still check what they checked before. Evidence: Verification Round N, with the run before (failing) and after (passing).
  - **P9 (new).** The plan gives each old test's cause with evidence, and the smallest test-only fix that keeps the test's purpose. It also says how the lane is run on this Mac (`PI_GUI_PI_BIN`, `PI_GUI_DRIVER=rpc`, `PI_GUI_BRAND=alpi`). Evidence: the plan.
  - **P5 and I6 (scope note).** The test-only fixes add `tests/core/composer-controls.spec.ts` edits beyond the new test, which is already a test file that I6 allows. There are still no app-code changes beyond `App.tsx` and the helper.
