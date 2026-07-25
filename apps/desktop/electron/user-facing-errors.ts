export interface DescribedError {
  readonly headline: string;
  readonly detail?: string;
}

interface Rule {
  readonly match: RegExp;
  readonly headline: (m: RegExpMatchArray) => string;
}

const RULES: readonly Rule[] = [
  {
    match: /Duplicate value for 'tool_call_id'/i,
    headline: () =>
      "This thread's tool history can't replay on the model you switched to. Switch back to the previous model, or pick an Anthropic or Codex model.",
  },
  {
    match: /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i,
    headline: (m) =>
      `This thread is too long for the selected model (${Number(m[1]).toLocaleString()} tokens needed, ${Number(m[2]).toLocaleString()} available). Pick a larger-context model or start a new thread.`,
  },
  {
    match: /exceeds the available context size/i,
    headline: () => "This thread is too long for the selected model. Pick a larger-context model or start a new thread.",
  },
  {
    match: /OAuth refresh failed for ([\w-]+)/i,
    headline: (m) => `Your ${m[1]} login has expired. Reconnect it in Settings → Providers to use its models.`,
  },
  {
    match: /No API key for provider: ([\w-]+)/i,
    headline: (m) => `${m[1]} is not connected right now. Reconnect it in Settings → Providers to use its models.`,
  },
  {
    match: /re-entrant prompts are not supported/i,
    headline: () => "Alamelu Pi is still finishing the previous message — try again in a moment.",
  },
  {
    match: /steering and follow-up messages require a running session/i,
    headline: () => "That message just missed the run — it was kept as your draft. Send it again.",
  },
  {
    match: /RPC session is not open/i,
    headline: () => "This thread's engine isn't running. Reopen the thread and try again.",
  },
  {
    match: /RPC transport closed|RPC stdout ended|RPC client (is )?closed/i,
    headline: () => "The pi engine for this thread stopped. Your next message will restart it.",
  },
  {
    match: /Worktree threads are not supported/i,
    headline: () => "Worktree mode isn't available in this build — the thread wasn't created and your prompt was kept.",
  },
  {
    match: /Replacement Pi RPC .* mismatch/i,
    headline: () => "Restarting this thread's engine hit a mismatch. Try again; if it repeats, reopen the thread.",
  },
  {
    match: /is not supported by the RPC (desktop )?prototype/i,
    headline: () => "That action isn't available in this build.",
  },
  {
    match: /RPC command timed out: (\w+)/i,
    headline: () => "The pi engine didn't respond in time. Try again.",
  },
  {
    match: /Model not found:? ([\w./-]+)/i,
    headline: (m) => `The model ${m[1]} isn't available from its provider right now. Pick another model.`,
  },
];

const MAX_FALLBACK = 160;

/**
 * Turns a raw driver/provider error string into a sentence a non-engineer can act on.
 * The raw text is preserved in `detail` so nothing is lost for debugging.
 */
export function describeError(raw: string): DescribedError {
  const text = (raw ?? "").trim();
  if (!text) return { headline: "Something went wrong." };

  for (const rule of RULES) {
    const m = text.match(rule.match);
    if (m) {
      const headline = rule.headline(m);
      return headline === text ? { headline } : { headline, detail: text };
    }
  }

  const condensed = text.replace(/\s+/g, " ");
  if (condensed.length <= MAX_FALLBACK) return { headline: condensed };
  return { headline: `${condensed.slice(0, MAX_FALLBACK)}…`, detail: text };
}
