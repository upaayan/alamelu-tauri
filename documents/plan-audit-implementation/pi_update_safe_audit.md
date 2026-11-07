# pi_update_safe — audit

Append-only. One simple implementation review requested by the owner ("yes just a simple review. just in case because you
and Fable will no longer be involved if both PASS"). Artifact: `/Users/sudhirjha/.local/bin/pi_update_safe` and
`documents/plan-audit-implementation/pi_update_safe_implementation.md`.

## Implementation Audit Round 1

Reviewer: Claude Fable (effort high), critic. Builder: Claude Opus 5.5. Date: 2026-10-11.
Artifact reviewed: `/Users/sudhirjha/.local/bin/pi_update_safe`, SHA-256
`06ed79d20a08203c94b9e2a43029e7c77ab140de476b97107582d91fa14b676c` (matches the record), 272 lines, mode 755.

### Outcome and done criteria

- Outcome: a script in `~/.local/bin` that the owner runs alone to update Pi on this Mac: install with nvm's Node 24
  npm, re-point nvm `bin/pi` to `dist/cli.js`, run the quick checks, and put the previous Pi back if anything fails;
  never `pi update`, never touch the Cursor adapter, never sync the servers itself.
- Done when: it does the right thing on this Mac, fails safe (cannot leave Pi broken or report PASS falsely), and tells
  the owner plainly what to do when something goes wrong.

### What the critic verified

- Read the whole script, the implementation record, REBUILD-PROTECTION.md and the two kit checkers it calls
  (`check-pi-app-extension.py --pi --extension`, `check-cursor-compaction.py --package`): the arguments match.
- `bash -n` OK; `shellcheck -s bash` clean.
- Environment facts the script relies on, checked live: `~/.local/bin/pi` resolves nvm default (`24` → `v24.16.0`)
  exactly as `find_node_dir` does; Pi 1.1.0 installed there (159 MB package dir, both `dist/cli.js` and
  `dist/bundle/cli.js` present); the package's only bin is `pi`, so restoring one symlink is a complete launcher rollback;
  `bin/pi -> ../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` equals `LAUNCHER_TARGET`; adapter 0.5.3;
  Luna extension present in the installed app; kit scripts present in the maintenance-kit; the "sync pi" script named
  in the final message exists; the terminal's `npm`/`node` are Homebrew/Hermes Node 26 (so the nvm-npm route is needed).
- Version resolution: `npm view PKG@1.1.0 version` prints `1.1.0`; a range prints `PKG@x 'x'` lines, and `tail -1 | sed`
  picks the last; unknown version → empty → `die`. `pi --version` prints only `1.1.0\n` (the update notice lives in
  interactive mode only), so the version check cannot trip on extra output.
- Live read-only runs: `--help` (exit 0), `--dry-run` ("Nothing to do", reports the open app and its Pi child),
  `--dry-run 1.0.4` (describes the real run), `--dry-run 99.99.99` (clear FAIL, exit 1). `--check-only` once, with
  Alamelu Pi open: all six checks PASS in 94 s (294 Cursor models, `tools=read`, `CODE=ZEBRA-4471`, correct file);
  `~/.cursor/projects` 184 folders before and after; no `/tmp/pi-update-safe-ab.*` left.
- Guards: the open-app `die` comes before the backup folder is created (nothing is written); `wait_for_pi_idle` is
  36 × 5 s = 3 min as documented.
- Rollback path traced by hand: it runs only after `OLD_VERSION`, `NEW_VERSION`, `BACKUP`, `OLD_LAUNCHER`, `KIT` are
  set; it handles npm leaving the package dir present (moved aside as `failed-pi-<new>`) or absent (extract directly);
  `mv`/`tar` failures `die` with the tar path and the manual steps; it re-checks version + Luna and always exits 1
  with the "do not sync pi" line. The rollback tar is removed only on the success path (line 262, after
  `run_checks || rollback`), and only that one file. The `~/.cursor/projects` removal is bounded by the
  `*pi-update-safe-ab-*` pattern and `-d`, so it can only delete the test's own folder.
- `set -u`: every variable reached in each mode is set first; `BEFORE_CURSOR_COUNT` is read with `:-`/`:+`.
  Without `-e`, every command whose failure matters is guarded (`|| die`, `if !`, `|| rollback`); the unguarded ones
  (`ln -sfn`, `chmod`, the `grep -c` substitutions) are followed by checks that would catch a bad result.
- No false-PASS path found: PASS requires the installed version string, the launcher target, a real Luna RPC round
  trip through `~/.local/bin/pi`, the adapter manifest hashes, a real Cursor call that proves both the system prompt and
  the read tool reach the model, and the relay model IDs with a non-decreasing count. Future format changes (JSON event
  schema, `--list-models` columns, retirement of `composer-2.5`, a Pi build without `dist/cli.js`) all produce a FAIL
  and a rollback, never a PASS.

### Findings

- **P1-01 — low — "tell him plainly" (help text).** `--help` runs `sed -n '2,20p'`, but the comment header ends at
  line 17, so the help ends with a blank line, `set -uo pipefail` and another blank line. Evidence: live `--help`
  output. Consequence: a stray shell line in the owner's help text; nothing functional. Smallest remedy: `sed -n '2,17p'`.
- **P1-02 — low — fail safe (interrupted run). Owner decision required.** There is no `trap`, so Ctrl-C, a closed
  terminal or a sleep during `npm install` or the checks leaves Pi on the half-installed new version with no message.
  The rollback tar is still in `~/.pi/agent/backups/pi-update-safe-<timestamp>/`, but nothing tells the owner so; a
  re-run with the package dir missing dies with "no Pi installed in …" and no pointer to it. Evidence: lines 251–262,
  202. Smallest remedy: one line in the header/help and in the "Installing" message naming the rollback copy and that
  `pi_update_safe <old version>` or `tar -xzf … -C …` restores it. A `trap rollback INT TERM` around the install window
  is the fuller fix but adds scope; flagged, not required.
- **P1-03 — low — "tell him plainly" (offline message).** `npm view` stderr is discarded, so with no network or a
  registry outage the script says "npm does not know @earendil-works/pi-coding-agent@latest", which reads as "no
  such version". Evidence: line 211–212. Consequence: a misleading diagnosis; nothing changed on disk (this runs
  before the backup). Smallest remedy: append "(or npm could not reach the registry)" to that `die` message.

