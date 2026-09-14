# Existing Grok thread — backend compaction recovery

Owner asked for backend recovery and a separately reviewed permanent fix plan, without building Pi.

## Verification Round 1 — 2026-09-14

- Original session: `01a09979-096a-7f5d-9521-2e6cbe6f13a8`, title starts `I use Alamelu Pi (Electron )`.
- Live file: `/Users/sudhirjha/Library/Application Support/Alamelu Pi/sessions/2026-09-13T06-34-01-450Z_01a09979-096a-7f5d-9521-2e6cbe6f13a8.jsonl`.
- Private backup/candidate/evidence directory: `/Users/sudhirjha/.pi/agent/backups/compaction-recovery-20260914-i6n_6_go`. Raw conversation and generated summary remain private here, not in the repository.
- Saved source SHA256: `cfdb1e68b94cb5c56e3689a7a56a70f2e56a46cce989aeabd450a10d57d03170`; saved leaf `2b464e5b`.
- Used existing Pi 0.85.1 RPC with `--session candidate.jsonl`, `--provider openai-codex --model gpt-6-astra`, no tools/extensions/skills/context files/prompt templates/themes. Sent `compact`, never a work prompt. This bypassed the Cursor summarization path without changing the live model or building Pi.
- RPC confirmed Astra context window 272,000. Actual summary calls consumed 220,109 input tokens total; compaction returned success.
- Pi reported 242,636 tokens before and estimated 27,682 after. Summary has 32229 characters, including the split-turn summary and file-operation appendix.
- Validated all 2141 original entries remain an identical byte prefix; all recent retained entries are unchanged. `firstKeptEntryId=4a091e84` exists in the original.
- Same session ID, generated checkpoint `2fc85aca`. Used Pi SessionManager to restore the candidate's selected model to `cursor/grok-4.6:fast`; xhigh thinking retained. Rebuilt context has 45 messages.
- Summary inspection retained owner scope rules, earlier completed work, the unfinished incomplete-shell capture gate, plan/audit artifacts, and current next steps. It summarizes historical conversation; the newer companion-task Pi launcher fix is documented separately in `documents/PI-UPGRADE-WINDOWS.md`.

## Activation and reopen verification — 2026-09-14

INSTALLED after the owner confirmed Alamelu Pi Tauri was closed. Activation returned `RECOVERY_INSTALLED` for the same session. Installed SHA256 was `3f206cce35284953442f3c569d56abb5924a355280038991305cc9bbe4e642ef`, matching the validated candidate. Original backup remains at `/Users/sudhirjha/.pi/agent/backups/compaction-recovery-20260914-i6n_6_go/original.jsonl`.

The activation script checked app/backend shutdown and both hashes, then atomically replaced only the target JSONL preserving permissions. Reopened `/Applications/Alamelu Pi Tauri.app` through Computer Use: same task title, original `cursor · grok-4.6:fast xhigh` selection, and prior transcript tail visible. Historical compaction failures remain in the untouched transcript cache.

Post-reopen validation confirms the entire candidate is still an identical byte prefix of the live file, including all original history, checkpoint `2fc85aca`, 32,229-character summary and retained-tail boundary `4a091e84`. The app appended a normal hidden `repomem-context` entry `83934b0c` after the restored model entry `33719f39`; it did not overwrite the checkpoint. Live hash at this check: `0d46eb6fef3c8aec03756ad2e39cff2f4654f910257c17819fd1554f364ea067`.

No new prompt was sent and no fresh Grok reply is claimed verified. Trusted provider token usage remains pending a fresh reply; Pi may report `tokens=null` immediately after compaction. The 27,682-token figure is the recovery estimate before the subsequent RepoMem context addition.

No Pi source, adapter source, app binary, settings or authentication files changed during recovery. Original history remains preserved both in the active JSONL and the private backup.
