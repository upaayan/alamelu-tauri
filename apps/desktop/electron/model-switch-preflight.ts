export interface ThreadStats {
  /** Active Pi context content chars/4; absent when unavailable. Used with a safety factor. */
  readonly estTokens?: number;
}

export interface TargetModel {
  readonly providerId: string;
  readonly modelId: string;
  readonly contextWindow?: number;
  readonly api?: string;
  /** Whether the provider has any credential configured (not whether it still works). */
  readonly connected?: boolean;
}

export type PreflightVerdict = "ok" | "warn" | "block";

export interface PreflightDecision {
  readonly verdict: PreflightVerdict;
  readonly reason?: string;
}

const CONTEXT_SAFETY_FACTOR = 0.9;

/**
 * Decides whether switching a thread to `target` is safe.
 *
 * Only blocks failures that are certain: the thread cannot fit, or the provider has no
 * credential at all. Missing metadata never blocks — an unknown case is left to the
 * run-time error message instead.
 */
export function evaluateModelSwitch(stats: ThreadStats, target: TargetModel): PreflightDecision {
  if (target.connected === false) {
    return {
      verdict: "block",
      reason: `${target.providerId} is not connected. Reconnect it in Settings → Providers to use its models.`,
    };
  }

  if (target.contextWindow !== undefined && target.contextWindow > 0) {
    const limit = Math.floor(target.contextWindow * CONTEXT_SAFETY_FACTOR);
    if (stats.estTokens !== undefined && stats.estTokens > limit) {
      return {
        verdict: "block",
        reason: `This thread is about ${stats.estTokens.toLocaleString()} tokens — too long for ${target.modelId} (${target.contextWindow.toLocaleString()}). Pick a larger-context model or start a new thread.`,
      };
    }
  }

  return { verdict: "ok" };
}

/**
 * Estimates the active Pi context from its current messages, never from the session archive,
 * which retains compacted history. The session folder and id are no longer read: the archive
 * scan for colliding tool-call ids went with the pi-ai patch (pi >= 0.82.1 keeps sibling ids
 * distinct; removed 7 Nov 2026). The call site keeps passing them.
 */
export function readThreadStats(_sessionDir: string, _sessionId: string, activeMessages?: readonly unknown[]): ThreadStats {
  const estTokens = estimateActiveContextTokens(activeMessages);
  return estTokens !== undefined ? { estTokens } : {};
}

/** Pi's content-only chars/4 heuristic, applied to its resolved get_messages snapshot. */
function estimateActiveContextTokens(messages: readonly unknown[] | undefined): number | undefined {
  if (!messages) return undefined;
  const textLength = (value: unknown) => typeof value === "string" ? value.length : 0;
  let tokens = 0;
  for (const value of messages) {
    if (!value || typeof value !== "object") continue;
    const message = value as Record<string, unknown>;
    let chars = 0;
    if (message.role === "compactionSummary" || message.role === "branchSummary") {
      chars = textLength(message.summary);
    } else if (message.role === "bashExecution") {
      if (message.excludeFromContext) continue;
      chars = textLength(message.command) + textLength(message.output);
    } else if (typeof message.content === "string") {
      chars = message.content.length;
    } else if (Array.isArray(message.content)) {
      for (const value of message.content) {
        if (!value || typeof value !== "object") continue;
        const block = value as Record<string, unknown>;
        if (block.type === "text") chars += textLength(block.text);
        else if (block.type === "thinking") chars += textLength(block.thinking);
        else if (block.type === "image") chars += 4800;
        else if (block.type === "toolCall") chars += textLength(block.name) + (JSON.stringify(block.arguments) ?? "").length;
      }
    }
    tokens += Math.ceil(chars / 4);
  }
  return tokens;
}
