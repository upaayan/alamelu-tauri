const MAX_THREAD_TITLE_LENGTH = 36;
const MIN_FIRST_SENTENCE_LENGTH = 12;

export function summarizeThreadTitleFromPrompt(prompt: string): string | null {
  let normalized = normalizePrompt(prompt);
  if (!normalized) {
    return null;
  }

  normalized = stripLeadingSlashCommand(normalized);
  normalized = stripLeadingGreeting(normalized);
  if (!normalized) {
    return null;
  }

  const sentences = normalized
    .match(/[^.!?]+[.!?]?/g)
    ?.map((sentence) => normalizeTitle(sentence))
    .filter(Boolean) ?? [];
  let title = sentences[0] ?? normalizeTitle(normalized);
  if (title.length < MIN_FIRST_SENTENCE_LENGTH && sentences[1]) {
    title = normalizeTitle(`${title} ${sentences[1]}`);
  }

  return truncateTitle(title);
}

function normalizePrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingSlashCommand(value: string): string {
  return value.replace(/^\/[a-z][\w:-]*(?:\s+|$)/i, "").trim();
}

function stripLeadingGreeting(value: string): string {
  return value.replace(/^(?:hi|hello|hey)\s+(?:codex|pi|alamelu|there|dear\s+\w+),?\s*/i, "").trim();
}

function normalizeTitle(value: string): string {
  return value
    .replace(/^title\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!,:;]+$/g, "")
    .trim();
}

function truncateTitle(value: string): string | null {
  const normalized = normalizeTitle(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_THREAD_TITLE_LENGTH) {
    return normalized;
  }

  const limit = MAX_THREAD_TITLE_LENGTH - 3;
  const words = normalized.split(" ");
  let candidate = "";
  for (const word of words) {
    const next = candidate ? `${candidate} ${word}` : word;
    if (next.length > limit) {
      break;
    }
    candidate = next;
  }

  return `${(candidate || normalized.slice(0, limit)).trimEnd()}...`;
}

