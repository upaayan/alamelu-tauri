import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { listWorkspaceFiles } from "./app-store-files";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import { ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import { createRpcDesktopDriver } from "./rpc-desktop-driver";
import { resolveDesktopDriverConfig, type DesktopDefaultRpcConfig, type DesktopDriverKind } from "./rpc-driver-config";
import { applyPiAiPatch, checkPiAiPatch, readPiVersion, resolvePiAiTarget, shouldReapplyPatch } from "./pi-ai-patch.mjs";
import { normalizeProcessPathForPackagedApp, resolveInstalledPiBin } from "./process-path";
import type { DesktopAppState, ThemeMode } from "../src/desktop-state";
import { desktopIpc, getDesktopCommandFromShortcut } from "../src/ipc";
import type { ProviderLoginResponse, ProviderLoginState } from "../src/ipc";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@alamelu-pi/session-driver";
import type { GenerateThreadTitleOptions } from "@alamelu-pi/session-driver";
import type { WorkspaceRef } from "@alamelu-pi/session-driver";
import type { RuntimeLoginAuthInfo, RuntimeLoginCallbacks } from "@alamelu-pi/session-driver/runtime-types";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
let integratedTerminalShell = "";
let stopPublishingState: (() => void) | undefined;
let stopPublishingSelectedTranscript: (() => void) | undefined;
let stopTrackingWindowActivation: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";

function bootLog(message: string): void {
  if (process.env.ALPI_BOOT_LOG === "1") {
    console.error(`[alpi-boot] ${message}`);
  }
  if (isAlpiStartupDebugEnabled()) {
    writeAlpiStartupDebug(message);
  }
}

function isAlpiStartupDebugEnabled(): boolean {
  return app.getName() === "Alamelu Pi" || process.env.PI_GUI_BRAND === "alpi" || process.env.ALPI_STARTUP_DEBUG === "1";
}

function isAlpiBrand(): boolean {
  return app.getName() === "Alamelu Pi" || process.env.PI_GUI_BRAND === "alpi";
}

function writeAlpiStartupDebug(message: string): void {
  try {
    const line = `${new Date().toISOString()} pid=${process.pid} ${message}\n`;
    appendFileSync(path.join(app.getPath("userData"), "alpi-startup-debug.log"), line, "utf8");
  } catch {
    // best-effort diagnostics only
  }
}

function stateDebugSummary(state: DesktopAppState): string {
  const providerCounts = Object.values(state.runtimeByWorkspace ?? {}).map((runtime) => runtime.providers?.length ?? 0);
  const modelCounts = Object.values(state.runtimeByWorkspace ?? {}).map((runtime) => runtime.models?.length ?? 0);
  const sessionCount = state.workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0);
  return `workspaces=${state.workspaces.length} sessions=${sessionCount} runtimeWorkspaces=${Object.keys(state.runtimeByWorkspace ?? {}).length} providerCounts=${providerCounts.join(",") || "none"} modelCounts=${modelCounts.join(",") || "none"} selectedWorkspace=${state.selectedWorkspaceId || "none"} selectedSession=${state.selectedSessionId || "none"} activeView=${state.activeView} lastError=${state.lastError || "none"}`;
}
const terminalFocusedWebContentsIds = new Set<number>();
let quittingAfterStoreFlush = false;

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_DIMENSION = 8_192;

type ProviderLoginPendingKind = "select" | "manualInput" | "prompt";

interface ProviderLoginPendingRequest {
  readonly kind: ProviderLoginPendingKind;
  readonly allowEmpty: boolean;
  readonly resolve: (value: string | undefined) => void;
  readonly reject: (error: Error) => void;
}

interface ProviderLoginSession {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly providerId: string;
  readonly abortController: AbortController;
  pending?: ProviderLoginPendingRequest;
  lastAuth?: RuntimeLoginAuthInfo;
}

