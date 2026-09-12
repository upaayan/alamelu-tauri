import { basename } from "node:path";
import { JsonCatalogStore } from "@alamelu-pi/catalogs";
import { canonicalizePath, pathContains, PiRpcDriver, validateLabPaths, type PiRpcDriverOptions, type ValidatedLabPaths } from "@alamelu-pi/pi-rpc-driver";
import type { SessionCatalogEntry, WorkspaceCatalogEntry, WorkspaceId } from "@alamelu-pi/catalogs";
import {
  sessionKey,
  type CreateSessionOptions,
  type GenerateThreadTitleOptions,
  type HostUiResponse,
  type NavigateSessionTreeOptions,
  type NavigateSessionTreeResult,
  type SessionEventListener,
  type SessionMessageInput,
  type SessionModelSelection,
  type SessionQueuedMessage,
  type SessionRef,
  type SessionSnapshot,
  type SessionTranscriptItem,
  type SessionTranscriptMessage,
  type SessionTreeSnapshot,
  type SyncWorkspaceResult,
  type Unsubscribe,
  type WorkspaceRef,
} from "@alamelu-pi/session-driver";
import type {
  ModelSettingsSnapshot,
  RuntimeLoginCallbacks,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@alamelu-pi/session-driver/runtime-types";
import type { DesktopRuntimeSupervisor, DesktopSessionDriver } from "./desktop-driver";
import { unsupportedRpcDesktopOperation } from "./desktop-driver";
import { ExternalPiRuntimeSupervisor } from "./external-pi-runtime-supervisor";
import { summarizeThreadTitleFromPrompt } from "./thread-title-summary";

export interface RpcDesktopDriverOptions extends PiRpcDriverOptions {
  readonly catalogFilePath: string;
}

export class RpcDesktopDriver implements DesktopSessionDriver {
  private readonly rpc: PiRpcDriver;
  private readonly catalogs: JsonCatalogStore;
  private readonly paths: ValidatedLabPaths;
  private readonly openSessions = new Map<string, SessionRef>();
  readonly supportsWorktrees = false;
  readonly supportsTree = true;
  readonly supportsCompact = true;
  readonly supportsQueueEditing = false;
  readonly supportsSkillToggles = false;
  readonly runtimeSupervisor: DesktopRuntimeSupervisor;

  constructor(private readonly options: RpcDesktopDriverOptions) {
    this.paths = validateLabPaths(options);
    this.rpc = new PiRpcDriver(options);
    this.catalogs = new JsonCatalogStore({ catalogFilePath: options.catalogFilePath });
    this.runtimeSupervisor = new ExternalPiRuntimeSupervisor({ piBin: options.piBin, agentDir: this.paths.agentDir });
  }

  async createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot> {
    await this.ensureWorkspace(workspace.path, workspace.displayName);
    const snapshot = await this.rpc.createSession(workspace, options);
    this.openSessions.set(sessionKey(snapshot.ref), snapshot.ref);
    try {
      await this.upsertSessionFromSnapshot(snapshot);
    } catch (error) {
      await this.closeSession(snapshot.ref).catch(() => undefined);
      throw error;
    }
    return snapshot;
  }

  async openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    const existing = await this.catalogs.sessions.getSession(sessionRef);
    const opened = await this.rpc.openSession(sessionRef, existing?.updatedAt);
    const snapshot = preserveExistingTitleOnGenericOpen(opened, existing?.title);
    this.openSessions.set(sessionKey(snapshot.ref), snapshot.ref);
    try {
      await this.upsertSessionFromSnapshot(snapshot, existing);
    } catch (error) {
      await this.closeSession(snapshot.ref).catch(() => undefined);
      throw error;
    }
    return snapshot;
  }

  async archiveSession(sessionRef: SessionRef): Promise<void> {
    await this.updateArchivedState(sessionRef, nowIso());
  }

  async unarchiveSession(sessionRef: SessionRef): Promise<void> {
    await this.updateArchivedState(sessionRef, undefined);
  }

  sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    return this.rpc.sendUserMessage(sessionRef, input);
  }

  replaceQueuedMessages(_sessionRef: SessionRef, _messages: readonly SessionQueuedMessage[]): Promise<void> {
    return Promise.reject(unsupportedRpcDesktopOperation("replaceQueuedMessages"));
  }

  cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    return this.rpc.cancelCurrentRun(sessionRef);
  }

  setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    return this.rpc.setSessionModel(sessionRef, selection);
  }

  setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    return this.rpc.setSessionThinkingLevel(sessionRef, thinkingLevel);
  }

  async renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    await this.rpc.renameSession(sessionRef, title);
    const existing = await this.catalogs.sessions.getSession(sessionRef);
    if (existing) {
      await this.catalogs.sessions.upsertSession({ ...existing, title, updatedAt: nowIso() });
    }
  }

  compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    return this.rpc.compactSession(sessionRef, customInstructions);
  }

  reloadSession(sessionRef: SessionRef): Promise<void> {
    return this.rpc.reloadSession(sessionRef);
  }

  getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    return this.rpc.getSessionTree(sessionRef);
  }

  navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<NavigateSessionTreeResult> {
    return this.rpc.navigateSessionTree(sessionRef, targetId, options);
  }

  async getSessionCommands(sessionRef: SessionRef) {
    try {
      return await this.rpc.getSessionCommands(sessionRef);
    } catch (error) {
      if (isClosedRpcCommandError(error)) {
        return [];
      }
      throw error;
    }
  }

  respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    return this.rpc.respondToHostUiRequest(sessionRef, response);
  }

  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe {
    return this.rpc.subscribe(sessionRef, (event) => {
      void this.updateCatalogForEvent(event).catch((error) => {
        console.warn(`[alamelu-pi] Failed to update RPC catalog: ${error instanceof Error ? error.message : String(error)}`);
      });
      listener(event);
    });
  }

  async closeSession(sessionRef: SessionRef): Promise<void> {
    await this.rpc.closeSession(sessionRef);
    this.openSessions.delete(sessionKey(sessionRef));
  }

  async shutdown(): Promise<void> {
    const refs = [...this.openSessions.values()];
    await Promise.allSettled(refs.map((ref) => this.closeSession(ref)));
    this.openSessions.clear();
    if (refs.length > 0) {
      await waitForRpcCloseFallback();
    }
  }

  listWorkspaces() {
    return this.catalogs.workspaces.listWorkspaces();
  }

  listSessions(workspaceId?: WorkspaceId) {
    return this.catalogs.sessions.listSessions(workspaceId);
  }

  async syncWorkspace(workspacePath: string, displayName?: string): Promise<SyncWorkspaceResult> {
    const workspace = await this.ensureWorkspace(workspacePath, displayName);
    return {
      workspace,
      sessions: (await this.catalogs.sessions.listSessions(workspace.workspaceId)).sessions,
    };
  }

  async renameWorkspace(workspaceId: WorkspaceId, displayName: string): Promise<void> {
    const existing = await this.catalogs.workspaces.getWorkspace(workspaceId);
    if (!existing) throw new Error(`Unknown workspace: ${workspaceId}`);
    await this.catalogs.workspaces.upsertWorkspace({ ...existing, displayName, lastOpenedAt: nowIso() });
  }

  async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
    await this.catalogs.workspaces.deleteWorkspace(workspaceId);
  }

  getTranscript(sessionRef: SessionRef): Promise<readonly SessionTranscriptItem[]> {
    // No cast: the RPC driver now returns real transcript items, tool calls included.
    return this.rpc.getTranscript(sessionRef);
  }

  generateThreadTitle(_workspace: WorkspaceRef, options: GenerateThreadTitleOptions): Promise<string | null> {
    if (options.signal?.aborted) {
      return Promise.resolve(null);
    }
    return Promise.resolve(summarizeThreadTitleFromPrompt(options.prompt));
  }

  private async ensureWorkspace(workspacePath: string, displayName?: string): Promise<WorkspaceCatalogEntry> {
    const canonicalWorkspacePath = canonicalizePath(workspacePath);
    if (!this.options.allowRealWorkspace && !pathContains(this.paths.labWorkspace, canonicalWorkspacePath)) {
      throw new Error(`RPC desktop prototype refuses to use non-lab workspace: ${canonicalWorkspacePath}`);
    }
    const existing = await this.catalogs.workspaces.getWorkspace(canonicalWorkspacePath);
    const entry: WorkspaceCatalogEntry = {
      workspaceId: canonicalWorkspacePath,
      path: canonicalWorkspacePath,
      displayName: displayName?.trim() || existing?.displayName || basename(canonicalWorkspacePath) || "RPC Lab Workspace",
      lastOpenedAt: nowIso(),
      sortOrder: existing?.sortOrder ?? (await this.nextWorkspaceSortOrder()),
      ...(existing?.pinned ? { pinned: existing.pinned } : {}),
    };
    await this.catalogs.workspaces.upsertWorkspace(entry);
    await this.catalogs.worktrees.upsertWorktree({
      worktreeId: canonicalWorkspacePath,
      workspaceId: canonicalWorkspacePath,
      path: canonicalWorkspacePath,
      displayName: entry.displayName,
      kind: "primary",
      status: "ready",
      createdAt: existing?.lastOpenedAt ?? nowIso(),
      updatedAt: nowIso(),
    });
    return entry;
  }

  private async nextWorkspaceSortOrder(): Promise<number> {
    const workspaces = (await this.catalogs.workspaces.listWorkspaces()).workspaces;
    return workspaces.reduce((max, workspace) => Math.max(max, workspace.sortOrder), -1) + 1;
  }

  private async upsertSessionFromSnapshot(snapshot: SessionSnapshot, existing?: SessionCatalogEntry): Promise<void> {
    const catalogEntry = existing ?? (await this.catalogs.sessions.getSession(snapshot.ref));
    const entry = sessionEntryFromSnapshot(snapshot, catalogEntry);
    await this.catalogs.sessions.upsertSession(entry);
  }

  private async updateCatalogForEvent(event: Parameters<SessionEventListener>[0]): Promise<void> {
    if ("snapshot" in event && event.snapshot) {
      await this.upsertSessionFromSnapshot(event.snapshot);
    }
  }

  private async updateArchivedState(sessionRef: SessionRef, archivedAt: string | undefined): Promise<void> {
    const existing = await this.catalogs.sessions.getSession(sessionRef);
    if (!existing) {
      throw new Error(`Session ${sessionKey(sessionRef)} is not in the catalog.`);
    }
    if (existing.archivedAt === archivedAt) {
      return;
    }

    if (archivedAt !== undefined) {
      await this.catalogs.sessions.upsertSession({ ...existing, archivedAt });
      return;
    }

    const { archivedAt: _archivedAt, ...rest } = existing;
    await this.catalogs.sessions.upsertSession(rest);
  }
}

