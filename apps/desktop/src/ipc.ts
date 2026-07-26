import type { RuntimeSettingsSnapshot } from "@alamelu-pi/session-driver/runtime-types";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@alamelu-pi/session-driver/types";
import type {
  AppView,
  ComposerAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  ModelSettingsScopeMode,
  NotificationPreferences,
  RemoveWorktreeInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "./desktop-state";

export type DesktopNotificationPermissionStatus =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "unknown";

export const desktopIpc = {
  stateRequest: "alamelu-pi:state-request",
  stateChanged: "alamelu-pi:state-changed",
  selectedTranscriptRequest: "alamelu-pi:selected-transcript-request",
  selectedTranscriptChanged: "alamelu-pi:selected-transcript-changed",
  appCommand: "alamelu-pi:app-command",
  workspacePicked: "alamelu-pi:workspace-picked",
  clipboardImagePasted: "alamelu-pi:clipboard-image-pasted",
  addWorkspacePath: "alamelu-pi:add-workspace-path",
  pickWorkspace: "alamelu-pi:pick-workspace",
  selectWorkspace: "alamelu-pi:select-workspace",
  renameWorkspace: "alamelu-pi:rename-workspace",
  removeWorkspace: "alamelu-pi:remove-workspace",
  reorderWorkspaces: "alamelu-pi:reorder-workspaces",
  openWorkspaceInFinder: "alamelu-pi:open-workspace-in-finder",
  createWorktree: "alamelu-pi:create-worktree",
  removeWorktree: "alamelu-pi:remove-worktree",
  openSkillInFinder: "alamelu-pi:open-skill-in-finder",
  openExtensionInFinder: "alamelu-pi:open-extension-in-finder",
  syncCurrentWorkspace: "alamelu-pi:sync-current-workspace",
  selectSession: "alamelu-pi:select-session",
  archiveSession: "alamelu-pi:archive-session",
  renameSession: "alamelu-pi:rename-session",
  unarchiveSession: "alamelu-pi:unarchive-session",
  createSession: "alamelu-pi:create-session",
  startThread: "alamelu-pi:start-thread",
  cancelCurrentRun: "alamelu-pi:cancel-current-run",
  setActiveView: "alamelu-pi:set-active-view",
  setSidebarCollapsed: "alamelu-pi:set-sidebar-collapsed",
  refreshRuntime: "alamelu-pi:refresh-runtime",
  setModelSettingsScopeMode: "alamelu-pi:set-model-settings-scope-mode",
  setDefaultModel: "alamelu-pi:set-default-model",
  setDefaultThinkingLevel: "alamelu-pi:set-default-thinking-level",
  setSessionModel: "alamelu-pi:set-session-model",
  setSessionThinkingLevel: "alamelu-pi:set-session-thinking-level",
  loginProvider: "alamelu-pi:login-provider",
  providerLoginStateChanged: "alamelu-pi:provider-login-state-changed",
  providerLoginRespond: "alamelu-pi:provider-login-respond",
  providerLoginCancel: "alamelu-pi:provider-login-cancel",
  logoutProvider: "alamelu-pi:logout-provider",
  setProviderApiKey: "alamelu-pi:set-provider-api-key",
  setEnableSkillCommands: "alamelu-pi:set-enable-skill-commands",
  setScopedModelPatterns: "alamelu-pi:set-scoped-model-patterns",
  setSkillEnabled: "alamelu-pi:set-skill-enabled",
  setExtensionEnabled: "alamelu-pi:set-extension-enabled",
  respondToHostUiRequest: "alamelu-pi:respond-to-host-ui-request",
  setNotificationPreferences: "alamelu-pi:set-notification-preferences",
  setIntegratedTerminalShell: "alamelu-pi:set-integrated-terminal-shell",
  setEnableTransparency: "alamelu-pi:set-enable-transparency",
  terminalEnsurePanel: "alamelu-pi:terminal-ensure-panel",
  terminalCreateSession: "alamelu-pi:terminal-create-session",
  terminalSetActiveSession: "alamelu-pi:terminal-set-active-session",
  terminalWrite: "alamelu-pi:terminal-write",
  terminalResize: "alamelu-pi:terminal-resize",
  terminalRestartSession: "alamelu-pi:terminal-restart-session",
  terminalCloseSession: "alamelu-pi:terminal-close-session",
  terminalSetTitle: "alamelu-pi:terminal-set-title",
  terminalSetFocused: "alamelu-pi:terminal-set-focused",
  terminalData: "alamelu-pi:terminal-data",
  terminalExit: "alamelu-pi:terminal-exit",
  terminalError: "alamelu-pi:terminal-error",
  getNotificationPermissionStatus: "alamelu-pi:get-notification-permission-status",
  requestNotificationPermission: "alamelu-pi:request-notification-permission",
  openSystemNotificationSettings: "alamelu-pi:open-system-notification-settings",
  notificationPermissionStatusChanged: "alamelu-pi:notification-permission-status-changed",
  pickComposerAttachments: "alamelu-pi:pick-composer-attachments",
  readClipboardImage: "alamelu-pi:read-clipboard-image",
  addComposerAttachments: "alamelu-pi:add-composer-attachments",
  removeComposerAttachment: "alamelu-pi:remove-composer-attachment",
  editQueuedComposerMessage: "alamelu-pi:edit-queued-composer-message",
  cancelQueuedComposerEdit: "alamelu-pi:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "alamelu-pi:remove-queued-composer-message",
  steerQueuedComposerMessage: "alamelu-pi:steer-queued-composer-message",
  updateComposerDraft: "alamelu-pi:update-composer-draft",
  submitComposer: "alamelu-pi:submit-composer",
  getSessionTree: "alamelu-pi:get-session-tree",
  navigateSessionTree: "alamelu-pi:navigate-session-tree",
  toggleWindowMaximize: "alamelu-pi:toggle-window-maximize",
  listWorkspaceFiles: "alamelu-pi:list-workspace-files",
  getChangedFiles: "alamelu-pi:get-changed-files",
  getFileDiff: "alamelu-pi:get-file-diff",
  stageFile: "alamelu-pi:stage-file",
  getThemeMode: "alamelu-pi:get-theme-mode",
  getResolvedTheme: "alamelu-pi:get-resolved-theme",
  setThemeMode: "alamelu-pi:set-theme-mode",
  themeChanged: "alamelu-pi:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
} as const;

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  toggleTerminal: "toggle-terminal",
  toggleSidebar: "toggle-sidebar",
} as const;

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export type PiDesktopStateListener = (state: DesktopAppState) => void;
export type PiDesktopSelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export interface ProviderLoginBaseState {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly providerId: string;
}