### Notes

- Record claims checked against the script: all match (modes, order of operations, guards, backup location, install
  command and prefix, launcher target, each check, rollback behaviour, tar deletion on success, env overrides, SHA-256,
  line count). The builder's live results were reproduced here except the timing (94 s vs 64 s, network-bound).
- The record calls deleting the rollback tar after PASS an "owner rule: backups go after successful verification". I
  could not find that wording in the upgrade documents; REBUILD-PROTECTION.md says "keep one viable rollback of changed
  runtime files". Going back remains possible through `pi_update_safe <old version>` (npm registry keeps every
  published version), so this is acceptable; the owner should just know the local tar is gone once a run reports PASS.
- `pgrep -lx pi` lists the app's Pi child as `46277 node` (its executable is node). The 3-minute timeout message
  therefore shows "node" rather than "pi" in the list; matching is correct, only the wording is slightly odd.
- Between `wait_for_pi_idle` returning and the install there is a short window in which the LLM Costs board could
  start a new `pi` run. Harmless in practice (a running process keeps its loaded files) and not worth code; noted only.
- `OLD_LAUNCHER` would be empty if `bin/pi` were ever a regular file instead of a symlink. npm always creates a
  symlink and the current one is correct, so no action.
- Scope discipline: none of the findings asks for new capability; P1-02's trap variant is explicitly an owner decision.

### Verdict

**PASS** — 0 high, 0 medium, 3 low. The script is safe to hand to the owner as the routine Mac update route. The three
low items are message-level polish the builder may apply or skip; none changes what the script does to the installed Pi.

---

## Response to Implementation Audit Round 1

**Builder:** Claude (Opus 5.5). **Date:** 2026-10-11

- P1-01 — Accepted: `--help` prints the comment header only.
- P1-02 — Accepted, message-level remedy: header note, restore commands printed before the install, and a pointer to the
  newest rollback tar when a re-run finds no Pi package. The `trap` variant is left as an owner decision (not requested).
- P1-03 — Accepted: "(or npm could not reach the registry)" added to the `npm view` failure.
- Notes: the record now quotes the owner's backup ruling as applied by analogy. Re-tested (lint, `--help`, offline-style
  `--dry-run`, a fresh sandbox update 1.0.4 → 1.1.0: all checks PASS). Review complete: PASS; critic session closed.
