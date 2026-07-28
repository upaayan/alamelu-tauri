import readline from "node:readline";
import { desktopIpc } from "../src/ipc";
import {
  activateNotification,
  app,
  applyNativeWindowState,
  inspectTauriShim,
  ipcMain,
  type NativeWindowState,
} from "./tauri-electron-shim";

if (process.env.ALAMELU_TAURI_RESOURCES) {
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: process.env.ALAMELU_TAURI_RESOURCES,
  });
}

interface RequestMessage {
  readonly type: "request";
  readonly id: string;
  readonly channel: string;
  readonly args?: unknown[];
}

interface ShutdownMessage {
  readonly type: "shutdown";
}

interface WindowStateMessage extends NativeWindowState {
  readonly type: "window-state";
}

interface NotificationActivatedMessage {
  readonly type: "notification-activated";
  readonly id?: string;
}

interface NativeOpenWorkspaceMessage {
  readonly type: "native-open-workspace";
  readonly path: string;
}

interface NativeResponseMessage {
  readonly type: "native-response";
  readonly id: string;
  readonly ok: boolean;
  readonly result?: string;
  readonly error?: string;
}

type IncomingMessage =
  | RequestMessage
  | ShutdownMessage
  | WindowStateMessage
  | NotificationActivatedMessage
  | NativeOpenWorkspaceMessage
  | NativeResponseMessage;

const TEST_PROBE_CHANNEL = "__alamelu_tauri:test-probe";
const TEST_SESSION_EVENT_CHANNEL = "__alamelu_tauri:test-session-event";
let nativeRequestSequence = 0;
const pendingNativeRequests = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

const nativeOwned = new Set<string>([
  desktopIpc.pickWorkspace,
  desktopIpc.pickComposerAttachments,
  desktopIpc.readClipboardImage,
  desktopIpc.toggleWindowMaximize,
  desktopIpc.openExternal,
  desktopIpc.getThemeMode,
  desktopIpc.getResolvedTheme,
  desktopIpc.setThemeMode,
  desktopIpc.getNotificationPermissionStatus,
  desktopIpc.requestNotificationPermission,
  desktopIpc.openSystemNotificationSettings,
]);

const eventChannels = new Set<string>([
  desktopIpc.stateChanged,
  desktopIpc.selectedTranscriptChanged,
  desktopIpc.appCommand,
  desktopIpc.workspacePicked,
  desktopIpc.clipboardImagePasted,
  desktopIpc.providerLoginStateChanged,
  desktopIpc.terminalData,
  desktopIpc.terminalExit,
  desktopIpc.terminalError,
  desktopIpc.notificationPermissionStatusChanged,
  desktopIpc.themeChanged,
]);

const expectedBackendChannels = Object.values(desktopIpc).filter(
  (channel) => !nativeOwned.has(channel) && !eventChannels.has(channel),
);

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

(globalThis as {
  __ALAMELU_TAURI_TRANSPORT__?: {
    emitEvent(channel: string, payload: unknown): void;
    emitNotification(id: string, title: string, body: string): void;
    requestNative(method: "notification-status" | "notification-request"): Promise<string>;
  };
}).__ALAMELU_TAURI_TRANSPORT__ = {
  emitEvent(channel, payload) {
    write({ type: "event", channel, payload });
  },
  emitNotification(id, title, body) {
    write({ type: "notification", id, title, body });
  },
  requestNative(method) {
    const id = `native-request-${++nativeRequestSequence}`;
    return new Promise<string>((resolve, reject) => {
      pendingNativeRequests.set(id, { resolve, reject });
      write({ type: "native-request", id, method });
    });
  },
};

process.on("uncaughtException", (error) => {
  write({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
});

process.on("unhandledRejection", (error) => {
  write({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
});

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let message: IncomingMessage;
  try {
    message = JSON.parse(line) as IncomingMessage;
  } catch {
    write({ type: "fatal", error: "Backend received malformed JSON" });
    return;
  }

  if (message.type === "shutdown") {
    app.quit();
    return;
  }
  if (message.type === "window-state") {
    applyNativeWindowState(message);
    return;
  }
  if (message.type === "notification-activated") {
    activateNotification(message.id);
    return;
  }
  if (message.type === "native-open-workspace") {
    await addNativeWorkspace(message.path);
    return;
  }
  if (message.type === "native-response") {
    const pending = pendingNativeRequests.get(message.id);
    if (!pending) return;
    pendingNativeRequests.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result ?? "unknown");
    } else {
      pending.reject(new Error(message.error ?? "Native request failed"));
    }
    return;
  }

  try {
    const result =
      message.channel === TEST_PROBE_CHANNEL
        ? inspectTauriShim()
        : message.channel === TEST_SESSION_EVENT_CHANNEL
          ? await emitTestSessionEvent(message.args?.[0])
          : await ipcMain.dispatch(message.channel, message.args ?? []);
    write({ type: "response", id: message.id, ok: true, result: result ?? null });
  } catch (error) {
    write({
      type: "response",
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function addNativeWorkspace(workspacePath: string): Promise<void> {
  let state = (await ipcMain.dispatch(desktopIpc.addWorkspacePath, [workspacePath])) as {
    activeView?: string;
    selectedWorkspaceId?: string;
  };
  if (state.activeView !== "new-thread") {
    state = (await ipcMain.dispatch(desktopIpc.setActiveView, ["new-thread"])) as typeof state;
  }
  if (state.selectedWorkspaceId) {
    write({
      type: "event",
      channel: desktopIpc.workspacePicked,
      payload: state.selectedWorkspaceId,
    });
  }
}

async function emitTestSessionEvent(event: unknown): Promise<null> {
  const hooks = (globalThis as {
    __PI_APP_TEST_HOOKS?: { emitSessionEvent?: (value: unknown) => Promise<void> };
  }).__PI_APP_TEST_HOOKS;
  if (!hooks?.emitSessionEvent) {
    throw new Error("Tauri test session-event hook is unavailable");
  }
  await hooks.emitSessionEvent(event);
  return null;
}

void import("./main.js").then(() => waitForHandlers());

function waitForHandlers(): void {
  const deadline = Date.now() + 30_000;
  const check = () => {
    const missing = expectedBackendChannels.filter(
      (channel) => !ipcMain.handlers.has(channel) && ipcMain.listenerCount(channel) === 0,
    );
    if (missing.length === 0) {
      write({ type: "ready", handlers: expectedBackendChannels.length });
      return;
    }
    if (Date.now() >= deadline) {
      write({ type: "fatal", error: `Backend handler registration timed out: ${missing.join(", ")}` });
      return;
    }
    setTimeout(check, 25);
  };
  check();
}