class RpcDesktopRuntimeSupervisor implements DesktopRuntimeSupervisor {
  private settings: RuntimeSettingsSnapshot;

  constructor(private readonly options: RpcDesktopDriverOptions) {
    this.settings = {
      defaultProvider: options.provider,
      defaultModelId: options.model,
      defaultThinkingLevel: undefined,
      enableSkillCommands: false,
      autoCompactionEnabled: true,
      enabledModelPatterns: [],
    };
  }

  async getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    return this.snapshot(workspace);
  }

  async refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    return this.snapshot(workspace);
  }

  async getGlobalModelSettings(_workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    return {
      defaultProvider: this.settings.defaultProvider,
      defaultModelId: this.settings.defaultModelId,
      defaultThinkingLevel: this.settings.defaultThinkingLevel,
      enabledModelPatterns: this.settings.enabledModelPatterns,
    };
  }

  login(_workspace: WorkspaceRef, _providerId: string, _callbacks: RuntimeLoginCallbacks): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("runtime login"));
  }

  logout(_workspace: WorkspaceRef, _providerId: string): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("runtime logout"));
  }

  setProviderApiKey(_workspace: WorkspaceRef, _providerId: string, _apiKey: string): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("runtime setProviderApiKey"));
  }

  async setDefaultModel(workspace: WorkspaceRef, selection: { readonly provider: string; readonly modelId: string }): Promise<RuntimeSnapshot> {
    this.settings = { ...this.settings, defaultProvider: selection.provider, defaultModelId: selection.modelId };
    return this.snapshot(workspace);
  }

  async setDefaultThinkingLevel(workspace: WorkspaceRef, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]): Promise<RuntimeSnapshot> {
    this.settings = { ...this.settings, defaultThinkingLevel: thinkingLevel };
    return this.snapshot(workspace);
  }

  async setEnableSkillCommands(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    this.settings = { ...this.settings, enableSkillCommands: enabled };
    return this.snapshot(workspace);
  }

  async setAutoCompaction(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    this.settings = { ...this.settings, autoCompactionEnabled: enabled };
    return this.snapshot(workspace);
  }

  async setScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    this.settings = { ...this.settings, enabledModelPatterns: [...patterns] };
    return this.snapshot(workspace);
  }

  setSkillEnabled(_workspace: WorkspaceRef, _filePath: string, _enabled: boolean): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("runtime setSkillEnabled"));
  }

  setExtensionEnabled(_workspace: WorkspaceRef, _filePath: string, _enabled: boolean): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("runtime setExtensionEnabled"));
  }

  private snapshot(workspace: WorkspaceRef): RuntimeSnapshot {
    const providerId = this.settings.defaultProvider ?? this.options.provider ?? "rpc";
    const modelId = this.settings.defaultModelId ?? this.options.model ?? "rpc-model";
    return {
      workspace,
      providers: [
        {
          id: providerId,
          name: providerId,
          hasAuth: true,
          authType: "none",
          authSource: "external",
          oauthSupported: false,
          apiKeySetupSupported: false,
        },
      ],
      models: [
        {
          providerId,
          providerName: providerId,
          modelId,
          label: modelId,
          available: true,
          authType: "none",
          reasoning: true,
          supportsImages: true,
        },
      ],
      skills: [],
      extensions: [],
      settings: this.settings,
    };
  }
}

