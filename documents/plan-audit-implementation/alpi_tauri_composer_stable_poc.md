POC — composer stability, no dock, scroll unfreeze

Question this POC answers
Can the chat box keep a ticking work timer without shoving the hint/model/buttons, can the Cursor “Fast Mode” dock stay gone, and can the transcript scroll with the pointer without first clicking inside it?

Owner brief carried in
- Tauri only
- Do not render the extension dock inside the chat box
- Isolate elapsed time so the rest of the footer does not expand/contract
- Transcript scroll should work while the composer is focused (no click-to-unfreeze)
- POC must run something visible without waiting for a real agent run
- Dead-RPC / Luna-for-all-providers is not in this POC
- Cursor “shell did not complete” is not in this POC (see alamelu/documents/TODO-cursor-error-diagnosis.md)
- Implementation + critic + Mac build only after approval

What changed in the working tree
- ExtensionDock is not rendered in the composer
- Footer elapsed label sits in a fixed 26ch slot with tabular numbers
- Idle threads tick a demo “Working for Ns” clock so the slot can be judged without sending a prompt
- Wheel over the transcript, while the composer is focused, scrolls the transcript instead of dying on the textarea
- Textarea is overflow:hidden until it hits the 220px cap, so it is not a second scroll trap

How to inspect
0. Live demo (already running in the browser):
   `/Users/sudhirjha/playground/alamelu-tauri/.poc-composer-stable-20260913/demo.html`
   The footer ticks “Working for Ns”. The Fast Mode dock is not rendered. Click the chat box, then wheel the transcript.
1. Same behaviour in the signed candidate (not /Applications until after approval):
   `/Users/sudhirjha/playground/alamelu-tauri/apps/desktop/src-tauri/target/release/bundle/macos/Alamelu Pi Tauri.app`
2. Open any existing thread. The composer footer should already show “Working for Ns” ticking every second.
3. Watch the hint and model name: they should stay put while the seconds change.
4. Confirm there is no “Cursor; Fast Mode on” strip inside the chat box.
5. Click in the composer, type a line, then move the pointer over the transcript and scroll. It should move immediately. You should not need to click the transcript first.
6. Type until the composer grows. The footer should not shove sideways. The transcript should stay scrollable.

This POC ticks a demo clock even when the session is idle. A real run uses the real elapsed label in the same slot.

Undo
See `/Users/sudhirjha/playground/alamelu-tauri/.poc-composer-stable-20260913/RESTORE.md`.
