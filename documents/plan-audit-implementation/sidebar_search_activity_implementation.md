# Sidebar search, activity, Show more — implementation

Implementation-only. Owner approved the POC in Alamelu Pi Tauri
("looks good") and asked debate-loop for the same behavior in
**Alamelu Pi** and **Alamelu Pi Tauri**.

## Owner scope

Copy three Codex / sudhir-codex-tauri sidebar behaviors:

1. **Search (magnifier)** — overlay chat picker. Filter sessions by
   title, preview, or workspace name. Top 9. Esc / backdrop closes.
   Selecting a result opens that session.
2. **Bell (recent activity)** — toggle replaces the project tree with a
   recency timeline: Priority (running or touched in last 30 minutes),
   Today, Yesterday, This week, Older. Unseen threads show a dot on the
   bell. Toggle back to projects.
3. **4 + Show more** — each expanded project shows 4 threads, then
   Show more / Show less. Archived section unchanged.

Same UI in both harnesses. No backend changes. Do not redesign the
sidebar, drag-and-drop, archive, or in-thread find-in-page search.

## What changed

Identical edits in:

- `alamelu-pi-gui/apps/desktop/src/sidebar.tsx`
- `alamelu-pi-gui/apps/desktop/src/icons.tsx`
- `alamelu-pi-gui/apps/desktop/src/styles/sidebar.css`
- `alamelu-tauri/apps/desktop/src/sidebar.tsx`
- `alamelu-tauri/apps/desktop/src/icons.tsx`
- `alamelu-tauri/apps/desktop/src/styles/sidebar.css`

`SearchIcon` / `BellIcon` added. Threads header tools: search, bell,
open folder. `COLLAPSED_THREAD_COUNT = 4`. Timeline buckets from
`session.updatedAt` + running status. Search overlay is a fixed dialog.

## Verification Round 2

Linked-worktree search uses `thread.environment.label`.

```text
$ pnpm exec tsc -p tsconfig.json --noEmit   # both desktop packages
PI_GUI_TSC_OK
TAURI_TSC_OK
```

## Verification Round 1

```text
$ pnpm exec tsc -p tsconfig.json --noEmit   # alamelu-pi-gui/apps/desktop
PI_GUI_TSC_OK

$ pnpm exec tsc -p tsconfig.json --noEmit   # alamelu-tauri/apps/desktop
TAURI_TSC_OK

$ diff -q pi-gui vs tauri sidebar.tsx icons.tsx sidebar.css
identical
```

## Out of scope

- In-transcript find (`ThreadSearchBar`)
- Rebuilding / replacing `/Applications/Alamelu Pi.app`
- Project-list Show more (only per-project threads)
- Persisting expanded/timeline state
