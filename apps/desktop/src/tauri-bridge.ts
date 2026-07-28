import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HostUiResponse } from "@alamelu-pi/session-driver";
import type { RuntimeSettingsSnapshot } from "@alamelu-pi/session-driver/runtime-types";
import type { NavigateSessionTreeOptions } from "@alamelu-pi/session-driver/types";
import type {
  AppView,
  ComposerAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  NotificationPreferences,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "./desktop-state";
import {
  desktopIpc,
  type DesktopNotificationPermissionStatus,
  type PiDesktopApi,
  type ProviderLoginResponse,
  type TerminalSize,
} from "./ipc";

interface BackendEvent {
  readonly channel: string;
  readonly payload: unknown;
}

type EventListener = (payload: unknown) => void;

const listeners = new Map<string, Set<EventListener>>();
let stopBackendEvents: UnlistenFn | undefined;
let stopNativeEvents: UnlistenFn | undefined;

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const set = listeners.get(channel) ?? new Set<EventListener>();
  const wrapped = listener as EventListener;
  set.add(wrapped);
  listeners.set(channel, set);
  return () => {
    set.delete(wrapped);
    if (set.size === 0) listeners.delete(channel);
  };
}

function publish(channel: string, payload: unknown): void {
  for (const listener of listeners.get(channel) ?? []) {
    listener(payload);
  }
}

async function backend<T>(channel: string, ...args: unknown[]): Promise<T> {
  return invoke<T>("backend_invoke", { channel, args });
}

async function installEventRoutes(): Promise<void> {
  stopBackendEvents = await listen<BackendEvent>("alamelu-tauri://backend-event", ({ payload }) => {
    publish(payload.channel, payload.payload);
  });
  stopNativeEvents = await listen<BackendEvent>("alamelu-tauri://native-event", ({ payload }) => {
    publish(payload.channel, payload.payload);
  });
}