function sessionEntryFromSnapshot(snapshot: SessionSnapshot, existing?: SessionCatalogEntry): SessionCatalogEntry {
  const title = preserveExistingTitleOnGenericTitle(snapshot.title, existing?.title);
  return {
    ...existing,
    sessionRef: snapshot.ref,
    workspaceId: snapshot.ref.workspaceId,
    title,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.archivedAt ? { archivedAt: snapshot.archivedAt } : existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
    ...(snapshot.preview ? { previewSnippet: snapshot.preview } : existing?.previewSnippet ? { previewSnippet: existing.previewSnippet } : {}),
    ...(existing?.sessionFilePath ? { sessionFilePath: existing.sessionFilePath } : {}),
    status: snapshot.status,
  };
}

function preserveExistingTitleOnGenericOpen(snapshot: SessionSnapshot, existingTitle: string | undefined): SessionSnapshot {
  const title = preserveExistingTitleOnGenericTitle(snapshot.title, existingTitle);
  return title === snapshot.title ? snapshot : { ...snapshot, title };
}

function preserveExistingTitleOnGenericTitle(snapshotTitle: string, existingTitle: string | undefined): string {
  const title = existingTitle?.trim();
  if (!title || !isGenericRpcTitle(snapshotTitle)) {
    return snapshotTitle;
  }
  return title;
}

function isGenericRpcTitle(title: string): boolean {
  return /^rpc session\b/i.test(title.trim());
}

function isClosedRpcCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /EPIPE|RPC client is closed|RPC stdout ended|RPC client closed/i.test(message);
}

function nowIso(): string {
  return new Date().toISOString();
}

function waitForRpcCloseFallback(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2_500));
}

export function createRpcDesktopDriver(options: RpcDesktopDriverOptions): RpcDesktopDriver {
  return new RpcDesktopDriver(options);
}

export { sessionKey };
