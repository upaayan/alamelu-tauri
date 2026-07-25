import fs from "node:fs";
import path from "node:path";

export interface ThreadStats {
  /** Rough size of the thread: bytes/4. Only ever used with a safety factor. */
  readonly estTokens: number;
  /** True when replaying this history would produce duplicate 40-char tool-call ids. */
  readonly hasCollidingToolCallIds: boolean;
  readonly historyProvider?: string;
  readonly historyModelId?: string;
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
 * Only blocks failures that are certain: the thread cannot fit, its tool history
 * cannot replay, or the provider has no credential at all. Missing metadata never
 * blocks — an unknown case is left to the run-time error message instead.
 */
export function evaluateModelSwitch(
  stats: ThreadStats,
  target: TargetModel,
  piPatchApplied: boolean,
): PreflightDecision {
  if (target.connected === false) {
    return {
      verdict: "block",
      reason: `${target.providerId} is not connected. Reconnect it in Settings → Providers to use its models.`,
    };
  }

  if (target.contextWindow !== undefined && target.contextWindow > 0) {
    const limit = Math.floor(target.contextWindow * CONTEXT_SAFETY_FACTOR);
    if (stats.estTokens > limit) {
      return {
        verdict: "block",
        reason: `This thread is about ${stats.estTokens.toLocaleString()} tokens — too long for ${target.modelId} (${target.contextWindow.toLocaleString()}). Pick a larger-context model or start a new thread.`,
      };
    }
  }

  const sameModel = stats.historyProvider === target.providerId && stats.historyModelId === target.modelId;
  if (stats.hasCollidingToolCallIds && !sameModel && target.api === "openai-completions") {
    const reason = `This thread's tool history can't replay on ${target.modelId}. Switch back to ${stats.historyModelId ?? "the previous model"}, or pick an Anthropic or Codex model.`;
    return piPatchApplied ? { verdict: "warn", reason } : { verdict: "block", reason };
  }

  return { verdict: "ok" };
}

/** Old pi-ai normalization: sanitize, then cut to 40 chars — the step that collided. */
function legacyNormalizedId(id: string): string | undefined {
  if (!id.includes("|")) return undefined;
  const callId = id.split("|")[0] ?? "";
  return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

/**
 * Reads a session's JSONL to estimate its size and detect tool-call ids that would
 * collide after truncation. Returns zeroed stats when the file cannot be read.
 */
export function readThreadStats(sessionDir: string, sessionId: string): ThreadStats {
  const empty: ThreadStats = { estTokens: 0, hasCollidingToolCallIds: false };
  if (!sessionDir || !/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId.includes("..")) return empty;

  let filePath: string;
  try {
    const match = fs
      .readdirSync(sessionDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`));
    if (!match) return empty;
    filePath = fs.realpathSync.native(path.join(sessionDir, match.name));
    if (!filePath.startsWith(`${fs.realpathSync.native(sessionDir)}${path.sep}`)) return empty;
  } catch {
    return empty;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return empty;
  }

  const seen = new Set<string>();
  let hasCollidingToolCallIds = false;
  let historyProvider: string | undefined;
  let historyModelId: string | undefined;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type === "model_change") {
      if (typeof record.provider === "string") historyProvider = record.provider;
      if (typeof record.modelId === "string") historyModelId = record.modelId;
      continue;
    }
    const message = record.message as Record<string, unknown> | undefined;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type !== "toolCall" || typeof partRecord.id !== "string") continue;
      const normalized = legacyNormalizedId(partRecord.id);
      if (!normalized) continue;
      if (seen.has(normalized)) hasCollidingToolCallIds = true;
      seen.add(normalized);
    }
  }

  return {
    estTokens: Math.round(raw.length / 4),
    hasCollidingToolCallIds,
    ...(historyProvider ? { historyProvider } : {}),
    ...(historyModelId ? { historyModelId } : {}),
  };
}

const PATCH_MARKER = "alpi-patch:toolcallid-v1";

/** True when the local pi-ai carries our collision-proof truncation patch. */
export function isPiPatchApplied(piBinRealPath: string | undefined): boolean {
  if (!piBinRealPath) return false;
  try {
    const target = path.join(
      path.resolve(path.dirname(piBinRealPath), ".."),
      "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",
    );
    return fs.readFileSync(target, "utf8").includes(PATCH_MARKER);
  } catch {
    return false;
  }
}