class ProviderLoginController {
  private activeSession: ProviderLoginSession | undefined;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  begin(workspaceId: string, providerId: string): { readonly requestId: string; readonly callbacks: RuntimeLoginCallbacks } {
    if (this.activeSession) {
      throw new Error("Another provider login is already in progress.");
    }

    const session: ProviderLoginSession = {
      requestId: randomUUID(),
      workspaceId,
      providerId,
      abortController: new AbortController(),
    };
    this.activeSession = session;
    this.publish({ status: "starting", requestId: session.requestId, workspaceId, providerId });

    return {
      requestId: session.requestId,
      callbacks: {
        onAuth: async (info) => {
          this.requireActive(session.requestId).lastAuth = info;
          this.publish({
            status: "auth",
            requestId: session.requestId,
            workspaceId,
            providerId,
            url: info.url,
            ...(info.instructions ? { instructions: info.instructions } : {}),
          });
          await this.openExternalAuthUrl(info.url);
        },
        onManualCodeInput: () =>
          this.requestValue(session.requestId, "manualInput", {
            status: "manualInput",
            requestId: session.requestId,
            workspaceId,
            providerId,
            message: "Paste the redirect URL or code below, or finish login in the browser.",
            ...(session.lastAuth?.url ? { url: session.lastAuth.url } : {}),
            ...(session.lastAuth?.instructions ? { instructions: session.lastAuth.instructions } : {}),
          }).then((value) => value ?? ""),
        onDeviceCode: async (info) => {
          this.publish({
            status: "deviceCode",
            requestId: session.requestId,
            workspaceId,
            providerId,
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            ...(info.intervalSeconds ? { intervalSeconds: info.intervalSeconds } : {}),
            ...(info.expiresInSeconds ? { expiresInSeconds: info.expiresInSeconds } : {}),
          });
          await this.openExternalAuthUrl(info.verificationUri);
        },
        onSelect: (prompt) =>
          this.requestValue(session.requestId, "select", {
            status: "select",
            requestId: session.requestId,
            workspaceId,
            providerId,
            message: prompt.message,
            options: prompt.options,
          }),
        onPrompt: (prompt) =>
          this.requestValue(session.requestId, "prompt", {
            status: "prompt",
            requestId: session.requestId,
            workspaceId,
            providerId,
            message: prompt.message,
            ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
            ...(prompt.allowEmpty ? { allowEmpty: prompt.allowEmpty } : {}),
          }, Boolean(prompt.allowEmpty)).then((value) => value ?? ""),
        onProgress: (message) => {
          this.publish({ status: "progress", requestId: session.requestId, workspaceId, providerId, message });
        },
        signal: session.abortController.signal,
      },
    };
  }

  respond(response: ProviderLoginResponse): void {
    const session = this.requireActive(response.requestId);
    const pending = session.pending;
    if (!pending) {
      throw new Error("No provider login response is currently expected.");
    }

    if (response.type !== pending.kind) {
      throw new Error(`Provider login is waiting for ${pending.kind}, not ${response.type}.`);
    }

    const value = response.type === "select" ? response.optionId : response.value;
    const normalized = response.type === "select" ? value : value.trim();
    if (!pending.allowEmpty && normalized.length === 0) {
      throw new Error("A value is required to continue provider login.");
    }

    session.pending = undefined;
    pending.resolve(normalized || undefined);
  }

  cancel(requestId: string, message = "Login cancelled."): void {
    const session = this.activeSession;
    if (!session || session.requestId !== requestId) {
      return;
    }

    session.abortController.abort();
    this.rejectPending(session, new Error(message));
    this.publish({
      status: "cancelled",
      requestId: session.requestId,
      workspaceId: session.workspaceId,
      providerId: session.providerId,
      message,
    });
    this.activeSession = undefined;
  }

  complete(requestId: string): void {
    const session = this.activeSession;
    if (!session || session.requestId !== requestId) {
      return;
    }

    this.rejectPending(session, new Error("Provider login finished."));
    this.publish({
      status: "complete",
      requestId: session.requestId,
      workspaceId: session.workspaceId,
      providerId: session.providerId,
    });
    this.activeSession = undefined;
  }

  fail(requestId: string, error: unknown): void {
    const session = this.activeSession;
    if (!session || session.requestId !== requestId) {
      return;
    }

    const message = formatErrorMessage(error);
    this.rejectPending(session, new Error(message));
    this.publish({
      status: "error",
      requestId: session.requestId,
      workspaceId: session.workspaceId,
      providerId: session.providerId,
      message,
    });
    this.activeSession = undefined;
  }

  cancelForWindow(window: BrowserWindow): void {
    const currentWindow = this.getWindow();
    const session = this.activeSession;
    if (session && currentWindow === window) {
      this.cancel(session.requestId, "Login cancelled because the window closed.");
    }
  }

  private requestValue(
    requestId: string,
    kind: ProviderLoginPendingKind,
    state: Exclude<ProviderLoginState, { readonly status: "idle" }>,
    allowEmpty = false,
  ): Promise<string | undefined> {
    const session = this.requireActive(requestId);
    if (session.pending) {
      this.rejectPending(session, new Error("Provider login moved to a new prompt."));
    }

    this.publish(state);
    return new Promise((resolve, reject) => {
      session.pending = { kind, allowEmpty, resolve, reject };
    });
  }

  private requireActive(requestId: string): ProviderLoginSession {
    const session = this.activeSession;
    if (!session || session.requestId !== requestId) {
      throw new Error("Provider login is no longer active.");
    }
    return session;
  }

  private rejectPending(session: ProviderLoginSession, error: Error): void {
    const pending = session.pending;
    session.pending = undefined;
    pending?.reject(error);
  }

