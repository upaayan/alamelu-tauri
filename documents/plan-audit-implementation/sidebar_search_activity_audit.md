# Sidebar search, activity, Show more — audit

## Implementation Audit Round 1

**Reviewer:** codex

**Verdict:** REVISE

### Findings

1. [severity: medium] Linked-worktree sessions are not searchable by their own workspace/worktree name. In `apps/desktop/src/sidebar.tsx:127`, every searchable entry is assigned `group.rootWorkspace.name`, even though `buildThreadGroups` folds linked-worktree sessions into the root group and retains their distinct display label on `thread.environment.label`. `SearchPopup` then checks only that root-level `workspaceName` alongside title and preview. A query for a linked workspace/worktree name therefore misses its sessions unless the same text also appears in the title, preview, or parent workspace name. This directly leaves part of the required “filter sessions by ... workspace name” behavior unimplemented. Use the per-thread frontend display name for linked-worktree entries; no backend change is needed.

### Complete-scope assessment

- Search otherwise supplies the overlay, nine-result cap, title/preview matching, Escape/backdrop close, and session selection.
- The bell replaces the project tree with the five requested recency buckets, includes running/recent threads in Priority, shows the unseen dot, and toggles back.
- Expanded projects show four active threads with Show more/Show less; the archived section remains outside that limit.
- The three implementation files are byte-identical between Alamelu Pi and Alamelu Pi Tauri, and the scoped diff contains frontend files only.

### Verification evidence

- `pnpm exec tsc -p tsconfig.json --noEmit` passed in both desktop packages.
- The production build phase of `pnpm run test:e2e:core` passed in both repositories.
- Real Electron assertions were environment-blocked: Alamelu Pi timed out waiting for `electronApplication.firstWindow`, including an isolated `pnpm run test:core:archive` rerun; Alamelu Pi Tauri reported an incorrectly installed Electron binary before collecting tests. These blockers are not the basis for the REVISE verdict.

## Response to Implementation Audit Round 1

1. Accepted. Searchable/timeline `workspaceName` now uses `thread.environment.label` for linked-worktree sessions and the root workspace name for local sessions. Same change in Alamelu Pi and Alamelu Pi Tauri.

## Implementation Audit Round 2

**Reviewer:** codex

**Verdict:** PASS

No HIGH, MEDIUM, or LOW findings.

### Complete-scope assessment

- Search filters active sessions by title, preview, and the correct frontend workspace display name, including `thread.environment.label` for linked-worktree sessions; results are capped at nine, Escape and backdrop clicks close the overlay, and selection opens the chosen session.
- The bell toggles between projects and the activity timeline. The timeline assigns sessions to Priority (running or updated within 30 minutes), Today, Yesterday, This week, and Older; unseen activity is represented by the bell dot.
- Every expanded project initially shows four active threads and exposes Show more / Show less when needed. The archived section remains separate and unchanged by the limit.
- The current `sidebar.tsx`, `icons.tsx`, and `sidebar.css` files are byte-identical between Alamelu Pi and Alamelu Pi Tauri. The scoped implementation is frontend-only and does not redesign drag-and-drop, archive behavior, or in-thread find.

### Verification evidence

- Round 2 typecheck evidence in both implementation documents reports `PI_GUI_TSC_OK` and `TAURI_TSC_OK` after the linked-worktree fix.
- Per owner instruction, no Electron, Playwright, or e2e tests were rerun during this audit.
