import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type IpcHandler = (event: SyntheticIpcEvent, ...args: unknown[]) => unknown;

interface SyntheticIpcEvent {
  readonly sender: SyntheticWebContents;
  returnValue?: unknown;
}

interface BackendTransport {
  emitEvent(channel: string, payload: unknown): void;
  emitNotification(id: string, title: string, body: string): void;
  requestNative(method: "notification-status" | "notification-request"): Promise<string>;
}

export interface NativeWindowState {
  readonly focused: boolean;
  readonly visible: boolean;
  readonly minimized: boolean;
  readonly closed: boolean;
}

function transport(): BackendTransport {
  const value = (globalThis as { __ALAMELU_TAURI_TRANSPORT__?: BackendTransport })
    .__ALAMELU_TAURI_TRANSPORT__;
  if (!value) {
    throw new Error("Alamelu Tauri backend transport is not initialized");
  }
  return value;
}

class SyntheticWebContents extends EventEmitter {
  readonly id = 1;

  send(channel: string, payload?: unknown): void {
    transport().emitEvent(channel, payload);
  }

  isDestroyed(): boolean {
    return false;
  }

  isCrashed(): boolean {
    return false;
  }

  openDevTools(): void {}

  async executeJavaScript(script: string): Promise<string> {
    return transport().requestNative(
      script.includes("requestPermission")
        ? "notification-request"
        : "notification-status",
    );
  }
}

const windows: SyntheticBrowserWindow[] = [];

class SyntheticBrowserWindow extends EventEmitter {
  readonly webContents = new SyntheticWebContents();
  private destroyed = false;
  private minimized = false;
  private visible = true;
  private focused = true;
  private maximized = false;

  constructor(_options?: unknown) {
    super();
    windows.push(this);
  }

  static getAllWindows(): SyntheticBrowserWindow[] {
    return windows.filter((entry) => !entry.isDestroyed());
  }

  static fromWebContents(contents: SyntheticWebContents): SyntheticBrowserWindow | undefined {
    return windows.find((entry) => entry.webContents === contents && !entry.isDestroyed());
  }

  async loadURL(_url: string): Promise<void> {
    queueMicrotask(() => this.emit("ready-to-show"));
  }

  show(): void {
    this.visible = true;
    this.emit("show");
  }

  hide(): void {
    this.visible = false;
    this.emit("hide");
  }

  focus(): void {
    this.focused = true;
    this.emit("focus");
  }

  blur(): void {
    this.focused = false;
    this.emit("blur");
  }

  restore(): void {
    this.minimized = false;
    this.emit("restore");
  }

  maximize(): void {
    this.maximized = true;
  }

  unmaximize(): void {
    this.maximized = false;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isFocused(): boolean {
    return this.focused;
  }

  setVibrancy(): void {}

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }

  applyNativeState(state: NativeWindowState): void {
    if (state.closed) {
      this.close();
      return;
    }
    if (this.visible !== state.visible) {
      this.visible = state.visible;
      this.emit(state.visible ? "show" : "hide");
    }
    if (this.minimized !== state.minimized) {
      this.minimized = state.minimized;
      this.emit(state.minimized ? "minimize" : "restore");
    }
    if (this.focused !== state.focused) {
      this.focused = state.focused;
      this.emit(state.focused ? "focus" : "blur");
    }
  }

  snapshot(): NativeWindowState {
    return {
      focused: this.focused,
      visible: this.visible,
      minimized: this.minimized,
      closed: this.destroyed,
    };
  }
}

class SyntheticApp extends EventEmitter {
  name = "Alamelu Pi Tauri";
  readonly isPackaged = true;
  readonly dock = { setIcon: () => undefined };
  private readonly paths = new Map<string, string>();
  private readyPromise: Promise<void> | undefined;
  private quitting = false;