export type ProviderLoginState =
  | { readonly status: "idle" }
  | (ProviderLoginBaseState & { readonly status: "starting" })
  | (ProviderLoginBaseState & {
    readonly status: "select";
    readonly message: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
  })
  | (ProviderLoginBaseState & {
    readonly status: "auth";
    readonly url: string;
    readonly instructions?: string;
  })
  | (ProviderLoginBaseState & {
    readonly status: "manualInput";
    readonly message: string;
    readonly url?: string;
    readonly instructions?: string;
  })
  | (ProviderLoginBaseState & {
    readonly status: "deviceCode";
    readonly userCode: string;
    readonly verificationUri: string;
    readonly intervalSeconds?: number;
    readonly expiresInSeconds?: number;
  })
  | (ProviderLoginBaseState & {
    readonly status: "prompt";
    readonly message: string;
    readonly placeholder?: string;
    readonly allowEmpty?: boolean;
  })
  | (ProviderLoginBaseState & { readonly status: "progress"; readonly message: string })
  | (ProviderLoginBaseState & { readonly status: "complete" })
  | (ProviderLoginBaseState & { readonly status: "cancelled"; readonly message?: string })
  | (ProviderLoginBaseState & { readonly status: "error"; readonly message: string });

export type ProviderLoginResponse =
  | { readonly requestId: string; readonly type: "select"; readonly optionId: string }
  | { readonly requestId: string; readonly type: "manualInput"; readonly value: string }
  | { readonly requestId: string; readonly type: "prompt"; readonly value: string };

export type ProviderLoginStateListener = (state: ProviderLoginState) => void;

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
}

export function getDesktopCommandFromShortcut(input: DesktopShortcutInput): PiDesktopCommand | undefined {
  if (!input.modifier) {
    return undefined;
  }

  const lowerKey = input.key.toLowerCase();
  const isComma = input.key === "," || input.code === "Comma";
  const isB = lowerKey === "b" || input.code === "KeyB";
  const isJ = lowerKey === "j" || input.code === "KeyJ";
  const isShiftO = input.shift && (lowerKey === "o" || input.code === "KeyO");

  if (!input.shift && isComma) {
    return desktopCommands.openSettings;
  }

  if (!input.shift && isJ) {
    return desktopCommands.toggleTerminal;
  }

  if (!input.shift && isB) {
    return desktopCommands.toggleSidebar;
  }

  if (isShiftO) {
    return desktopCommands.openNewThread;
  }

  return undefined;
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  onStateChanged(listener: PiDesktopStateListener): () => void;
  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  onSelectedTranscriptChanged(listener: PiDesktopSelectedTranscriptListener): () => void;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (attachment: ComposerImageAttachment) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  pickWorkspace(): Promise<DesktopAppState>;
  selectWorkspace(workspaceId: string): Promise<DesktopAppState>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState>;
  removeWorkspace(workspaceId: string): Promise<DesktopAppState>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<DesktopAppState>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState>;
  removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<DesktopAppState>;
  selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  renameSession(target: WorkspaceSessionTarget, title: string): Promise<DesktopAppState>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  createSession(input: CreateSessionInput): Promise<DesktopAppState>;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
  cancelCurrentRun(): Promise<DesktopAppState>;
  setActiveView(view: AppView): Promise<DesktopAppState>;
  setSidebarCollapsed(collapsed: boolean): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
  setModelSettingsScopeMode(mode: ModelSettingsScopeMode): Promise<DesktopAppState>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<DesktopAppState>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState>;
  loginProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  onProviderLoginStateChanged(listener: ProviderLoginStateListener): () => void;
  respondToProviderLogin(response: ProviderLoginResponse): Promise<void>;
  cancelProviderLogin(requestId: string): Promise<void>;
  logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState>;
  setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState>;
  setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ): Promise<DesktopAppState>;
  setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState>;
  setIntegratedTerminalShell(shell: string): Promise<DesktopAppState>;
  setEnableTransparency(enabled: boolean): Promise<DesktopAppState>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(terminalId: string, size?: Partial<TerminalSize>): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  pickComposerAttachments(): Promise<DesktopAppState>;
  readClipboardImage(): ComposerImageAttachment | null;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState>;
  removeComposerAttachment(attachmentId: string): Promise<DesktopAppState>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState>;
  cancelQueuedComposerEdit(): Promise<DesktopAppState>;
  removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  updateComposerDraft(composerDraft: string): Promise<DesktopAppState>;
  submitComposer(text: string, options?: { readonly deliverAs?: "steer" | "followUp" }): Promise<DesktopAppState>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(workspaceId: string): Promise<string[]>;
  getChangedFiles(workspaceId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string): Promise<void>;
  toggleWindowMaximize(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<"system" | "light" | "dark">;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: "system" | "light" | "dark"): Promise<string>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;
}
