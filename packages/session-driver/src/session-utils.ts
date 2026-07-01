import type { SessionRef, WorkspaceRef } from "./types.js";

export interface GenerateThreadTitleOptions {
  readonly prompt: string;
  readonly model?: {
    readonly provider: string;
    readonly modelId: string;
  };
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

export interface SyncWorkspaceResult {
  readonly workspace: WorkspaceRef;
  readonly sessions: readonly {
    readonly sessionRef: SessionRef;
    readonly workspaceId: string;
    readonly title: string;
    readonly updatedAt: string;
    readonly archivedAt?: string;
    readonly previewSnippet?: string;
    readonly sessionFilePath?: string;
    readonly status: "idle" | "running" | "failed";
  }[];
}

export function sessionKey(sessionRef: SessionRef): string {
  return `${sessionRef.workspaceId}:${sessionRef.sessionId}`;
}
