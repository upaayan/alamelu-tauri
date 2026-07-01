export interface ParsedModelRow {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoning: boolean;
  readonly supportsImages: boolean;
}

export function parsePiListModels(output: string): ParsedModelRow[] {
  const rows: ParsedModelRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith("provider")) {
      continue;
    }
    const parts = trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 6) {
      continue;
    }
    const providerId = parts[0];
    const modelId = parts[1];
    const thinking = parts[4] ?? "";
    const images = parts[5] ?? "";
    if (!providerId || !modelId) {
      continue;
    }
    rows.push({
      providerId,
      modelId,
      reasoning: thinking.toLowerCase() === "yes",
      supportsImages: images.toLowerCase() === "yes",
    });
  }
  return rows;
}