export async function installTauriBridge(): Promise<void> {
  await installEventRoutes();

  const api: PiDesktopApi = {
    platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux",
    versions: { node: "external" } as NodeJS.ProcessVersions,
    ping: () => backend(desktopIpc.ping),
    getState: () => backend(desktopIpc.stateRequest),
    onStateChanged: (listener) => subscribe(desktopIpc.stateChanged, listener),
    getSelectedTranscript: () => backend(desktopIpc.selectedTranscriptRequest),
    onSelectedTranscriptChanged: (listener) => subscribe(desktopIpc.selectedTranscriptChanged, listener),
    onCommand: (listener) => subscribe(desktopIpc.appCommand, listener),
    onWorkspacePicked: (listener) => subscribe(desktopIpc.workspacePicked, listener),
    onClipboardImagePasted: (listener) => subscribe(desktopIpc.clipboardImagePasted, listener),
    getPathForFile: (file) => (file as File & { path?: string }).path ?? "",
    addWorkspacePath: (workspacePath) => backend(desktopIpc.addWorkspacePath, workspacePath),
    pickWorkspace: async () => {
      const workspacePath = await invoke<string | null>("native_pick_workspace");
      if (!workspacePath) return backend(desktopIpc.stateRequest);
      let state = await backend<Awaited<ReturnType<PiDesktopApi["getState"]>>>(
        desktopIpc.addWorkspacePath,
        workspacePath,
      );
      if (state.activeView !== "new-thread") {
        state = await backend(desktopIpc.setActiveView, "new-thread");
      }
      if (state.selectedWorkspaceId) publish(desktopIpc.workspacePicked, state.selectedWorkspaceId);
      return state;
    },
    selectWorkspace: (workspaceId) => backend(desktopIpc.selectWorkspace, workspaceId),
    renameWorkspace: (workspaceId, displayName) =>
      backend(desktopIpc.renameWorkspace, workspaceId, displayName),
    removeWorkspace: (workspaceId) => backend(desktopIpc.removeWorkspace, workspaceId),
    reorderWorkspaces: (workspaceOrder) => backend(desktopIpc.reorderWorkspaces, workspaceOrder),
    openWorkspaceInFinder: (workspaceId) => backend(desktopIpc.openWorkspaceInFinder, workspaceId),
    createWorktree: (input: CreateWorktreeInput) => backend(desktopIpc.createWorktree, input),
    removeWorktree: (input: RemoveWorktreeInput) => backend(desktopIpc.removeWorktree, input),
    openSkillInFinder: (workspaceId, filePath) =>
      backend(desktopIpc.openSkillInFinder, workspaceId, filePath),
    openExtensionInFinder: (workspaceId, filePath) =>
      backend(desktopIpc.openExtensionInFinder, workspaceId, filePath),
    syncCurrentWorkspace: () => backend(desktopIpc.syncCurrentWorkspace),
    selectSession: (target: WorkspaceSessionTarget) => backend(desktopIpc.selectSession, target),
    archiveSession: (target: WorkspaceSessionTarget) => backend(desktopIpc.archiveSession, target),
    renameSession: (target: WorkspaceSessionTarget, title: string) =>
      backend(desktopIpc.renameSession, target, title),
    unarchiveSession: (target: WorkspaceSessionTarget) => backend(desktopIpc.unarchiveSession, target),
    createSession: (input: CreateSessionInput) => backend(desktopIpc.createSession, input),
    startThread: (input: StartThreadInput) => backend(desktopIpc.startThread, input),
    cancelCurrentRun: () => backend(desktopIpc.cancelCurrentRun),
    setActiveView: (view: AppView) => backend(desktopIpc.setActiveView, view),
    setSidebarCollapsed: (collapsed) => backend(desktopIpc.setSidebarCollapsed, collapsed),
    refreshRuntime: (workspaceId) => backend(desktopIpc.refreshRuntime, workspaceId),
    setModelSettingsScopeMode: (mode) => backend(desktopIpc.setModelSettingsScopeMode, mode),
    setDefaultModel: (workspaceId, provider, modelId) =>
      backend(desktopIpc.setDefaultModel, workspaceId, provider, modelId),
    setDefaultThinkingLevel: (
      workspaceId,
      thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
    ) => backend(desktopIpc.setDefaultThinkingLevel, workspaceId, thinkingLevel),
    setSessionModel: (workspaceId, sessionId, provider, modelId) =>
      backend(desktopIpc.setSessionModel, workspaceId, sessionId, provider, modelId),
    setSessionThinkingLevel: (
      workspaceId,
      sessionId,
      thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
    ) => backend(desktopIpc.setSessionThinkingLevel, workspaceId, sessionId, thinkingLevel),
    loginProvider: (workspaceId, providerId) =>
      backend(desktopIpc.loginProvider, workspaceId, providerId),
    onProviderLoginStateChanged: (listener) =>
      subscribe(desktopIpc.providerLoginStateChanged, listener),
    respondToProviderLogin: (response: ProviderLoginResponse) =>
      backend(desktopIpc.providerLoginRespond, response),
    cancelProviderLogin: (requestId) => backend(desktopIpc.providerLoginCancel, requestId),
    logoutProvider: (workspaceId, providerId) =>
      backend(desktopIpc.logoutProvider, workspaceId, providerId),
    setProviderApiKey: (workspaceId, providerId, apiKey) =>
      backend(desktopIpc.setProviderApiKey, workspaceId, providerId, apiKey),
    setEnableSkillCommands: (workspaceId, enabled) =>
      backend(desktopIpc.setEnableSkillCommands, workspaceId, enabled),
    setAutoCompaction: (workspaceId, enabled) =>
      backend(desktopIpc.setAutoCompaction, workspaceId, enabled),
    setScopedModelPatterns: (workspaceId, patterns) =>
      backend(desktopIpc.setScopedModelPatterns, workspaceId, patterns),
    setSkillEnabled: (workspaceId, filePath, enabled) =>
      backend(desktopIpc.setSkillEnabled, workspaceId, filePath, enabled),
    setExtensionEnabled: (workspaceId, filePath, enabled) =>
      backend(desktopIpc.setExtensionEnabled, workspaceId, filePath, enabled),
    respondToHostUiRequest: (
      workspaceId: string,
      sessionId: string,
      response: HostUiResponse,
    ) => backend(desktopIpc.respondToHostUiRequest, workspaceId, sessionId, response),
    setNotificationPreferences: (preferences: Partial<NotificationPreferences>) =>
      backend(desktopIpc.setNotificationPreferences, preferences),
    setIntegratedTerminalShell: (shellPath) =>
      backend(desktopIpc.setIntegratedTerminalShell, shellPath),
    setEnableTransparency: async (enabled) => {
      const state = await backend<Awaited<ReturnType<PiDesktopApi["getState"]>>>(
        desktopIpc.setEnableTransparency,
        enabled,
      );
      await invoke("native_set_transparency", { enabled });
      return state;
    },
    ensureTerminalPanel: (workspaceId, terminalScopeId, size) =>
      backend(desktopIpc.terminalEnsurePanel, workspaceId, terminalScopeId, size),
    createTerminalSession: (workspaceId, terminalScopeId, size) =>
      backend(desktopIpc.terminalCreateSession, workspaceId, terminalScopeId, size),
    setActiveTerminalSession: (workspaceId, terminalScopeId, terminalId) =>
      backend(desktopIpc.terminalSetActiveSession, workspaceId, terminalScopeId, terminalId),
    writeTerminal: (terminalId, data) => backend(desktopIpc.terminalWrite, terminalId, data),
    resizeTerminal: (terminalId, size: TerminalSize) =>
      backend(desktopIpc.terminalResize, terminalId, size),
    restartTerminalSession: (terminalId, size) =>
      backend(desktopIpc.terminalRestartSession, terminalId, size),
    closeTerminalSession: (terminalId) => backend(desktopIpc.terminalCloseSession, terminalId),
    setTerminalTitle: (terminalId, title) =>
      backend(desktopIpc.terminalSetTitle, terminalId, title),
    setTerminalFocused: (focused) => backend(desktopIpc.terminalSetFocused, focused),
    onTerminalData: (listener) => subscribe(desktopIpc.terminalData, listener),
    onTerminalExit: (listener) => subscribe(desktopIpc.terminalExit, listener),
    onTerminalError: (listener) => subscribe(desktopIpc.terminalError, listener),
    getNotificationPermissionStatus: () =>
      invoke<DesktopNotificationPermissionStatus>("native_notification_status"),
    requestNotificationPermission: () =>
      invoke<DesktopNotificationPermissionStatus>("native_request_notification"),
    openSystemNotificationSettings: () => invoke("native_open_notification_settings"),
    onNotificationPermissionStatusChanged: (listener) =>
      subscribe(desktopIpc.notificationPermissionStatusChanged, listener),
    pickComposerAttachments: async () => {
      const attachments = await invoke<ComposerAttachment[]>("native_pick_attachments");
      if (attachments.length === 0) return backend(desktopIpc.stateRequest);
      return backend(desktopIpc.addComposerAttachments, attachments);
    },
    // WebKit's normal paste event carries image bytes; returning null here lets
    // the existing composer paste path consume them without a synchronous IPC.
    readClipboardImage: () => null,
    addComposerAttachments: (attachments: readonly ComposerAttachment[]) =>
      backend(desktopIpc.addComposerAttachments, attachments),
    removeComposerAttachment: (attachmentId) =>
      backend(desktopIpc.removeComposerAttachment, attachmentId),
    editQueuedComposerMessage: (messageId, currentDraft) =>
      backend(desktopIpc.editQueuedComposerMessage, messageId, currentDraft),
    cancelQueuedComposerEdit: () => backend(desktopIpc.cancelQueuedComposerEdit),
    removeQueuedComposerMessage: (messageId) =>
      backend(desktopIpc.removeQueuedComposerMessage, messageId),
    steerQueuedComposerMessage: (messageId) =>
      backend(desktopIpc.steerQueuedComposerMessage, messageId),
    updateComposerDraft: (composerDraft) =>
      backend(desktopIpc.updateComposerDraft, composerDraft),
    submitComposer: (text, options) => backend(desktopIpc.submitComposer, text, options),
    getSessionTree: (target: WorkspaceSessionTarget) =>
      backend(desktopIpc.getSessionTree, target),
    navigateSessionTree: (
      target: WorkspaceSessionTarget,
      targetId: string,
      options?: NavigateSessionTreeOptions,
    ) => backend(desktopIpc.navigateSessionTree, target, targetId, options),
    listWorkspaceFiles: (workspaceId) => backend(desktopIpc.listWorkspaceFiles, workspaceId),
    getChangedFiles: (workspaceId) => backend(desktopIpc.getChangedFiles, workspaceId),
    getFileDiff: (workspaceId, filePath) =>
      backend(desktopIpc.getFileDiff, workspaceId, filePath),
    stageFile: (workspaceId, filePath) => backend(desktopIpc.stageFile, workspaceId, filePath),
    toggleWindowMaximize: () => invoke("native_toggle_maximize"),
    openExternal: (url) => invoke("native_open_external", { url }),
    getThemeMode: () => invoke("native_get_theme_mode"),
    getResolvedTheme: () => invoke("native_get_resolved_theme"),
    setThemeMode: (mode) => invoke("native_set_theme_mode", { mode }),
    onThemeChanged: (listener) => subscribe(desktopIpc.themeChanged, listener),
  };

  Object.defineProperty(window, "piApp", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api,
  });

  const initialState = await backend<Awaited<ReturnType<PiDesktopApi["getState"]>>>(
    desktopIpc.stateRequest,
  );
  await invoke("native_set_transparency", {
    enabled: initialState.enableTransparency,
  });
}

export function disposeTauriBridge(): void {
  stopBackendEvents?.();
  stopNativeEvents?.();
  listeners.clear();
}
