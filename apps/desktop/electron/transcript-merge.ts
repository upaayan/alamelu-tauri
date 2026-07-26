import type { TranscriptMessage } from "../src/desktop-state";

/**
 * Merges a reconstructed transcript into a cached one without losing anything.
 *
 * Reconstruction from pi's stored session recovers messages and tool calls, but it
 * cannot recreate live-only rows (the "Working…"/"Worked for Xs" activity and summary
 * markers), and a trimmed or missing session file can also hold fewer messages than the
 * cache. So the rebuild is the base, and every cached row it cannot represent is kept,
 * with the result ordered by timestamp.
 */
export function mergeReconstructedTranscript(
  cached: readonly TranscriptMessage[],
  rebuilt: readonly TranscriptMessage[],
): TranscriptMessage[] {
  if (rebuilt.length === 0) return [...cached];

  const rebuiltMessageKeys = new Set(
    rebuilt.filter((item) => item.kind === "message").map((item) => messageMergeKey(item)),
  );
  const rebuiltToolCallIds = new Set(
    rebuilt.filter((item) => item.kind === "tool").map((item) => item.callId),
  );

  const preserved = cached.filter((item) => {
    if (item.kind === "activity") return item.pending !== true;
    if (item.kind === "summary") return true;
    if (item.kind === "tool") return !rebuiltToolCallIds.has(item.callId);
    return !rebuiltMessageKeys.has(messageMergeKey(item));
  });

  return [...rebuilt, ...preserved]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byTime = Date.parse(left.item.createdAt ?? "") - Date.parse(right.item.createdAt ?? "");
      if (Number.isFinite(byTime) && byTime !== 0) return byTime;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function messageMergeKey(item: Extract<TranscriptMessage, { kind: "message" }>): string {
  return `${item.role}\u0000${item.text}`;
}
