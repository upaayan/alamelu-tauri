import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type Dispatch, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import type { SessionTreeSnapshot } from "@alamelu-pi/session-driver/types";
import type { RuntimeSnapshot } from "@alamelu-pi/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
  type ComposerAttachment,
  type ComposerImageAttachment,
  type DesktopAppState,
  type NewThreadEnvironment,
  type SelectedTranscriptRecord,
  type StartThreadInput,
  type WorktreeRecord,
  type WorkspaceRecord,
} from "./desktop-state";
import { formatRelativeTime } from "./string-utils";
import { ComposerPanel } from "./composer-panel";
import { DiffPanel, type DiffPanelFileRequest } from "./diff-panel";
import { buildModelOptions } from "./composer-commands";
import { parseTreeComposerCommand } from "./composer-commands";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  getDesktopShortcutLabel,
  type DesktopNotificationPermissionStatus,
  type PiDesktopCommand,
  type ProviderLoginResponse,
  type ProviderLoginState,
} from "./ipc";
import { deriveModelOnboardingState } from "./model-onboarding";
import { SkillsView } from "./skills-view";
import { ExtensionsView } from "./extensions-view";
import { SettingsView, type SettingsSection } from "./settings-view";
import { SecondarySurface } from "./secondary-surface";
import { NewThreadView } from "./new-thread-view";
import { buildThreadGroups } from "./thread-groups";
import { SearchPopup, Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { Topbar } from "./topbar";
import { TerminalPanel } from "./terminal-panel";
import { ConversationTimeline, VIRTUALIZATION_THRESHOLD } from "./conversation-timeline";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { buildExtensionDockModel, ExtensionDialog, hasExtensionDockContent } from "./extension-session-ui";
import { TreeModal } from "./tree-modal";
import { isProviderLoginDialogVisible, isProviderLoginPending, ProviderLoginDialog } from "./provider-login-dialog";
import { getEffectiveModelRuntime } from "./model-settings";
import { isNoRepositoryWorkspace, isSystemWorkspace, resolveRepoWorkspaceId, workspaceDisplayName } from "./workspace-roots";
import {
  clipboardHasPlainText,
  clipboardLooksLikeImage,
  extractAttachableClipboardFiles,
  extractFilesFromDataTransfer,
  hasFilesInDataTransfer,
  readComposerAttachmentsFromFiles,
} from "./composer-attachments";
import { fitComposerTextarea } from "./composer-height";
import { NATIVE_ATTACHMENTS_EVENT, requestNativeClipboardFiles, requestNativeClipboardImage } from "./tauri-native-attachments";

function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
      if (!active) {
        return;
      }
      setSnapshot(state);
      setSelectedTranscript(transcript);
    });

    const unsubscribeState = api.onStateChanged((state) => {
      if (active) {
        setSnapshot(state);
      }
    });
    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (active) {
        setSelectedTranscript(payload);
      }
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeTranscript();
    };
  }, []);

  return [snapshot, setSnapshot, selectedTranscript] as const;
}

function updateSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action().then((state) => {
    setSnapshot(state);
    return state;
  });
}

function formatUiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread";
}

const SIDEBAR_WIDTH_STORAGE_KEY = "alamelu-pi.sidebarWidth";
// Read the pre-rename key once so an existing sidebar width is not silently reset.
const LEGACY_SIDEBAR_WIDTH_STORAGE_KEY = "pi-gui.sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 292;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 620;
const MIN_MAIN_WIDTH = 520;
const SIDEBAR_RESIZER_WIDTH = 8;

function clampSidebarWidth(width: number, viewportWidth = window.innerWidth): number {
  const viewportMax = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_MAIN_WIDTH - SIDEBAR_RESIZER_WIDTH);
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, viewportMax, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

function clampSidebarPreference(width: number): number {
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

function getStoredSidebarWidth(): number {
  try {
    const stored = Number.parseInt((window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_SIDEBAR_WIDTH_STORAGE_KEY)) ?? "", 10);
    return Number.isFinite(stored) ? clampSidebarPreference(stored) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function storeSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Best-effort UI preference.
  }
}

type BusyActivity = "Working" | "Compacting conversation";

function useBusyLabel(startedAt: string | undefined, activity: BusyActivity) {
  const [label, setLabel] = useState(() => formatBusyLabel(startedAt, activity));

  useEffect(() => {
    setLabel(formatBusyLabel(startedAt, activity));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatBusyLabel(startedAt, activity));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt, activity]);

  return label;
}

