/** Split streaming markdown so only completed blocks are reparsed. */

export function splitStreamingMarkdown(text: string): { stable: string; tail: string } {
  const fenceStart = lastUnclosedFenceStart(text);
  if (fenceStart >= 0) {
    return { stable: text.slice(0, fenceStart), tail: text.slice(fenceStart) };
  }
  const cut = text.lastIndexOf("\n\n");
  if (cut === -1) {
    return { stable: "", tail: text };
  }
  return { stable: text.slice(0, cut + 2), tail: text.slice(cut + 2) };
}

function lastUnclosedFenceStart(text: string): number {
  let index = 0;
  let openAt = -1;
  while (index < text.length) {
    const next = text.indexOf("```", index);
    if (next < 0) {
      break;
    }
    const atLineStart = next === 0 || text[next - 1] === "\n";
    if (atLineStart) {
      openAt = openAt < 0 ? next : -1;
    }
    index = next + 3;
  }
  return openAt;
}
