POC — Alamelu Pi Tauri UI / attach / paste

Question this POC answers
Can the Tauri app show the sidebar gap and no repo folder icon, keep the composer from jumping, use + as Attach (native explorer), and paste/drop images plus documents — without a second Electron app?

Owner brief carried in
- Tauri only
- Sidebar: bigger gap after the first row (interpreted as Alamelu Pi brand vs repo list); remove the quadrilateral folder icon on each repo row
- Stop the chat box jumping while typing / wrapping / Enter
- Attach in the chatbot; + already meant Attach — keep it and make the picker work on both composers
- Cmd+V / Ctrl+V and drag-drop for images and documents
- New Tauri-relevant tests later (ideas, not Electron Playwright copies). This POC has one Rust PNG encode check only.

How to inspect
1. Quit Alamelu Pi Tauri if it is already open.
2. From `/Users/sudhirjha/playground/alamelu-tauri/apps/desktop`:
   `pnpm exec tauri dev --config src-tauri/tauri.conf.json`
3. Check: gap under Alamelu Pi; no folder tile on repo rows; type until wrap and press Enter; click + (Attach); paste a screenshot; drop a PNG and a .txt / .md.

Undo
See `/Users/sudhirjha/playground/alamelu-tauri/.poc-ui-attach-20260913/RESTORE.md`.

Limitations (on purpose)
- Windows paste/drop compiled in, not tried on a Windows machine in this POC.
- Finder-copied file with no image/file clipboard types may still need drop or +.
- Full Tauri test harness is not in this POC.
- Chevron stay as the expand/collapse mark after the folder icon is gone.