  private publish(state: ProviderLoginState): void {
    const window = this.getWindow();
    if (window && canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.providerLoginStateChanged, state);
    }
  }

  private async openExternalAuthUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Provider login supplied an unsupported URL.");
    }
    if (process.env.PI_APP_TEST_PROVIDER_LOGIN_FLOW === "1") {
      return;
    }
    await shell.openExternal(url);
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const providerLoginController = new ProviderLoginController(() => mainWindow);

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function resolveAlpiLunaWebSocketRecoveryExtensionPath(): string {
  const extensionPath = app.isPackaged
    ? path.join(process.resourcesPath, "extensions", "alpi-luna-websocket-recovery.ts")
    : path.join(__dirname, "..", "..", "resources", "alpi-luna-websocket-recovery.ts");
  if (!existsSync(extensionPath)) {
    throw new Error(`Alamelu Luna recovery extension is missing: ${extensionPath}`);
  }
  return extensionPath;
}

function readClipboardImageAttachment(): ComposerImageAttachment | null {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  if (size.width > MAX_CLIPBOARD_IMAGE_DIMENSION || size.height > MAX_CLIPBOARD_IMAGE_DIMENSION) {
    return null;
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    return null;
  }

  return {
    id: randomUUID(),
    kind: "image",
    name: "pasted-image.png",
    mimeType: "image/png",
    data: png.toString("base64"),
  };
}

function createWindow(): BrowserWindow {
  const backgroundTestMode = windowTestMode === "background";
  const enableTransparency = store ? store.state.enableTransparency : false;
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    transparent: enableTransparency,
    vibrancy: process.platform === "darwin" && enableTransparency ? "under-window" : undefined,
    titleBarStyle: "hiddenInset",
    backgroundColor: enableTransparency ? "#00000000" : themeManager.getResolvedTheme() === "dark" ? "#1e1f22" : "#f8f8fb",
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
    },
  });

  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = process.platform === "darwin" ? input.meta : input.control;
    const terminalFocused = terminalFocusedWebContentsIds.has(window.webContents.id);
    if (terminalFocused) {
      return;
    }
    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog();
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void window.loadURL(pathToFileURL(indexPath).toString());
  }

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  stopPublishingState?.();
  stopPublishingSelectedTranscript?.();
  stopPublishingState = store.subscribe((state) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.stateChanged, state);
    }
  });
  stopPublishingSelectedTranscript = store.subscribeToSelectedTranscript((payload) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.selectedTranscriptChanged, payload);
    }
  });
  window.webContents.once("render-process-gone", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
  });
  window.once("closed", () => {
    providerLoginController.cancelForWindow(window);
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
    if (mainWindow === window) {
      mainWindow = null;
    }
    terminalFocusedWebContentsIds.delete(webContentsId);
    terminalService?.dispose();
  });
}

function attachViewedSessionTracking(window: BrowserWindow): void {
  stopTrackingWindowActivation?.();

  const handleActivation = () => {
    store.handleWindowActivation();
  };
  const clearTracking = () => {
    stopTrackingWindowActivation?.();
    stopTrackingWindowActivation = undefined;
  };

  window.on("focus", handleActivation);
  window.on("show", handleActivation);
  window.on("restore", handleActivation);
  window.once("closed", clearTracking);

  stopTrackingWindowActivation = () => {
    window.off("focus", handleActivation);
    window.off("show", handleActivation);
    window.off("restore", handleActivation);
    window.off("closed", clearTracking);
  };
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed();
}

function resolveWindowTestMode(): "foreground" | "background" {
  return process.env.PI_APP_TEST_MODE?.trim().toLowerCase() === "background" ? "background" : "foreground";
}