function formatBusyLabel(startedAt: string | undefined, activity: BusyActivity): string {
  if (!startedAt) {
    return `${activity}…`;
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return `${activity} for ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `${activity} for ${minutes}m` : `${activity} for ${minutes}m ${remaining}s`;
}

export default function App() {
  const [snapshot, setSnapshot, selectedTranscript] = useDesktopAppState();
  const [composerDraft, setComposerDraft] = useState("");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [skillsWorkspaceId, setSkillsWorkspaceId] = useState("");
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");
  const [pendingNewThreadWorkspaceId, setPendingNewThreadWorkspaceId] = useState("");
  const [newThreadRootWorkspaceId, setNewThreadRootWorkspaceId] = useState("");
  const [newThreadEnvironment, setNewThreadEnvironment] = useState<NewThreadEnvironment>("local");
  const [newThreadPrompt, setNewThreadPrompt] = useState("");
  const [newThreadAttachments, setNewThreadAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [newThreadProvider, setNewThreadProvider] = useState<string | undefined>();
  const [newThreadModelId, setNewThreadModelId] = useState<string | undefined>();
  const [newThreadThinkingLevel, setNewThreadThinkingLevel] = useState<string | undefined>();
  const [newThreadComposerError, setNewThreadComposerError] = useState<string | undefined>();
  const [newThreadComposerErrorDetail, setNewThreadComposerErrorDetail] = useState<string | undefined>();
  const [startingThread, setStartingThread] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [providerLoginState, setProviderLoginState] = useState<ProviderLoginState>({ status: "idle" });
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, boolean>>({});
  const [treeModalState, setTreeModalState] = useState<{
    readonly open: boolean;
    readonly loading: boolean;
    readonly submitting: boolean;
    readonly tree?: SessionTreeSnapshot;
    readonly error?: string;
  }>({
    open: false,
    loading: false,
    submitting: false,
  });
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const newThreadComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptMarkerRef = useRef("");
  const readingAnchorRef = useRef<{ sessionKey: string; id: string; offset: number } | null>(null);
  const alignmentFrameRef = useRef<number | null>(null);

  const pinnedToBottomRef = useRef(true);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const previousActiveViewRef = useRef<AppView | null>(null);
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [timelineView, setTimelineView] = useState(false);
  const [openTerminalSessionKey, setOpenTerminalSessionKey] = useState("");
  const [takeoverTerminalSessionKey, setTakeoverTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState(getStoredSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const sidebarWidth = clampSidebarWidth(preferredSidebarWidth, viewportWidth);
  const threadSearch = useThreadSearch(timelinePaneRef);
  const api = window.piApp;
  const sidebarToggleStateRef = useRef<{
    readonly api: typeof window.piApp;
    readonly activeView: AppView | undefined;
    readonly sidebarCollapsed: boolean;
  }>({
    api,
    activeView: undefined,
    sidebarCollapsed: false,
  });
  sidebarToggleStateRef.current = {
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
  };

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((mode) => {
      setThemeMode(mode);
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onProviderLoginStateChanged) {
      return undefined;
    }
    return piApi.onProviderLoginStateChanged(setProviderLoginState);
  }, []);

  useEffect(() => {
    if (snapshot) {
      document.documentElement.classList.toggle("enable-transparency", snapshot.enableTransparency);
    }
  }, [snapshot?.enableTransparency]);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }

    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api?.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }

    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (snapshot?.activeView !== "settings" || settingsSection !== "notifications") {
      return undefined;
    }

    void refreshNotificationPermissionStatus();
    return undefined;
  }, [refreshNotificationPermissionStatus, settingsSection, snapshot?.activeView]);

  const selectedWorkspace = snapshot
    ? (() => {
        const selected = getSelectedWorkspace(snapshot);
        if (selected && !isSystemWorkspace(selected)) {
          return selected;
        }
        return snapshot.workspaces.find((workspace) => !isSystemWorkspace(workspace));
      })()
    : undefined;
  const selectedSession = snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined;
  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
  } = useMemo(() => {
    if (!snapshot) {
      return {
        activeWorktrees: [] as readonly WorktreeRecord[],
        linkedWorktreeByWorkspaceId: new Map<string, WorktreeRecord>(),
        rootWorkspace: undefined as WorkspaceRecord | undefined,
        rootWorkspaceOptions: [] as readonly WorkspaceRecord[],
        visibleWorkspaces: [] as readonly WorkspaceRecord[],
      };
    }

    const visibleSnapshotWorkspaces = snapshot.workspaces.filter((workspace) => !isSystemWorkspace(workspace));
    const workspacesById = new Map(visibleSnapshotWorkspaces.map((workspace) => [workspace.id, workspace] as const));
    const primaryWorkspaces = visibleSnapshotWorkspaces.filter((workspace) => workspace.kind === "primary");
    const orphanWorkspaces = visibleSnapshotWorkspaces.filter(
      (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
    );
    const nextVisibleWorkspaces =
      primaryWorkspaces.length > 0 ? [...primaryWorkspaces, ...orphanWorkspaces] : visibleSnapshotWorkspaces;
    const nextLinkedWorktreeByWorkspaceId = new Map(
      Object.values(snapshot.worktreesByWorkspace)
        .flat()
        .filter((worktree) => Boolean(worktree.linkedWorkspaceId))
        .map((worktree) => [worktree.linkedWorkspaceId as string, worktree] as const),
    );
    const nextRootWorkspaceId = resolveRepoWorkspaceId(visibleSnapshotWorkspaces, selectedWorkspace?.id);
    const nextRootWorkspace =
      (nextRootWorkspaceId ? visibleSnapshotWorkspaces.find((workspace) => workspace.id === nextRootWorkspaceId) : undefined)
      ?? selectedWorkspace;
    const nextRootWorkspaceOptions = [...new Set(visibleSnapshotWorkspaces.map((workspace) => resolveRepoWorkspaceId(visibleSnapshotWorkspaces, workspace.id) ?? workspace.id))]
      .map((workspaceId) => visibleSnapshotWorkspaces.find((workspace) => workspace.id === workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));

    return {
      activeWorktrees: nextRootWorkspace ? snapshot.worktreesByWorkspace[nextRootWorkspace.id] ?? [] : [],
      linkedWorktreeByWorkspaceId: nextLinkedWorktreeByWorkspaceId,
      rootWorkspace: nextRootWorkspace,
      rootWorkspaceOptions: nextRootWorkspaceOptions,
      visibleWorkspaces: nextVisibleWorkspaces,
    };
  }, [selectedWorkspace, snapshot]);
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const pendingProviderLoginProviderId = "providerId" in providerLoginState && isProviderLoginPending(providerLoginState)
    ? providerLoginState.providerId
    : undefined;
  const providerLoginProviderName = useMemo(() => {
    if (!("providerId" in providerLoginState)) {
      return "Provider";
    }
    const provider = Object.values(snapshot?.runtimeByWorkspace ?? {})
      .flatMap((runtime) => runtime.providers)
      .find((entry) => entry.id === providerLoginState.providerId);
    return provider?.name ?? providerLoginState.providerId;
  }, [providerLoginState, snapshot?.runtimeByWorkspace]);
  const startProviderLogin = useCallback(
    (
      workspaceId: string,
      providerId: string,
      onSuccess?: (state: DesktopAppState) => void,
    ) => {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.loginProvider(workspaceId, providerId))
        .then((state) => {
          if (!state.lastError) {
            onSuccess?.(state);
          }
        })
        .catch((error) => {
          const message = formatUiError(error);
          if (message.toLowerCase().includes("cancel")) {
            return;
          }
          setProviderLoginState({
            status: "error",
            requestId: `renderer-${Date.now()}`,
            workspaceId,
            providerId,
            message,
          });
        });
    },
    [api],
  );
  const respondToProviderLogin = useCallback(
    (response: ProviderLoginResponse) => {
      void api?.respondToProviderLogin(response).catch((error) => {
        if (!("workspaceId" in providerLoginState) || !("providerId" in providerLoginState)) {
          return;
        }
        setProviderLoginState({
          status: "error",
          requestId: response.requestId,
          workspaceId: providerLoginState.workspaceId,
          providerId: providerLoginState.providerId,
          message: formatUiError(error),
        });
      });
    },
    [api, providerLoginState],
  );
  const cancelProviderLogin = useCallback(
    (requestId: string) => {
      void api?.cancelProviderLogin(requestId).catch((error) => {
        if (!("workspaceId" in providerLoginState) || !("providerId" in providerLoginState)) {
          return;
        }
        setProviderLoginState({
          status: "error",
          requestId,
          workspaceId: providerLoginState.workspaceId,
          providerId: providerLoginState.providerId,
          message: formatUiError(error),
        });
      });
    },
    [api, providerLoginState],
  );
  const openProviderLoginUrl = useCallback(
    (url: string) => {
      void api?.openExternal(url).catch((error) => {
        if (!("workspaceId" in providerLoginState) || !("providerId" in providerLoginState) || !("requestId" in providerLoginState)) {
          return;
        }
        setProviderLoginState({
          status: "error",
          requestId: providerLoginState.requestId,
          workspaceId: providerLoginState.workspaceId,
          providerId: providerLoginState.providerId,
          message: formatUiError(error),
        });
      });
    },
    [api, providerLoginState],
  );
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const skillsWorkspace = skillsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === skillsWorkspaceId)
    : undefined;
  const extensionsWorkspace = extensionsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === extensionsWorkspaceId)
    : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot?.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const settingsModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, settingsWorkspace) : undefined;
  const skillsRuntime = skillsWorkspace ? snapshot?.runtimeByWorkspace[skillsWorkspace.id] : undefined;
  const extensionsRuntime = extensionsWorkspace ? snapshot?.runtimeByWorkspace[extensionsWorkspace.id] : undefined;
  const extensionsCommandCompatibility = extensionsWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[extensionsWorkspace.id] ?? []
    : [];
  const newThreadWorkspace =
    rootWorkspaceOptions.find((entry) => entry.id === newThreadRootWorkspaceId) ?? rootWorkspaceOptions[0];
  const newThreadIsNoRepository = isNoRepositoryWorkspace(newThreadWorkspace);
  const newThreadRuntime = snapshot ? getEffectiveModelRuntime(snapshot, newThreadWorkspace) : undefined;
  const newThreadDefaultEnabled = buildModelOptions(newThreadRuntime).some(
    (m) => m.providerId === newThreadRuntime?.settings.defaultProvider && m.modelId === newThreadRuntime?.settings.defaultModelId,
  );
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (m) => m.providerId === selectedModelRuntime?.settings.defaultProvider && m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadProvider = newThreadProvider ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultProvider : undefined);
  const resolvedNewThreadModelId = newThreadModelId ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultModelId : undefined);
  const resolvedNewThreadThinkingLevel = newThreadThinkingLevel ?? newThreadRuntime?.settings.defaultThinkingLevel;
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });
  const newThreadModelOnboarding = deriveModelOnboardingState(newThreadRuntime, {
    provider: resolvedNewThreadProvider,
    modelId: resolvedNewThreadModelId,
  });
  const [attachmentsClearedOnSubmit, setAttachmentsClearedOnSubmit] = useState(false);
  const composerAttachments = attachmentsClearedOnSubmit ? [] : (snapshot?.composerAttachments ?? []);
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  // Compaction (automatic inside a run, or manual) takes precedence over the generic working label.
  const compactingSince = selectedSession?.compactingSince;
  const runningLabel = useBusyLabel(
    compactingSince ?? (selectedSession?.status === "running" ? selectedSession.runningSince : undefined),
    compactingSince ? "Compacting conversation" : "Working",
  );
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKey === selectedSessionKey;
  const isTerminalTakeoverForSelectedThread = Boolean(selectedSessionKey) && takeoverTerminalSessionKey === selectedSessionKey;
  const activeTranscript =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript.transcript
      : [];
  const streamingMessageId =
    selectedTranscript?.workspaceId === selectedWorkspace?.id &&
    selectedTranscript?.sessionId === selectedSession?.id
      ? selectedTranscript?.activeAssistantMessageId
      : undefined;
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscript ||
    selectedTranscript.workspaceId !== selectedWorkspace?.id ||
    selectedTranscript.sessionId !== selectedSession?.id
  );
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];
  useEffect(() => {
    if (snapshot && snapshot.workspaces.length === 0) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
    }
  }, [snapshot]);
  useEffect(() => {
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
  }, [selectedSessionKey]);
  const selectedExtensionDock = useMemo(() => buildExtensionDockModel(selectedExtensionUi), [selectedExtensionUi]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const isSelectedExtensionDockExpanded = dockExpandedBySession[selectedSessionKey] ?? false;
  const persistedComposerDraft = snapshot?.composerDraft ?? "";
  const threadGroups = useMemo(
    () => (snapshot ? buildThreadGroups(snapshot) : []),
    [snapshot?.workspaces, snapshot?.worktreesByWorkspace, snapshot?.workspaceOrder],
  );
  const searchableThreads = useMemo(() => threadGroups.flatMap((group) =>
    group.threads.map((thread) => ({
      thread,
      workspaceName: thread.environment.kind === "worktree"
        ? thread.environment.label
        : workspaceDisplayName(group.rootWorkspace),
    })),
  ), [threadGroups]);
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  };
  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (openTerminalSessionKey === selectedSessionKey) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
      return;
    }
    setOpenTerminalSessionKey(selectedSessionKey);
  }, [openTerminalSessionKey, selectedSessionKey]);
  const focusNewThreadComposer = () => {
    window.requestAnimationFrame(() => {
      newThreadComposerRef.current?.focus();
    });
  };
  const resetExactBottomRestoreState = (nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  };
  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadComposerError(undefined);
    setNewThreadPrompt(value);
  }, []);
  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    if (behavior === "auto") {
      pane.scrollTop = pane.scrollHeight;
    } else {
      pane.scrollTo({ top: pane.scrollHeight, behavior });
    }
    pinnedToBottomRef.current = true;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
    setShowJumpToLatest(false);
  }, [selectedSessionKey]);

  const requestPinnedBottomAlignment = useCallback((
    behavior: ScrollBehavior = "auto",
    options?: { readonly preferExactRestore?: boolean },
  ) => {
    if (exactBottomRestoreSessionKeyRef.current === selectedSessionKey && selectedSessionKey) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    if (options?.preferExactRestore && selectedSessionKey && activeTranscript.length > VIRTUALIZATION_THRESHOLD) {
      exactBottomRestoreSessionKeyRef.current = selectedSessionKey;
      pendingPinnedBottomBehaviorRef.current = behavior;
      preserveBottomOnNextPaneResizeRef.current = true;
      setDisableTimelineVirtualization(true);
      return;
    }

    scrollTimelineToBottom(behavior);
  }, [activeTranscript.length, scrollTimelineToBottom, selectedSessionKey]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || snapshot?.activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || deferredPinnedBottomAlignmentRef.current;
    if (!shouldRestoreBottom) {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    const finishRestore = (remainingChecks: number, stableChecks: number) => {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
          return;
        }

        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          scrollTimelineToBottom();
        }

        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const nextStableChecks = remaining <= 16 ? stableChecks + 1 : 0;
        if (remainingChecks <= 1 || nextStableChecks >= 2) {
          const shouldApplyDeferredAlignment = deferredPinnedBottomAlignmentRef.current;
          resetExactBottomRestoreState();
          if (shouldApplyDeferredAlignment) {
            scrollTimelineToBottom();
          }
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }

        finishRestore(remainingChecks - 1, nextStableChecks);
      });
    };

    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
    }

    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
        return;
      }
      setDisableTimelineVirtualization(false);
      scrollTimelineToBottom(pendingPinnedBottomBehaviorRef.current);
      pendingPinnedBottomBehaviorRef.current = "auto";
      finishRestore(6, 0);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);
    pinnedToBottomRef.current = savedPinned ?? true;

    if (!selectedSessionKey || snapshot?.activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = (savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current;
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
      return;
    }

    if (savedScrollTop == null) {
      setDisableTimelineVirtualization(false);
      return;
    }

    node.scrollTop = savedScrollTop;
    pinnedToBottomRef.current = false;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    if (alignmentFrameRef.current !== null) window.cancelAnimationFrame(alignmentFrameRef.current);
    const waitForFrames = (remainingFrames: number) => {
      alignmentFrameRef.current = window.requestAnimationFrame(() => {
        alignmentFrameRef.current = null;
        if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) return;
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment();
        preserveBottomOnNextPaneResizeRef.current = false;
      });
    };
    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  useLayoutEffect(() => () => {
    if (alignmentFrameRef.current !== null) window.cancelAnimationFrame(alignmentFrameRef.current);
    alignmentFrameRef.current = null;
    readingAnchorRef.current = null;
  }, [selectedSessionKey]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) return;
    const releaseBottom = (event: WheelEvent) => {
      if (event.deltaY >= 0 || pane.scrollHeight <= pane.clientHeight) return;
      pinnedToBottomRef.current = false;
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      if (alignmentFrameRef.current !== null) window.cancelAnimationFrame(alignmentFrameRef.current);
      alignmentFrameRef.current = null;
    };
    pane.addEventListener("wheel", releaseBottom, { passive: true });
    return () => pane.removeEventListener("wheel", releaseBottom);
  }, [selectedSessionKey, timelinePaneMountVersion]);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const toggleDiffPanel = useCallback(() => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
    }

    setShowDiffPanel((prev) => !prev);

    if (!shouldPreserveBottom) {
      return;
    }

    schedulePinnedBottomRealignment(3);
  }, [schedulePinnedBottomRealignment]);

  const openSettings = (workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("settings"));
  };

  const closeTreeModal = useCallback(() => {
    setTreeModalState((current) =>
      current.submitting
        ? current
        : {
            open: false,
            loading: false,
            submitting: false,
          },
    );
    focusComposer();
  }, []);

  const openTreeModal = useCallback(() => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    setTreeModalState({
      open: true,
      loading: true,
      submitting: false,
    });
    setComposerDraft("");

    void api
      .getSessionTree({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      })
      .then((tree) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          tree,
        });
      })
      .catch((error) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, selectedSession, selectedWorkspace]);

  const navigateTreeSelection = useCallback(
    (targetId: string, options?: { readonly summarize?: boolean; readonly customInstructions?: string }) => {
      if (!api || !selectedWorkspace || !selectedSession) {
        return;
      }

      setTreeModalState((current) => ({ ...current, submitting: true, error: undefined }));
      void api
        .navigateSessionTree(
          {
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
          },
          targetId,
          options,
        )
        .then(({ state, result }) => {
          setSnapshot(state);
          setTreeModalState({
            open: false,
            loading: false,
            submitting: false,
          });
          setComposerDraft((current) =>
            !current.trim() && result.editorText ? result.editorText : state.composerDraft,
          );
          focusComposer();
        })
        .catch((error) => {
          setTreeModalState((current) => ({
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [api, selectedSession, selectedWorkspace],
  );

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: snapshot?.driverCapabilities.tree !== false,
    allowCompactCommand: snapshot?.driverCapabilities.compact !== false,
    onRunTreeCommand: openTreeModal,
    onSelectLoginProvider: (providerId) => {
      if (!selectedWorkspace) {
        return;
      }
      startProviderLogin(selectedWorkspace.id, providerId, (state) => {
        setComposerDraft(state.composerDraft);
      });
    },
  });

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    api,
  });

  const newThreadSlashMenu = useSlashMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: updateNewThreadPrompt,
    selectedRuntime: newThreadRuntime,
    selectedModelRuntime: newThreadRuntime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${newThreadWorkspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: newThreadWorkspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer: focusNewThreadComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (provider, modelId) => {
      setNewThreadProvider(provider);
      setNewThreadModelId(modelId);
    },
    onSelectThinkingOption: setNewThreadThinkingLevel,
    onSelectLoginProvider: (providerId) => {
      if (!newThreadWorkspace) {
        return;
      }
      startProviderLogin(newThreadWorkspace.id, providerId);
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.logoutProvider(newThreadWorkspace.id, providerId));
    },
  });

  const newThreadMentionMenu = useMentionMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: setNewThreadPrompt,
    composerRef: newThreadComposerRef,
    workspaceId: newThreadWorkspace?.id,
    api,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
    updateSnapshot,
  });

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
      setComposerDraft(snapshot.composerDraft);
      return;
    }

    if (snapshot.composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
    if (snapshot.composerDraftSyncSource === "persist" || snapshot.composerDraftSyncSource === "state") {
      return;
    }

    setComposerDraft(snapshot.composerDraft);
  }, [
    selectedSessionKey,
    snapshot?.composerDraft,
    snapshot?.composerDraftSyncNonce,
    snapshot?.composerDraftSyncSource,
  ]);

  useEffect(() => {
    const sessionExtensionUiBySession = snapshot?.sessionExtensionUiBySession;
    if (!sessionExtensionUiBySession) {
      setDockExpandedBySession((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    setDockExpandedBySession((current) => {
      let next: Record<string, boolean> | undefined;
      for (const [sessionKey, expanded] of Object.entries(current)) {
        if (!expanded && sessionExtensionUiBySession[sessionKey]) {
          continue;
        }
        if (hasExtensionDockContent(sessionExtensionUiBySession[sessionKey])) {
          continue;
        }
        if (!next) {
          next = { ...current };
        }
        delete next[sessionKey];
      }
      return next ?? current;
    });
  }, [snapshot?.sessionExtensionUiBySession]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setSkillsWorkspaceId("");
      setExtensionsWorkspaceId("");
      setPendingNewThreadWorkspaceId("");
      setNewThreadRootWorkspaceId("");
      setNewThreadEnvironment("local");
      setNewThreadAttachments([]);
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setSkillsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setExtensionsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setNewThreadRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (newThreadIsNoRepository && newThreadEnvironment === "worktree") {
      setNewThreadEnvironment("local");
    }
  }, [newThreadEnvironment, newThreadIsNoRepository]);

  useEffect(() => {
    if (!snapshot || !pendingNewThreadWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(visibleWorkspaces, pendingNewThreadWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((workspace) => workspace.id === nextRootWorkspaceId)) {
      return;
    }
    setNewThreadRootWorkspaceId(nextRootWorkspaceId);
    setPendingNewThreadWorkspaceId("");
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot, visibleWorkspaces]);

  const resetNewThreadSurface = (workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        resolveRepoWorkspaceId(visibleWorkspaces, workspaceId)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setNewThreadRootWorkspaceId(nextWorkspaceId);
    }
    setNewThreadEnvironment("local");
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  };

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleSidebarResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (snapshot?.sidebarCollapsed) {
      return;
    }
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let nextWidth = startWidth;

    document.documentElement.classList.add("is-sidebar-resizing");
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setPreferredSidebarWidth(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.documentElement.classList.remove("is-sidebar-resizing");
      setPreferredSidebarWidth(nextWidth);
      storeSidebarWidth(nextWidth);
      schedulePinnedBottomRealignment(2);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [schedulePinnedBottomRealignment, sidebarWidth, snapshot?.sidebarCollapsed]);

  const resetSidebarWidth = useCallback(() => {
    const nextWidth = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setPreferredSidebarWidth(nextWidth);
    storeSidebarWidth(nextWidth);
    schedulePinnedBottomRealignment(2);
  }, [schedulePinnedBottomRealignment]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTogglePrimarySidebar = useCallback(() => {
    const sidebarState = sidebarToggleStateRef.current;
    const sidebarApi = sidebarState.api;
    if (!sidebarApi || !canTogglePrimarySidebar(sidebarState.activeView)) {
      return false;
    }
    void updateSnapshot(sidebarApi, setSnapshot, () => sidebarApi.setSidebarCollapsed(!sidebarState.sidebarCollapsed));
    return true;
  }, []);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";

  useEffect(() => {
    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openSettings) {
        openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.openNewThread) {
        openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.toggleTerminal) {
        toggleTerminal();
        return true;
      } else if (command === desktopCommands.toggleSidebar) {
        return handleTogglePrimarySidebar();
      } else if (command === desktopCommands.openFolder) {
        if (api) {
          void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
          return true;
        }
      }
      return false;
    };

    const removeCommandListener = window.piApp?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      setPendingNewThreadWorkspaceId(workspaceId);
      resetNewThreadSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(handlePastedClipboardImage);
    const handleNativeAttachments = (event: Event) => {
      const attachments = (event as CustomEvent<ComposerAttachment[]>).detail ?? [];
      if (attachments.length === 0) {
        return;
      }
      handleNativeComposerAttachments(attachments);
    };
    window.addEventListener(NATIVE_ATTACHMENTS_EVENT, handleNativeAttachments);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getDesktopCommandFromShortcut({
          modifier: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          key: event.key,
          code: event.code,
        });
        if (command === desktopCommands.toggleTerminal || command === desktopCommands.openFolder) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      // Cmd+F toggles thread search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }
      // Cmd+D toggles diff panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleDiffPanel();
        return;
      }
      const command = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
      });
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener(NATIVE_ATTACHMENTS_EVENT, handleNativeAttachments);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.rootWorkspaceId,
    threadSearch,
    api,
    snapshot?.activeView,
    toggleDiffPanel,
    toggleTerminal,
    handleTogglePrimarySidebar,
  ]);

  useLayoutEffect(() => {
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) ?? true;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState(selectedSessionKey || null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
  }, [selectedSessionKey]);

  useLayoutEffect(() => {
    if (snapshot?.activeView !== "threads" || !selectedSession || activeTranscript.length === 0) {
      return;
    }
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) {
      return;
    }
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    selectedSession,
    selectedSessionKey,
    snapshot?.activeView,
  ]);

  useEffect(() => {
    setTreeModalState((current) =>
      current.open
        ? {
            open: false,
            loading: false,
            submitting: false,
          }
        : current,
    );
  }, [selectedSessionKey, snapshot?.activeView]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    // Initialize an unchosen draft on startup, but never replace an explicit repo + selection.
    if (snapshot.activeView === "new-thread" && !newThreadRootWorkspaceId) {
      const initialRepoId = resolveRepoWorkspaceId(visibleWorkspaces, selectedWorkspace?.id);
      if (initialRepoId) setNewThreadRootWorkspaceId(initialRepoId);
    }

    if (snapshot.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      resetExactBottomRestoreState();
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
      if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
        preserveBottomOnNextPaneResizeRef.current = true;
        schedulePinnedBottomRealignment(1);
      }
    }

    previousActiveViewRef.current = snapshot.activeView;
  }, [schedulePinnedBottomRealignment, selectedSession, selectedWorkspace?.id, snapshot, visibleWorkspaces, newThreadRootWorkspaceId]);

  useEffect(() => {
    if (!api || composerDraft === persistedComposerDraft) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void api.updateComposerDraft(composerDraft);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [api, composerDraft, persistedComposerDraft, setSnapshot]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    const pane = timelinePaneRef.current;
    const previousHeight = composer.getBoundingClientRect().height;
    const shouldPreserveBottom = pane
      ? isNearBottom(pane) || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current;

    fitComposerTextarea(composer, 220);

    const nextHeight = composer.getBoundingClientRect().height;
    if (Math.abs(nextHeight - previousHeight) >= 1 && shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    }
  }, [composerDraft, requestPinnedBottomAlignment]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession || snapshot?.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      scrollTimelineToBottom();
    };

    const updateMeasuredSize = (nextSize: { width: number; height: number }) => {
      const previousSize = previousTimelinePaneSizeRef.current;
      previousTimelinePaneSizeRef.current = nextSize;
      const shouldStickToBottom = preserveBottomOnNextPaneResizeRef.current || pinnedToBottomRef.current;
      const widthChanged = previousSize ? Math.abs(nextSize.width - previousSize.width) >= 1 : false;
      const heightChanged = previousSize ? Math.abs(nextSize.height - previousSize.height) >= 1 : false;
      if (!previousSize || (!widthChanged && !heightChanged) || !shouldStickToBottom) {
        return;
      }

      stickToBottomAfterLayoutChange();
    };

    updateMeasuredSize({ width: pane.clientWidth, height: pane.clientHeight });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateMeasuredSize({ width: pane.clientWidth, height: pane.clientHeight });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [scrollTimelineToBottom, selectedSessionKey, showDiffPanel, snapshot?.activeView, timelinePaneMountVersion]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript, streamingMessageId);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;

    if (pinnedToBottomRef.current) {
      scrollTimelineToBottom();
      return;
    }

    setShowJumpToLatest(true);
  }, [activeTranscript, scrollTimelineToBottom, selectedSession, selectedSessionKey, streamingMessageId]);

  const handleTimelineContentHeightChange = useCallback(() => {
    const pane = timelinePaneRef.current;
    if (!pane) return;
    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
      return;
    }
    const anchor = readingAnchorRef.current;
    if (anchor?.sessionKey !== selectedSessionKey) return;
    const row = Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-id]"))
      .find((entry) => entry.dataset.timelineId === anchor.id);
    if (row) {
      const offset = row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTop += offset - anchor.offset;
    }
  }, [scrollTimelineToBottom, selectedSessionKey]);

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-card">
          <div className="loading-card__eyebrow">Alamelu Pi</div>
          <h1>Loading sessions</h1>
          <p>The desktop shell is restoring folder and thread state from the main process.</p>
        </main>
      </div>
    );
  }

  const showTerminalTakeover = isTerminalVisibleForSelectedThread && isTerminalTakeoverForSelectedThread && Boolean(selectedWorkspace);
  const mainClassName = [
    "main",
    showDiffPanel ? "main--with-diff" : "",
    isTerminalVisibleForSelectedThread ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const terminalPanel = isTerminalVisibleForSelectedThread && selectedWorkspace ? (
    <TerminalPanel
      workspace={selectedWorkspace}
      sessionId={selectedSession?.id ?? ""}
      height={terminalHeight}
      isTakeover={isTerminalTakeoverForSelectedThread}
      onHeightChange={(nextHeight) => {
        setTerminalHeight(nextHeight);
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
      }}
      onToggleTakeover={() => {
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : selectedSessionKey));
      }}
      onHide={() => {
        setOpenTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        focusComposer();
      }}
    />
  ) : null;

  const setActiveView = (view: AppView) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView(view));
  };

  const openSkills = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : skillsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSkillsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("skills");
  };

  const openExtensions = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : extensionsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setExtensionsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("extensions");
  };

  const openNewThreadSurface = (workspaceId?: string) => {
    setPendingNewThreadWorkspaceId("");
    resetNewThreadSurface(workspaceId);
    setActiveView("new-thread");
  };

  const handleSelectNewThreadWorkspace = (workspaceId: string) => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadRootWorkspaceId(workspaceId);
    if (isNoRepositoryWorkspace(rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId))) {
      setNewThreadEnvironment("local");
    }
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerError(undefined);
  };

  const handlePickNewThreadWorkspace = () => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
  };

  const submitComposerDraft = (options: { readonly deliverAs?: "steer" | "followUp" } = {}) => {
    if (!selectedSession) {
      return;
    }

    const hasComposerInput = composerDraft.trim().length > 0 || composerAttachments.length > 0;
    if (selectedSession.status === "running" && !hasComposerInput) {
      void updateSnapshot(api, setSnapshot, () => api.cancelCurrentRun());
      return;
    }

    if (!hasComposerInput) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    const treeCommand = parseTreeComposerCommand(composerDraft);
    if (treeCommand?.type === "error") {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              lastError: treeCommand.message,
            }
          : current,
      );
      return;
    }
    if (treeCommand?.type === "tree") {
      openTreeModal();
      return;
    }

    const previousDraft = composerDraft;
    setComposerDraft("");
    setAttachmentsClearedOnSubmit(true);
    void (async () => {
      const nextState = await updateSnapshot(api, setSnapshot, () =>
        api.submitComposer(previousDraft, selectedSession.status === "running" ? { deliverAs: options.deliverAs ?? "followUp" } : undefined),
      );
      setComposerDraft(nextState.composerDraft);
      setAttachmentsClearedOnSubmit(false);
    })().catch(() => {
      setComposerDraft(previousDraft);
      setAttachmentsClearedOnSubmit(false);
    });
  };

  const handlePickAttachments = () => {
    void updateSnapshot(api, setSnapshot, () => api.pickComposerAttachments());
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeComposerAttachment(attachmentId));
  };

  const handleEditQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.editQueuedComposerMessage(messageId, composerDraft)).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleCancelQueuedEdit = () => {
    void updateSnapshot(api, setSnapshot, () => api.cancelQueuedComposerEdit()).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleRemoveQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeQueuedComposerMessage(messageId));
  };

  const handleSteerQueuedMessage = (messageId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.steerQueuedComposerMessage(messageId));
  };

  const handleNewThreadAddAttachments = (files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      if (attachments.length === 0) {
        return;
      }
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  };

  const handleNewThreadRemoveAttachment = (attachmentId: string) => {
    setNewThreadAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleImagePaste = (
    event: ClipboardEvent<HTMLDivElement>,
    onFiles: (files: File[]) => void,
    onNativeAttachments?: (attachments: readonly ComposerAttachment[]) => void,
  ) => {
    if (hasFilesInDataTransfer(event.clipboardData)) {
      event.preventDefault();
      const captured = extractAttachableClipboardFiles(event.clipboardData);
      void requestNativeClipboardFiles().then((nativeFiles) => {
        if (nativeFiles.length > 0) {
          onNativeAttachments?.(nativeFiles);
          return;
        }
        if (captured.length > 0) {
          onFiles(captured);
        }
      });
      return;
    }
    if (!clipboardLooksLikeImage(event.clipboardData) || clipboardHasPlainText(event.clipboardData)) {
      return;
    }
    event.preventDefault();
    void requestNativeClipboardImage().then((clipboardImage) => {
      if (clipboardImage) {
        onNativeAttachments?.([clipboardImage]);
      }
    });
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    onFiles(files);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(
      event,
      (files) => {
        void addAttachmentsToSessionComposer(files);
      },
      (attachments) => {
        if (!api) {
          return;
        }
        void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(attachments));
      },
    );
  };

  const handleNewThreadComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, handleNewThreadAddAttachments, (attachments) => {
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, (files) => {
      void addAttachmentsToSessionComposer(files);
    });
  };

  const handleNewThreadComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, handleNewThreadAddAttachments);
  };

  async function addAttachmentsToSessionComposer(files: File[]) {
    if (!api) {
      return;
    }
    const valid = await readComposerAttachmentsFromFiles(files);
    if (valid.length === 0) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(valid));
  }

  const handleClipboardImageShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "v") {
      return false;
    }

    const clipboardImage = api?.readClipboardImage();
    if (!clipboardImage) {
      return false;
    }

    event.preventDefault();
    onImage(clipboardImage);
    return true;
  };

  function handleNativeComposerAttachments(attachments: readonly ComposerAttachment[]) {
    const activeElement = document.activeElement;
    if (activeElement === newThreadComposerRef.current || snapshot?.activeView === "new-thread") {
      setNewThreadAttachments((current) => [...current, ...attachments]);
      return;
    }
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(attachments));
  }

  function handlePastedClipboardImage(clipboardImage: ComposerImageAttachment) {
    const activeElement = document.activeElement;
    if (activeElement === composerRef.current) {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
      return;
    }

    if (activeElement === newThreadComposerRef.current) {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    }
  }

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    setSwitchingModel(true);
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    ).finally(() => setSwitchingModel(false));
  };

  const handleSetSessionThinking = (level: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultModel(settingsWorkspace.id, provider, modelId));
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel));
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleToggleAutoCompaction = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setAutoCompaction(settingsWorkspace.id, enabled));
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setScopedModelPatterns(settingsWorkspace.id, patterns));
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setModelSettingsScopeMode(mode));
  };

  const handleLoginProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    startProviderLogin(settingsWorkspace.id, providerId);
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.logoutProvider(settingsWorkspace.id, providerId));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey),
    );
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.logoutProvider(settingsWorkspace.id, providerId),
    );
    return state.lastError;
  };

  const handleToggleSkill = (filePath: string, enabled: boolean) => {
    if (!skillsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setSkillEnabled(skillsWorkspace.id, filePath, enabled));
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!skillsWorkspace) {
      return;
    }
    void api.openSkillInFinder(skillsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!extensionsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!extensionsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleTrySkill = (command: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("threads"));
    slashMenu.fillComposerFromSlash(command);
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark") => {
    if (!api) return;
    setThemeMode(mode);
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleRequestNotificationPermission = () => {
    if (!api?.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api?.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .openSystemNotificationSettings()
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleArchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.archiveSession(target));
  };

  const handleRenameSession = (target: { workspaceId: string; sessionId: string }, title: string) =>
    updateSnapshot(api, setSnapshot, () => api.renameSession(target, title));

  const handleSelectSession = (target: { workspaceId: string; sessionId: string }) => {
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
    void updateSnapshot(api, setSnapshot, () => api.selectSession(target)).then(() => {
      focusComposer();
    });
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    ).then(() => {
      focusComposer();
    });
  };

  const handleToggleExtensionDock = () => {
    if (!selectedExtensionDock) {
      return;
    }

    setDockExpandedBySession((current) => ({
      ...current,
      [selectedSessionKey]: !(current[selectedSessionKey] ?? false),
    }));
  };

  const handleUnarchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unarchiveSession(target));
  };

  const handleStartThread = () => {
    if (!newThreadRootWorkspaceId || (!newThreadPrompt.trim() && newThreadAttachments.length === 0)) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(newThreadPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    const modelConfig = {
      prompt: newThreadPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
    };
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadIsNoRepository ? "local" : newThreadEnvironment,
      ...modelConfig,
    };
    wsMenu.expandWorkspace(newThreadRootWorkspaceId);
    setNewThreadComposerError(undefined);
    setNewThreadComposerErrorDetail(undefined);
    setStartingThread(true);
    void updateSnapshot(api, setSnapshot, () => api.startThread(input))
      .then((next) => {
        // A failed start resolves with the error in state, so only a real thread clears the draft.
        if (next?.lastError) {
          setNewThreadComposerError(next.lastError);
          setNewThreadComposerErrorDetail(next.lastErrorDetail);
          return;
        }
        setNewThreadPrompt("");
        setNewThreadAttachments([]);
        setNewThreadProvider(undefined);
        setNewThreadModelId(undefined);
        setNewThreadThinkingLevel(undefined);
        setNewThreadEnvironment("local");
      })
      .finally(() => setStartingThread(false));
  };

  const handleTimelineScroll = () => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const pinned = isNearBottom(pane);
    const measuredSize = previousTimelinePaneSizeRef.current;
    const pendingResize = measuredSize &&
      (measuredSize.width !== pane.clientWidth || measuredSize.height !== pane.clientHeight);
    // A resize can dispatch scroll before ResizeObserver restores the existing bottom pin.
    if (!pinned && (preserveBottomOnNextPaneResizeRef.current || (pinnedToBottomRef.current && pendingResize))) {
      return;
    }

    pinnedToBottomRef.current = pinned;
    if (!pinned) {
      if (alignmentFrameRef.current !== null) window.cancelAnimationFrame(alignmentFrameRef.current);
      alignmentFrameRef.current = null;
      const paneTop = pane.getBoundingClientRect().top;
      const row = Array.from(pane.querySelectorAll<HTMLElement>("[data-timeline-id]"))
        .find((entry) => entry.getBoundingClientRect().bottom > paneTop);
      readingAnchorRef.current = row
        ? { sessionKey: selectedSessionKey, id: row.dataset.timelineId!, offset: row.getBoundingClientRect().top - paneTop }
        : null;
    } else {
      readingAnchorRef.current = null;
    }
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      setShowJumpToLatest(false);
    }
  };

  const jumpToLatest = () => {
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
    })) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && selectedSession?.status === "running") {
      event.preventDefault();
      submitComposerDraft({ deliverAs: (event.metaKey || event.ctrlKey) ? "steer" : "followUp" });
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!composerDraft.trim() && composerAttachments.length === 0) {
      return;
    }
    if (selectedSessionModelOnboarding.requiresModelSelection) {
      return;
    }

    submitComposerDraft();
  };

  const handleNewThreadComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    })) {
      return;
    }

    if (newThreadMentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (newThreadSlashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!newThreadPrompt.trim() && newThreadAttachments.length === 0) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }

    handleStartThread();
  };

  const settingsNav = [
    { id: "appearance", label: "Appearance" },
    { id: "general", label: "General" },
    { id: "providers", label: "Providers" },
    { id: "models", label: "Models" },
    { id: "notifications", label: "Notifications" },
  ] as const;
  const providerLoginDialog = isProviderLoginDialogVisible(providerLoginState) ? (
    <ProviderLoginDialog
      providerName={providerLoginProviderName}
      state={providerLoginState}
      onCancel={cancelProviderLogin}
      onDismiss={() => setProviderLoginState({ status: "idle" })}
      onOpenExternal={openProviderLoginUrl}
      onRespond={respondToProviderLogin}
    />
  ) : null;

  if (snapshot.activeView === "settings") {
    return (
      <>
        <SecondarySurface
          activeNavId={settingsSection}
          navItems={settingsNav}
          onBack={() => setActiveView("threads")}
          onSelectNav={(section) => setSettingsSection(section as SettingsSection)}
          testId="settings-surface"
          title="Settings"
        >
          {settingsSection === "providers" || (settingsSection === "models" && snapshot.modelSettingsScopeMode === "per-repo") ? (
            <div className="surface-toolbar">
              <label className="surface-toolbar__field">
                <span>Workspace</span>
                <select
                  value={settingsWorkspace?.id ?? ""}
                  onChange={(event) => setSettingsWorkspaceId(event.target.value)}
                >
                  {rootWorkspaceOptions.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <SettingsView
            workspace={settingsWorkspace}
            runtime={settingsSection === "models" ? settingsModelRuntime : settingsRuntime}
            section={settingsSection}
            notificationPreferences={snapshot.notificationPreferences}
            notificationPermissionStatus={notificationPermissionStatus}
            notificationPermissionPending={notificationPermissionPending}
            modelSettingsScopeMode={snapshot.modelSettingsScopeMode}
            integratedTerminalShell={snapshot.integratedTerminalShell}
            themeMode={themeMode}
            enableTransparency={snapshot.enableTransparency}
            pendingProviderLoginProviderId={pendingProviderLoginProviderId}
            onLoginProvider={handleLoginProvider}
            onLogoutProvider={handleLogoutProvider}
            onSetProviderApiKey={handleSetProviderApiKey}
            onRemoveProviderApiKey={handleRemoveProviderApiKey}
            onSetModelSettingsScopeMode={handleSetModelSettingsScopeMode}
            onSetDefaultModel={handleSetDefaultModel}
            onSetNotificationPreferences={handleSetNotificationPreferences}
            onSetIntegratedTerminalShell={handleSetIntegratedTerminalShell}
            onRequestNotificationPermission={handleRequestNotificationPermission}
            onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
            onSetScopedModelPatterns={handleSetScopedModelPatterns}
            onSetThemeMode={handleSetThemeMode}
            onSetThinkingLevel={handleSetThinkingLevel}
            onToggleSkillCommands={handleToggleSkillCommands}
            onToggleAutoCompaction={handleToggleAutoCompaction}
            onSetEnableTransparency={(enabled) => {
              void updateSnapshot(api, setSnapshot, () => api.setEnableTransparency(enabled));
            }}
          />
        </SecondarySurface>
        {providerLoginDialog}
      </>
    );
  }

  if (snapshot.activeView === "skills") {
    return (
      <SecondarySurface lastError={snapshot.lastError} onBack={() => setActiveView("threads")} testId="skills-surface" title="Skills">
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select
              value={skillsWorkspace?.id ?? ""}
              onChange={(event) => setSkillsWorkspaceId(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SkillsView
          togglesManagedExternally={snapshot?.driverCapabilities.skillToggles === false}
          workspace={skillsWorkspace}
          runtime={skillsRuntime}
          onOpenSkillFolder={handleOpenSkillFolder}
          onRefresh={() => {
            if (!skillsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(skillsWorkspace.id));
          }}
          onToggleSkill={handleToggleSkill}
          onTrySkill={(skill) =>
            handleTrySkill(
              skill.filePath
                ? `${skill.slashCommand} `
                : "Create a new skill for this workspace and explain which files you will add.",
            )
          }
        />
      </SecondarySurface>
    );
  }

  if (snapshot.activeView === "extensions") {
    return (
      <SecondarySurface lastError={snapshot.lastError} onBack={() => setActiveView("threads")} testId="extensions-surface" title="Extensions">
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select
              value={extensionsWorkspace?.id ?? ""}
              onChange={(event) => setExtensionsWorkspaceId(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ExtensionsView
          togglesManagedExternally={snapshot?.driverCapabilities.skillToggles === false}
          workspace={extensionsWorkspace}
          runtime={extensionsRuntime}
          commandCompatibility={extensionsCommandCompatibility}
          onOpenExtensionFolder={handleOpenExtensionFolder}
          onRefresh={() => {
            if (!extensionsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(extensionsWorkspace.id));
          }}
          onToggleExtension={handleToggleExtension}
        />
      </SecondarySurface>
    );
  }

  const shellClassName = `shell${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`;
  const shellStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className={shellClassName} style={shellStyle}>
      <Topbar
        primarySidebarToggle={primarySidebarToggleVisible ? (
          <SidebarToggleButton collapsed={snapshot.sidebarCollapsed} shortcutLabel={sidebarToggleShortcutLabel} onToggle={handleTogglePrimarySidebar} />
        ) : undefined}
        onSearch={() => setSearchOpen(true)}
        timelineView={timelineView}
        onToggleTimeline={() => setTimelineView((current) => !current)}
        hasUnseen={searchableThreads.some((item) => item.thread.session.hasUnseenUpdate)}
        activeView={snapshot.activeView}
        rootWorkspace={snapshot.activeView === "new-thread" ? newThreadWorkspace : rootWorkspace}
        selectedWorkspace={selectedWorkspace}
        selectedSession={selectedSession}
        selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
        selectedWorktree={selectedWorktree}
        activeWorktrees={activeWorktrees}
        workspaces={visibleWorkspaces}
        wsMenu={wsMenu}
        api={api}
        setSnapshot={setSnapshot}
        updateSnapshot={updateSnapshot}
        terminalAvailable={Boolean(selectedSessionKey)}
        terminalVisible={isTerminalVisibleForSelectedThread}
        onToggleTerminal={toggleTerminal}
        showDiffPanel={showDiffPanel}
        onToggleDiffPanel={toggleDiffPanel}
      />
      {searchOpen ? (
        <SearchPopup
          items={searchableThreads}
          onSelectSession={(target) => { setSearchOpen(false); handleSelectSession(target); }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      {!snapshot.sidebarCollapsed ? (
        <Sidebar
          timelineView={timelineView}
          searchableThreads={searchableThreads}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onNewThread={(workspaceId) => { setTimelineView(false); openNewThreadSurface(workspaceId); }}
          onOpenSkills={openSkills}
          onOpenExtensions={openExtensions}
          onOpenSettings={openSettings}
          onArchiveSession={handleArchiveSession}
          onRenameSession={handleRenameSession}
          onSelectSession={handleSelectSession}
          onUnarchiveSession={handleUnarchiveSession}
        />
      ) : null}
      {!snapshot.sidebarCollapsed ? (
        <div
          aria-label="Resize thread sidebar"
          aria-orientation="vertical"
          className="sidebar-resizer"
          role="separator"
          tabIndex={0}
          title="Drag to resize the thread sidebar. Double-click to reset."
          onDoubleClick={resetSidebarWidth}
          onPointerDown={handleSidebarResizePointerDown}
        />
      ) : null}

      <main className={mainClassName}>
        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
        {snapshot.activeView === "new-thread" ? (
          rootWorkspaceOptions.length > 0 ? (
            <NewThreadView
              workspaces={rootWorkspaceOptions}
              selectedWorkspaceId={newThreadRootWorkspaceId || rootWorkspaceOptions[0]?.id || ""}
              runtime={newThreadRuntime}
              environment={newThreadEnvironment}
              prompt={newThreadPrompt}
              attachments={newThreadAttachments}
              lastError={newThreadComposerError}
              lastErrorDetail={newThreadComposerErrorDetail}
              worktreesUnsupported={snapshot.driverCapabilities.worktrees === false}
              starting={startingThread}
              provider={resolvedNewThreadProvider}
              modelId={resolvedNewThreadModelId}
              thinkingLevel={resolvedNewThreadThinkingLevel}
              modelOnboarding={newThreadModelOnboarding}
              composerRef={newThreadComposerRef}
              activeSlashCommand={newThreadSlashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={newThreadSlashMenu.activeSlashFlow?.command?.description}
              slashSections={newThreadSlashMenu.slashSections}
              slashOptions={newThreadSlashMenu.slashOptions}
              selectedSlashCommand={newThreadSlashMenu.activeSlashOptionCommand ?? newThreadSlashMenu.selectedSlashCommand}
              selectedSlashOption={newThreadSlashMenu.selectedSlashOption}
              showSlashMenu={newThreadSlashMenu.showSlashMenu}
              showSlashOptionMenu={newThreadSlashMenu.showSlashOptionMenu}
              slashOptionEmptyState={newThreadSlashMenu.slashOptionEmptyState}
              showMentionMenu={newThreadMentionMenu.showMentionMenu}
              mentionOptions={newThreadMentionMenu.mentionOptions}
              selectedMentionIndex={newThreadMentionMenu.selectedIndex}
              onChangePrompt={setNewThreadPrompt}
              onSelectEnvironment={setNewThreadEnvironment}
              onSelectWorkspace={handleSelectNewThreadWorkspace}
              onPickWorkspace={handlePickNewThreadWorkspace}
              onSetModel={(provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); }}
              onSetThinking={setNewThreadThinkingLevel}
              onOpenModelSettings={(section) => openSettings(newThreadWorkspace?.id, section)}
              onComposerKeyDown={handleNewThreadComposerKeyDown}
              onComposerPaste={handleNewThreadComposerPaste}
              onComposerDrop={handleNewThreadComposerDrop}
              onClearSlashCommand={newThreadSlashMenu.resetSlashUi}
              onSelectSlashCommand={(command) => {
                newThreadSlashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                newThreadSlashMenu.applySlashOptionSelection(option);
              }}
              onSelectMention={newThreadMentionMenu.insertMention}
              onAddAttachments={handleNewThreadAddAttachments}
              onRemoveAttachment={handleNewThreadRemoveAttachment}
              onSubmit={handleStartThread}
            />
          ) : (
            <section className="canvas canvas--empty">
              <div className="empty-panel">
                <div className="session-header__eyebrow">Workspace</div>
                <h1>Open a folder to start</h1>
                <p>Add a project folder before creating a new thread.</p>
              </div>
            </section>
          )
        ) : selectedWorkspace && selectedSession ? (
          <>
            <section className="canvas canvas--thread">
              <div className="conversation conversation--thread">
                <div className="chat-header">
                  <div className="chat-header__eyebrow">
                    {selectedWorkspace.kind === "worktree"
                      ? `${rootWorkspace?.name ?? selectedWorkspace.name} · ${selectedWorktree?.name ?? selectedWorkspace.branchName ?? "Worktree"}`
                      : `${selectedWorkspace.name} · Local`}
                  </div>
                  <div className="chat-header__row">
                    <h1 className="chat-header__title">{displayedSessionTitle}</h1>
                    <div className="chat-header__status">
                      {selectedSession.status === "running" ? runningLabel : formatRelativeTime(selectedSession.updatedAt)}
                    </div>
                  </div>
                </div>

                <ConversationTimeline
                  transcript={activeTranscript}
                  isTranscriptLoading={isTranscriptLoading}
                  timelinePaneRef={timelinePaneRef}
                  timelinePaneElementRef={setTimelinePaneElement}
                  disableVirtualization={disableTimelineVirtualization}
                  onDisableVirtualizationReady={finalizeTimelineVirtualizationDisable}
                  onTimelineScroll={handleTimelineScroll}
                  threadSearch={threadSearch}
                  showJumpToLatest={showJumpToLatest}
                  onJumpToLatest={jumpToLatest}
                  onContentHeightChange={handleTimelineContentHeightChange}
                  onViewFileInDiff={handleViewFileInDiff}
                  streamingMessageId={streamingMessageId}
                />
              </div>
            </section>
            <ComposerPanel
              key={selectedSessionKey}
              activeSlashCommand={slashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
              attachments={composerAttachments}
              queuedMessages={queuedComposerMessages}
              canEditQueuedMessages={snapshot.driverCapabilities.queueEditing !== false}
              editingQueuedMessageId={editingQueuedMessageId}
              composerDraft={composerDraft}
              composerRef={composerRef}
              runtime={selectedModelRuntime}
              provider={resolvedSessionProvider}
              modelId={resolvedSessionModelId}
              thinkingLevel={resolvedSessionThinkingLevel}
              onClearSlashCommand={slashMenu.resetSlashUi}
              onComposerKeyDown={handleComposerKeyDown}
              onComposerPaste={handleComposerPaste}
              onComposerDrop={handleComposerDrop}
              onPickAttachments={handlePickAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              onEditQueuedMessage={handleEditQueuedMessage}
              onCancelQueuedEdit={handleCancelQueuedEdit}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
              onSteerQueuedMessage={handleSteerQueuedMessage}
              onSelectSlashCommand={(command) => {
                slashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                slashMenu.applySlashOptionSelection(option);
              }}
              busy={switchingModel}
              onSetModel={handleSetSessionModel}
              onSetThinking={handleSetSessionThinking}
              modelOnboarding={selectedSessionModelOnboarding}
              onOpenModelSettings={(section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
              }
              onSubmit={submitComposerDraft}
              onSubmitSteer={() => submitComposerDraft({ deliverAs: "steer" })}
              runningLabel={runningLabel}
              selectedSession={selectedSession}
              lastError={snapshot.lastError}
              lastErrorDetail={snapshot.lastErrorDetail}
              selectedSlashCommand={slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand}
              selectedSlashOption={slashMenu.selectedSlashOption}
              slashOptionEmptyState={slashMenu.slashOptionEmptyState}
              setComposerDraft={setComposerDraft}
              showSlashOptionMenu={slashMenu.showSlashOptionMenu}
              showSlashMenu={slashMenu.showSlashMenu}
              slashOptions={slashMenu.slashOptions}
              slashSections={slashMenu.slashSections}
              showMentionMenu={mentionMenu.showMentionMenu}
              mentionOptions={mentionMenu.mentionOptions}
              selectedMentionIndex={mentionMenu.selectedIndex}
              onSelectMention={mentionMenu.insertMention}
              extensionDock={selectedExtensionDock}
              extensionDockExpanded={isSelectedExtensionDockExpanded}
              onToggleExtensionDock={handleToggleExtensionDock}
            />
            {activeExtensionDialog ? (
              <ExtensionDialog dialog={activeExtensionDialog} onRespond={handleRespondToExtensionDialog} />
            ) : null}
            {treeModalState.open ? (
              <TreeModal
                error={treeModalState.error}
                loading={treeModalState.loading}
                submitting={treeModalState.submitting}
                tree={treeModalState.tree}
                onClose={closeTreeModal}
                onNavigate={navigateTreeSelection}
              />
            ) : null}
          </>
        ) : selectedWorkspace ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>{selectedWorkspace.name}</h1>
              <p>Create a thread for this folder, then jump between sessions from the sidebar.</p>
              <div className="empty-panel__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
                >
                  New thread
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>Open a folder to start</h1>
              <p>Add project folders, group sessions under them, and jump between threads from the sidebar.</p>
            </div>
          </section>
        )}

        {terminalPanel}
          </>
        )}
        {showDiffPanel && selectedWorkspace && selectedSession ? (
          <DiffPanel
            workspaceId={selectedWorkspace.id}
            sessionId={selectedSession.id}
            api={api}
            sessionStatus={selectedSession.status}
            fileRequest={diffFileRequest}
          />
        ) : null}
      </main>
      {providerLoginDialog}
    </div>
  );
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"], streamingMessageId?: string): string {
  const lastItem = transcript.at(-1);
  const visibleItem = lastItem && lastItem.id === streamingMessageId
    ? { id: lastItem.id, preparing: true }
    : lastItem?.kind === "tool"
      ? { id: lastItem.id, status: lastItem.status, label: lastItem.label, input: lastItem.input, output: lastItem.output }
      : lastItem;
  return `${sessionKey}:${transcript.length}:${streamingMessageId ?? ""}:${visibleItem ? JSON.stringify(visibleItem) : ""}`;
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}