  constructor() {
    super();
    const explicitData = process.env.PI_APP_USER_DATA_DIR?.trim();
    const defaultData =
      platform() === "darwin"
        ? path.join(homedir(), "Library", "Application Support", "Alamelu Pi Tauri")
        : platform() === "win32"
          ? path.join(process.env.APPDATA || homedir(), "Alamelu Pi Tauri")
          : path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "alamelu-pi-tauri");
    this.paths.set("userData", explicitData || defaultData);
  }

  whenReady(): Promise<void> {
    this.readyPromise ??= Promise.resolve();
    return this.readyPromise;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  getPath(name: string): string {
    return this.paths.get(name) || homedir();
  }

  setPath(name: string, value: string): void {
    this.paths.set(name, value);
  }

  getAppPath(): string {
    return process.env.ALAMELU_TAURI_BACKEND_DIR || process.cwd();
  }

  requestSingleInstanceLock(): boolean {
    return true;
  }

  quit(): void {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.emit("before-quit", event);
    if (event.defaultPrevented || this.quitting) return;
    this.quitting = true;
    for (const window of SyntheticBrowserWindow.getAllWindows()) {
      window.close();
    }
    queueMicrotask(() => process.exit(0));
  }
}

export const app = new SyntheticApp();
export const BrowserWindow = SyntheticBrowserWindow;

class IpcMain extends EventEmitter {
  readonly handlers = new Map<string, IpcHandler>();

  handle(channel: string, handler: IpcHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Duplicate IPC handler: ${channel}`);
    }
    this.handlers.set(channel, handler);
  }

  async dispatch(channel: string, args: unknown[]): Promise<unknown> {
    const event: SyntheticIpcEvent = { sender: mainWebContents() };
    const handler = this.handlers.get(channel);
    if (handler) {
      return handler(event, ...args);
    }
    if (this.listenerCount(channel) > 0) {
      this.emit(channel, event, ...args);
      return event.returnValue;
    }
    throw new Error(`No backend handler registered for ${channel}`);
  }
}

export const ipcMain = new IpcMain();

function mainWebContents(): SyntheticWebContents {
  return SyntheticBrowserWindow.getAllWindows()[0]?.webContents ?? new SyntheticWebContents();
}

async function openTarget(target: string): Promise<void> {
  if (platform() === "darwin") {
    await execFileAsync("/usr/bin/open", [target]);
    return;
  }
  if (platform() === "win32") {
    await execFileAsync("cmd.exe", ["/c", "start", "", target], { windowsHide: true });
    return;
  }
  await execFileAsync("xdg-open", [target]);
}

export const shell = {
  openExternal: openTarget,
  openPath: openTarget,
};

export const dialog = {
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    throw new Error("Native file dialogs are owned by the Tauri host");
  },
};

const emptyImage = {
  isEmpty: () => true,
  getSize: () => ({ width: 0, height: 0 }),
  toPNG: () => Buffer.alloc(0),
};

export const clipboard = {
  readImage: () => emptyImage,
};

export const nativeImage = {
  createFromPath: (filePath: string) => ({ filePath }),
};

export const Menu = {
  buildFromTemplate: (template: unknown) => template,
  setApplicationMenu: () => undefined,
};

export const nativeTheme = Object.assign(new EventEmitter(), {
  shouldUseDarkColors: false,
  themeSource: "system",
});

const activeNotifications = new Map<string, Notification>();
let notificationSequence = 0;

export class Notification extends EventEmitter {
  readonly id = `tauri-notification-${++notificationSequence}`;

  static isSupported(): boolean {
    return true;
  }

  constructor(private readonly options: { title: string; body: string }) {
    super();
  }

  show(): void {
    activeNotifications.set(this.id, this);
    transport().emitNotification(this.id, this.options.title, this.options.body);
  }

  close(): void {
    activeNotifications.delete(this.id);
    this.emit("close");
  }
}

export function applyNativeWindowState(state: NativeWindowState): void {
  SyntheticBrowserWindow.getAllWindows()[0]?.applyNativeState(state);
}

export function activateNotification(id?: string): boolean {
  const notification = id
    ? activeNotifications.get(id)
    : [...activeNotifications.values()].at(-1);
  if (!notification) return false;
  notification.emit("click");
  return true;
}

export function inspectTauriShim(): {
  readonly window: NativeWindowState | null;
  readonly activeNotificationIds: readonly string[];
} {
  return {
    window: SyntheticBrowserWindow.getAllWindows()[0]?.snapshot() ?? null,
    activeNotificationIds: [...activeNotifications.keys()],
  };
}

export const contextBridge = undefined;
export const ipcRenderer = undefined;
export const webUtils = undefined;