async function pickWorkspaceViaDialog(): Promise<DesktopAppState> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Open workspace folder",
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open workspace folder",
      });
  if (result.canceled || result.filePaths.length === 0) {
    return store.getState();
  }
  const nextState = await store.addWorkspace(result.filePaths[0] as string);
  if (!nextState.selectedWorkspaceId) {
    return nextState;
  }
  const newThreadState =
    nextState.activeView === "new-thread" ? nextState : await store.setActiveView("new-thread");
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
  return newThreadState;
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: "Open Folder…",
          accelerator: "Command+O",
          click: () => {
            void pickWorkspaceViaDialog();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

interface AppBrandConfig {
  readonly appName: string;
  readonly defaultDriver?: DesktopDriverKind;
  readonly defaultRpc?: (defaultUserDataDir: string) => DesktopDefaultRpcConfig;
}

function resolveAppBrand(): AppBrandConfig {
  const requestedBrand = process.env.PI_GUI_BRAND?.trim().toLowerCase();
  const packagedName = app.getName();
  const executableName = path.basename(process.execPath).toLowerCase();
  const executableBundle = process.execPath.toLowerCase();
  const isAlpi =
    requestedBrand === "alpi" ||
    packagedName === "Alamelu Pi" ||
    executableName === "alpi" ||
    executableBundle.includes("/alpi.app/");
  if (!isAlpi) {
    return {
      appName: process.env.PI_GUI_APP_NAME?.trim() || "pi",
    };
  }

  return {
    appName: process.env.PI_GUI_APP_NAME?.trim() || "Alamelu Pi",
    defaultDriver: "rpc",
    defaultRpc: (defaultUserDataDir) => ({
      piBin: resolveInstalledPiBin({ homeDir: homedir() }),
      agentDir: "~/.pi/agent",
      sessionDir: path.join(defaultUserDataDir, "sessions"),
      userDataDir: defaultUserDataDir,
      labWorkspace: path.join(defaultUserDataDir, "workspace"),
      allowSharedAgentDir: true,
      noTools: false,
      noExtensions: false,
      noSkills: false,
      noPromptTemplates: false,
      noThemes: false,
      allowRealWorkspace: true,
    }),
  };
}

/**
 * Keeps the installed pi-ai carrying our tool-call-id patch. `pi update` reinstalls the
 * library and silently reverts it, which brings back the duplicate-id 400 on model
 * switches — so the app re-applies it whenever the installed pi version changes.
 * Never runs under test: Playwright boots must not mutate the global npm tree.
 */
async function ensurePiAiPatched(piBin: string, userDataDir: string): Promise<void> {
  if (process.env.PI_APP_TEST_MODE) return;
  const statePath = path.join(userDataDir, "pi-patch-state.json");
  try {
    const currentVersion = readPiVersion(piBin);
    let storedVersion: string | undefined;
    try {
      storedVersion = JSON.parse(await readFile(statePath, "utf8")).piVersion;
    } catch {
      // No state yet (first launch, or a fresh user-data dir).
    }

    const target = resolvePiAiTarget(piBin);
    const state = checkPiAiPatch(target);
    if (state === "drifted") {
      bootLog(`pi-ai patch skipped: installed source no longer matches the expected shape (pi ${currentVersion})`);
      return;
    }
    if (!shouldReapplyPatch(storedVersion, currentVersion, state)) return;

    const result = applyPiAiPatch(target);
    await writeFile(statePath, `${JSON.stringify({ piVersion: currentVersion, patchedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    bootLog(`pi-ai patch ${result.changed ? "applied" : "already present"} for pi ${currentVersion}`);
  } catch (error) {
    bootLog(`pi-ai patch check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureRpcAuthCopy(agentDir: string): Promise<void> {
  const source = path.join(homedir(), ".pi/agent/auth.json");
  const destination = path.join(agentDir, "auth.json");
  try {
    await stat(destination);
    return;
  } catch {
    // Missing destination is expected on first Alamelu Pi launch.
  }

  try {
    await stat(source);
  } catch {
    return;
  }

  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);

  const [agentReal, destinationReal, productionReal] = await Promise.all([
    realpath(agentDir),
    realpath(destination),
    realpath(path.join(homedir(), ".pi/agent")),
  ]);
  if (!isPathInside(agentReal, destinationReal) || isPathInside(productionReal, destinationReal)) {
    throw new Error("Refusing unsafe RPC auth copy path");
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

const appBrand = resolveAppBrand();
bootLog(`resolved brand appName=${appBrand.appName} defaultDriver=${appBrand.defaultDriver ?? "sdk"} packagedName=${app.getName()}`);
app.setName(appBrand.appName);

const defaultUserDataDir = app.getPath("userData");
const desktopDriverConfig = resolveDesktopDriverConfig(process.env, {
  homeDir: homedir(),
  defaultUserDataDir,
  productionUserDataDir: path.join(homedir(), "Library/Application Support/pi"),
  defaultDriver: appBrand.defaultDriver,
  ...(appBrand.defaultRpc ? { defaultRpc: appBrand.defaultRpc(defaultUserDataDir) } : {}),
});
const configuredUserDataDir = desktopDriverConfig.userDataDir;
bootLog(`driver=${desktopDriverConfig.driver} userData=${configuredUserDataDir}`);
app.setPath("userData", configuredUserDataDir);
if (desktopDriverConfig.driver === "rpc") {
  const normalizedPath = normalizeProcessPathForPackagedApp({
    homeDir: homedir(),
    piBin: desktopDriverConfig.rpc.piBin,
  });
  bootLog(`normalized path=${normalizedPath}`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  bootLog("single instance lock unavailable; quitting");
  app.quit();
}

app.on("second-instance", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  bootLog("app ready");
  if (!hasSingleInstanceLock) {
    return;
  }

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }

  let generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  let deferredThreadTitle:
    | {
        resolve: (title: string | null) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  if (desktopDriverConfig.driver === "rpc") {
    // Before the driver exists, so no pi child is ever spawned against an unpatched lib.
    await ensurePiAiPatched(desktopDriverConfig.rpc.piBin, desktopDriverConfig.userDataDir);
  }
  if (desktopDriverConfig.driver === "rpc" && !desktopDriverConfig.rpc.allowSharedAgentDir) {
    await ensureRpcAuthCopy(desktopDriverConfig.rpc.agentDir);
  }
  const alpiLunaWebSocketRecoveryExtensionPath =
    desktopDriverConfig.driver === "rpc" && isAlpiBrand() && desktopDriverConfig.rpc.noExtensions === false
      ? resolveAlpiLunaWebSocketRecoveryExtensionPath()
      : undefined;
  const rpcDriver =
    desktopDriverConfig.driver === "rpc"
      ? createRpcDesktopDriver({
          piBin: desktopDriverConfig.rpc.piBin,
          agentDir: desktopDriverConfig.rpc.agentDir,
          sessionDir: desktopDriverConfig.rpc.sessionDir,
          userDataDir: desktopDriverConfig.rpc.userDataDir,
          labWorkspace: desktopDriverConfig.rpc.labWorkspace,
          expectedLabWorkspaceRoot: desktopDriverConfig.rpc.labWorkspace,
          productionUserDataDir: desktopDriverConfig.rpc.productionUserDataDir,
          catalogFilePath: path.join(configuredUserDataDir, "catalogs.json"),
          ...(desktopDriverConfig.rpc.provider ? { provider: desktopDriverConfig.rpc.provider } : {}),
          ...(desktopDriverConfig.rpc.model ? { model: desktopDriverConfig.rpc.model } : {}),
          ...(desktopDriverConfig.rpc.allowSharedAgentDir ? { allowSharedAgentDir: desktopDriverConfig.rpc.allowSharedAgentDir } : {}),
          ...(desktopDriverConfig.rpc.noTools !== undefined ? { noTools: desktopDriverConfig.rpc.noTools } : {}),
          ...(desktopDriverConfig.rpc.noExtensions !== undefined ? { noExtensions: desktopDriverConfig.rpc.noExtensions } : {}),
          ...(desktopDriverConfig.rpc.noSkills !== undefined ? { noSkills: desktopDriverConfig.rpc.noSkills } : {}),
          ...(desktopDriverConfig.rpc.noPromptTemplates !== undefined ? { noPromptTemplates: desktopDriverConfig.rpc.noPromptTemplates } : {}),
          ...(desktopDriverConfig.rpc.noThemes !== undefined ? { noThemes: desktopDriverConfig.rpc.noThemes } : {}),
          ...(alpiLunaWebSocketRecoveryExtensionPath ? { extensionPaths: [alpiLunaWebSocketRecoveryExtensionPath] } : {}),
          ...(desktopDriverConfig.rpc.allowRealWorkspace ? { allowRealWorkspace: desktopDriverConfig.rpc.allowRealWorkspace } : {}),
        })
      : undefined;
  bootLog("creating desktop store");
  const alpiBrand = isAlpiBrand();
  store = new DesktopAppStore({
    userDataDir: configuredUserDataDir,
    initialWorkspacePaths:
      desktopDriverConfig.driver === "rpc" && !alpiBrand
        ? [desktopDriverConfig.rpc.labWorkspace]
        : resolveInitialWorkspacePaths(),
    enableNoRepositoryWorkspace: alpiBrand,
    getWindow: () => mainWindow,
    generateThreadTitleOverride: async (workspace, options) => generateThreadTitleOverride?.(workspace, options),
    ...(rpcDriver ? { driver: rpcDriver } : {}),
    ...(desktopDriverConfig.driver === "rpc"
      ? { sessionDir: desktopDriverConfig.rpc.sessionDir, piBin: desktopDriverConfig.rpc.piBin }
      : {}),
  });
  bootLog(`store config userData=${configuredUserDataDir} driver=${desktopDriverConfig.driver} appPath=${app.getAppPath()} cwd=${process.cwd()} path=${process.env.PATH || ""}`);
  await store.initialize();
  bootLog(`store initialized ${stateDebugSummary(await store.getState())}`);
  integratedTerminalShell = (await store.getState()).integratedTerminalShell;
  stopPruningTerminals = store.subscribe((state) => {
    integratedTerminalShell = state.integratedTerminalShell;
    const workspacePaths = state.workspaces.map((workspace) => workspace.path);
    const workspacePathSignature = workspacePaths.join("\0");
    if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
      retainedTerminalWorkspacePathSignature = workspacePathSignature;
      terminalService?.retainWorkspacePaths(workspacePaths);
    }
  });
  installApplicationMenu();
  if (process.env.PI_APP_TEST_MODE) {
    Object.assign(globalThis, {
      __PI_APP_TEST_HOOKS: {
        emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
        setDeferredThreadTitleMode: () => {
          generateThreadTitleOverride = () =>
            new Promise<string | null>((resolve, reject) => {
              deferredThreadTitle = { resolve, reject };
            });
        },
        hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
        resolveDeferredThreadTitle: (title: string) => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.resolve(title);
        },
        rejectDeferredThreadTitle: () => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.reject(new Error("Deferred thread-title rejected by test"));
        },
      },
    });
  }
  notificationPermissionService = new NotificationPermissionService(() => mainWindow);
  notificationPermissionService.subscribe((status) => {
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
    }
  });
  notificationManager = new NotificationManager(store, () => mainWindow, notificationPermissionService);
  stopNotifications = notificationManager.start();

  ipcMain.handle(desktopIpc.ping, () =>
    devReloadMarkersEnabled ? `pi desktop ready:${MAIN_DEV_RELOAD_MARKER}` : "pi desktop ready",
  );
  ipcMain.handle(desktopIpc.getThemeMode, () => themeManager.getMode());
  ipcMain.handle(desktopIpc.getResolvedTheme, () => themeManager.getResolvedTheme());
  ipcMain.handle(desktopIpc.setThemeMode, (_event, mode: ThemeMode) => {
    themeManager.setMode(mode);
    return mode;
  });
  ipcMain.handle(desktopIpc.openExternal, (_event, url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Refusing to open unsupported URL: ${url}`);
    }
    return shell.openExternal(url);
  });
  ipcMain.handle(desktopIpc.stateRequest, async () => {
    const state = await store.getState();
    bootLog(`ipc getState ${stateDebugSummary(state)}`);
    return state;
  });
  ipcMain.handle(desktopIpc.selectedTranscriptRequest, () => store.getSelectedTranscript());
  ipcMain.handle(desktopIpc.addWorkspacePath, (_event, workspacePath: string) => store.addWorkspace(workspacePath));
  ipcMain.handle(desktopIpc.pickWorkspace, () => pickWorkspaceViaDialog());
  ipcMain.handle(desktopIpc.selectWorkspace, (_event, workspaceId: string) => store.selectWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.renameWorkspace, (_event, workspaceId: string, displayName: string) =>
    store.renameWorkspace(workspaceId, displayName),
  );
  ipcMain.handle(desktopIpc.removeWorkspace, (_event, workspaceId: string) => store.removeWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.reorderWorkspaces, (_event, order: readonly string[]) => store.reorderWorkspaces(order));
  ipcMain.handle(desktopIpc.openWorkspaceInFinder, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openPath(workspacePath);
  });
  ipcMain.handle(desktopIpc.createWorktree, (_event, input: CreateWorktreeInput) =>
    store.createWorktree(input),
  );
  ipcMain.handle(desktopIpc.removeWorktree, (_event, input: RemoveWorktreeInput) =>
    store.removeWorktree(input),
  );
  ipcMain.handle(desktopIpc.syncCurrentWorkspace, () => store.syncCurrentWorkspace());
  ipcMain.handle(desktopIpc.selectSession, (_event, target: WorkspaceSessionTarget) =>
    store.selectSession(target),
  );
  ipcMain.handle(desktopIpc.archiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.archiveSession(target),
  );
  ipcMain.handle(desktopIpc.renameSession, (_event, target: WorkspaceSessionTarget, title: string) =>
    store.renameSession(target, title),
  );
  ipcMain.handle(desktopIpc.unarchiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.unarchiveSession(target),
  );
  ipcMain.handle(desktopIpc.setActiveView, (_event, activeView) => store.setActiveView(activeView));
  ipcMain.handle(desktopIpc.setSidebarCollapsed, (_event, collapsed: boolean) =>
    store.setSidebarCollapsed(collapsed),
  );
  ipcMain.handle(desktopIpc.refreshRuntime, (_event, workspaceId?: string) => store.refreshRuntime(workspaceId));
  ipcMain.handle(desktopIpc.setModelSettingsScopeMode, (_event, mode) => store.setModelSettingsScopeMode(mode));
  ipcMain.handle(desktopIpc.setSessionModel, (_event, workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    store.setSessionModel({ workspaceId, sessionId }, provider, modelId),
  );
  ipcMain.handle(desktopIpc.setDefaultModel, (_event, workspaceId: string, provider: string, modelId: string) =>
    store.setDefaultModel(workspaceId, provider, modelId),
  );
  ipcMain.handle(
    desktopIpc.setDefaultThinkingLevel,
    (_event, workspaceId: string, thinkingLevel) => store.setDefaultThinkingLevel(workspaceId, thinkingLevel),
  );
  ipcMain.handle(
    desktopIpc.setSessionThinkingLevel,
    (_event, workspaceId: string, sessionId: string, thinkingLevel) =>
      store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel),
  );
  ipcMain.handle(desktopIpc.loginProvider, async (_event, workspaceId: string, providerId: string) => {
    const login = providerLoginController.begin(workspaceId, providerId);
    try {
      const state = process.env.PI_APP_TEST_PROVIDER_LOGIN_FLOW === "1"
        ? await runProviderLoginTestFlow(workspaceId, providerId, login.callbacks)
        : await store.loginProvider(workspaceId, providerId, login.callbacks);
      if (state.lastError) {
        providerLoginController.fail(login.requestId, state.lastError);
      } else {
        providerLoginController.complete(login.requestId);
      }
      return state;
    } catch (error) {
      providerLoginController.fail(login.requestId, error);
      throw error;
    }
  });
  ipcMain.handle(desktopIpc.providerLoginRespond, (_event, response: ProviderLoginResponse) => {
    providerLoginController.respond(response);
  });
  ipcMain.handle(desktopIpc.providerLoginCancel, (_event, requestId: string) => {
    providerLoginController.cancel(requestId);
  });
  ipcMain.handle(desktopIpc.logoutProvider, (_event, workspaceId: string, providerId: string) =>
    store.logoutProvider(workspaceId, providerId),
  );
  ipcMain.handle(desktopIpc.setProviderApiKey, (_event, workspaceId: string, providerId: string, apiKey: string) =>
    store.setProviderApiKey(workspaceId, providerId, apiKey),
  );
  ipcMain.handle(desktopIpc.setEnableSkillCommands, (_event, workspaceId: string, enabled: boolean) =>
    store.setEnableSkillCommands(workspaceId, enabled),
  );
  ipcMain.handle(desktopIpc.setScopedModelPatterns, (_event, workspaceId: string, patterns: readonly string[]) =>
    store.setScopedModelPatterns(workspaceId, patterns),
  );
  ipcMain.handle(desktopIpc.setSkillEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setSkillEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.setExtensionEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setExtensionEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.respondToHostUiRequest, (_event, workspaceId: string, sessionId: string, response) =>
    store.respondToHostUiRequest({ workspaceId, sessionId }, response),
  );
  ipcMain.handle(desktopIpc.setNotificationPreferences, (_event, preferences) =>
    store.setNotificationPreferences(preferences),
  );
  ipcMain.handle(desktopIpc.setIntegratedTerminalShell, (_event, shellPath: string) =>
    store.setIntegratedTerminalShell(shellPath),
  );
  ipcMain.handle(desktopIpc.setEnableTransparency, async (_event, enabled: boolean) => {
    const nextState = await store.setEnableTransparency(enabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === "darwin") {
        mainWindow.setVibrancy(enabled ? "under-window" : null);
      }
    }
    return nextState;
  });
  ipcMain.handle(desktopIpc.terminalEnsurePanel, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().ensurePanel(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalCreateSession, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().createSession(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalSetActiveSession, (event, workspaceId: string, terminalScopeId: string, terminalId: string) => {
    return getTerminalService().setActiveSession(event.sender, workspaceId, terminalScopeId, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalWrite, (event, terminalId: string, data: string) => {
    terminalService?.write(event.sender, terminalId, data);
  });
  ipcMain.handle(desktopIpc.terminalResize, (event, terminalId: string, size) => {
    terminalService?.resize(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalRestartSession, (event, terminalId: string, size) => {
    return getTerminalService().restart(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalCloseSession, (event, terminalId: string) => {
    return getTerminalService().close(event.sender, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalSetTitle, (event, terminalId: string, title: string) => {
    terminalService?.setTitle(event.sender, terminalId, title);
  });
  ipcMain.on(desktopIpc.terminalSetFocused, (event, focused: boolean) => {
    if (focused) {
      terminalFocusedWebContentsIds.add(event.sender.id);
    } else {
      terminalFocusedWebContentsIds.delete(event.sender.id);
    }
  });
  ipcMain.handle(desktopIpc.getNotificationPermissionStatus, () =>
    notificationPermissionService?.getCurrentStatus() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.requestNotificationPermission, () =>
    notificationPermissionService?.requestPermission() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.openSystemNotificationSettings, () =>
    notificationPermissionService?.openSystemSettings() ?? Promise.resolve(),
  );
  ipcMain.handle(desktopIpc.createSession, (_event, input: CreateSessionInput) =>
    store.createSession(input),
  );
  ipcMain.handle(desktopIpc.startThread, (_event, input: StartThreadInput) => store.startThread(input));
  ipcMain.handle(desktopIpc.openSkillInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.openExtensionInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown extension: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.cancelCurrentRun, () => store.cancelCurrentRun());
  ipcMain.handle(desktopIpc.pickComposerAttachments, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Attach files",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return store.getState();
    }
    const attachments = await Promise.all(result.filePaths.map(readComposerAttachment));
    return store.addComposerAttachments(attachments);
  });
  ipcMain.on(desktopIpc.readClipboardImage, (event) => {
    event.returnValue = readClipboardImageAttachment();
  });
  ipcMain.handle(desktopIpc.addComposerAttachments, (_event, attachments: readonly ComposerAttachment[]) => {
    const validated = attachments.flatMap(validateComposerAttachmentPayload);
    return store.addComposerAttachments(validated);
  });
  ipcMain.handle(desktopIpc.removeComposerAttachment, (_event, attachmentId: string) =>
    store.removeComposerAttachment(attachmentId),
  );
  ipcMain.handle(desktopIpc.editQueuedComposerMessage, (_event, messageId: string, currentDraft?: string) =>
    store.editQueuedComposerMessage(messageId, currentDraft),
  );
  ipcMain.handle(desktopIpc.cancelQueuedComposerEdit, () =>
    store.cancelQueuedComposerEdit(),
  );
  ipcMain.handle(desktopIpc.removeQueuedComposerMessage, (_event, messageId: string) =>
    store.removeQueuedComposerMessage(messageId),
  );
  ipcMain.handle(desktopIpc.steerQueuedComposerMessage, (_event, messageId: string) =>
    store.steerQueuedComposerMessage(messageId),
  );
  ipcMain.handle(desktopIpc.updateComposerDraft, (_event, composerDraft: string) =>
    store.updateComposerDraft(composerDraft),
  );
  ipcMain.handle(
    desktopIpc.submitComposer,
    (_event, text: string, options?: { readonly deliverAs?: "steer" | "followUp" }) => store.submitComposer(text, options),
  );
  ipcMain.handle(desktopIpc.getSessionTree, (_event, target: WorkspaceSessionTarget) =>
    store.getSessionTree(target),
  );
  ipcMain.handle(
    desktopIpc.navigateSessionTree,
    (_event, target: WorkspaceSessionTarget, targetId: string, options) =>
      store.navigateSessionTree(target, targetId, options),
  );
  ipcMain.handle(desktopIpc.listWorkspaceFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return listWorkspaceFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getChangedFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return getChangedFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getFileDiff, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return "";
    }
    return getFileDiff(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.stageFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageFile(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.toggleWindowMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  mainWindow = createWindow();
  bootLog("main window created");
  notificationManager.trackWindow(mainWindow);
  notificationPermissionService.trackWindow(mainWindow);
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);
  attachViewedSessionTracking(mainWindow);
  void notificationPermissionService.getCurrentStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      notificationManager?.trackWindow(mainWindow);
      notificationPermissionService?.trackWindow(mainWindow);
      themeManager.setWindow(mainWindow);
      attachStatePublisher(mainWindow);
      attachViewedSessionTracking(mainWindow);
      void notificationPermissionService?.getCurrentStatus();
    }
  });
});

app.on("window-all-closed", () => {
  bootLog("window-all-closed");
  if (process.platform !== "darwin") {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  bootLog("before-quit");
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  if (quittingAfterStoreFlush || !store) {
    return;
  }

  event.preventDefault();
  quittingAfterStoreFlush = true;
  void store
    .shutdown()
    .catch(() => undefined)
    .finally(() => {
      app.quit();
    });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
  };
}

async function readComposerImageAttachment(filePath: string, mimeType: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (typeof attachment.data !== "string" || typeof attachment.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
      },
    ];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

async function runProviderLoginTestFlow(
  workspaceId: string,
  providerId: string,
  callbacks: RuntimeLoginCallbacks,
): Promise<DesktopAppState> {
  const selection = await callbacks.onSelect?.({
    message: `Choose how to sign in to ${providerId}.`,
    options: [
      { id: "browser", label: "Browser login" },
      { id: "device", label: "Device code login" },
    ],
  });

  if (selection === "device") {
    await callbacks.onDeviceCode?.({
      userCode: "TEST-CODE",
      verificationUri: "https://example.invalid/device",
      intervalSeconds: 1,
      expiresInSeconds: 600,
    });
    await waitForProviderLoginAbort(callbacks.signal);
  } else {
    await callbacks.onAuth({
      url: "https://example.invalid/oauth",
      instructions: "Complete the test browser sign-in, then paste the redirect URL.",
    });
    const manualCode = await callbacks.onManualCodeInput?.();
    if (!manualCode) {
      throw new Error("Test provider login requires a redirect URL.");
    }
    await callbacks.onProgress?.("Validating test provider login");
    const confirmation = await callbacks.onPrompt({
      message: "Confirm test provider login",
      placeholder: "ok",
    });
    if (confirmation.trim().toLowerCase() !== "ok") {
      throw new Error("Test provider login confirmation must be ok.");
    }
  }

  await callbacks.onProgress?.("Refreshing provider state");
  return store.refreshRuntime(workspaceId);
}

function waitForProviderLoginAbort(signal: AbortSignal | undefined): Promise<never> {
  if (signal?.aborted) {
    return Promise.reject(new Error("Login cancelled."));
  }
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(new Error("Login cancelled."));
      },
      { once: true },
    );
  });
}
