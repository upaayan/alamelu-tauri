import type { SessionCatalogSnapshot, WorkspaceCatalogSnapshot, WorkspaceId } from "@pi-gui/catalogs";
import type { SyncWorkspaceResult, GenerateThreadTitleOptions, SessionTranscriptMessage } from "@pi-gui/session-driver";
import type {
  HostUiResponse,
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionDriver,
  SessionRef,
  SessionTreeSnapshot,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type {
  ModelSettingsSnapshot,
  RuntimeLoginCallbacks,
  RuntimeResourceDriver,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";

export interface DesktopRuntimeSupervisor extends RuntimeResourceDriver {
  getGlobalModelSettings(workspace: WorkspaceRef): Promise<ModelSettingsSnapshot>;
}

export interface DesktopSessionDriver extends SessionDriver {
  readonly runtimeSupervisor: DesktopRuntimeSupervisor;
  readonly supportsWorktrees?: boolean;
  readonly supportsTree?: boolean;
  readonly supportsCompact?: boolean;
  readonly supportsQueueEditing?: boolean;
  /** False when skill/extension enablement is owned by the pi CLI, not this app. */
  readonly supportsSkillToggles?: boolean;
  shutdown?(): Promise<void>;
  listWorkspaces(): Promise<WorkspaceCatalogSnapshot>;
  listSessions(workspaceId?: WorkspaceId): Promise<SessionCatalogSnapshot>;
  syncWorkspace(path: string, displayName?: string): Promise<SyncWorkspaceResult>;
  renameWorkspace(workspaceId: WorkspaceId, displayName: string): Promise<void>;
  removeWorkspace(workspaceId: WorkspaceId): Promise<void>;
  getTranscript(sessionRef: SessionRef): Promise<SessionTranscriptMessage[]>;
  getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult>;
  respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void>;
  generateThreadTitle(workspace: WorkspaceRef, options: GenerateThreadTitleOptions): Promise<string | null>;
}

export function unsupportedRpcDesktopOperation(name: string): Error {
  return new Error(`${name} is not supported by the RPC desktop prototype`);
}

export type { RuntimeLoginCallbacks, RuntimeSnapshot };
