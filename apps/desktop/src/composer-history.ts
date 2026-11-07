import type { TranscriptMessage } from "./timeline-types";

/** Where Up/Down recall currently stands in one thread's chat box. */
export interface ComposerHistoryState {
  readonly sessionKey: string;
  /** Position in the thread's history of the text now in the box. */
  readonly index: number;
}

export interface ComposerHistoryStep {
  readonly draft: string;
  readonly state: ComposerHistoryState | undefined;
}

/** The text of the user's own messages in this transcript, oldest first; blank (image-only) ones are skipped. */
export function composerHistoryEntries(transcript: readonly TranscriptMessage[]): string[] {
  const entries: string[] = [];
  for (const item of transcript) {
    if (item.kind === "message" && item.role === "user" && item.text.trim()) {
      entries.push(item.text);
    }
  }
  return entries;
}

/**
 * Terminal-style recall: Up in an empty box brings back the newest message, more Ups go older,
 * Down goes newer and past the newest empties the box. Returns undefined to leave the key alone.
 */
export function stepComposerHistory(options: {
  readonly key: "ArrowUp" | "ArrowDown";
  readonly draft: string;
  readonly hasAttachments: boolean;
  readonly history: readonly string[];
  readonly sessionKey: string;
  readonly state: ComposerHistoryState | undefined;
}): ComposerHistoryStep | undefined {
  const { key, draft, hasAttachments, history, sessionKey, state } = options;
  const recallAt = (index: number): ComposerHistoryStep => ({ draft: history[index] ?? "", state: { sessionKey, index } });
  // Recall continues only while the box still holds the recalled message, unedited, in the same thread.
  const recalling = state !== undefined && state.sessionKey === sessionKey && history[state.index] === draft;

  if (!recalling) {
    if (key !== "ArrowUp" || draft !== "" || hasAttachments || history.length === 0) {
      return undefined;
    }
    return recallAt(history.length - 1);
  }

  if (key === "ArrowUp") {
    return recallAt(Math.max(0, state.index - 1));
  }

  if (state.index + 1 >= history.length) {
    return { draft: "", state: undefined };
  }
  return recallAt(state.index + 1);
}
