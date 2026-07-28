import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { ComposerAttachment } from "./desktop-state";
import { installTauriBridge } from "./tauri-bridge";
import "./styles.css";

async function main(): Promise<void> {
  await installTauriBridge();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (await invoke<boolean>("native_smoke_enabled")) {
    window.setTimeout(() => {
      void recordSmoke();
    }, 1_500);
  }
}

async function recordSmoke(): Promise<void> {
  const state = await window.piApp?.getState();
  const runtime = state?.runtimeByWorkspace ?? {};
  const initialThemeMode = await window.piApp?.getThemeMode();
  await window.piApp?.setThemeMode("dark");
  const darkTheme = await window.piApp?.getResolvedTheme();
  await window.piApp?.setThemeMode(initialThemeMode ?? "system");
  await window.piApp?.toggleWindowMaximize();
  await window.piApp?.toggleWindowMaximize();

  await window.piApp?.setEnableTransparency(true);
  const nativeTransparency = await invoke<boolean>("native_smoke_transparency");
  await window.piApp?.setEnableTransparency(false);

  const themeEvents: string[] = [];
  const removeThemeListener = window.piApp?.onThemeChanged((theme) => {
    themeEvents.push(theme);
  });
  await invoke("native_smoke_emit_theme", { theme: "light" });
  await waitFor(() => themeEvents.includes("light"), "native theme event");
  removeThemeListener?.();
  const themeEventCountAfterRemoval = themeEvents.length;
  await invoke("native_smoke_emit_theme", { theme: "dark" });
  await new Promise((resolve) => window.setTimeout(resolve, 50));

  await invoke("native_smoke_sync_window", {
    focused: false,
    visible: true,
    minimized: false,
  });
  const backgroundWindowProbe = await invoke<{
    window: { focused: boolean; visible: boolean; minimized: boolean; closed: boolean };
  }>("backend_invoke", {
    channel: "__alamelu_tauri:test-probe",
    args: [],
  });
  await invoke("native_smoke_sync_window", {
    focused: true,
    visible: true,
    minimized: false,
  });

  let removeWorkspaceListener: (() => void) | undefined;
  const workspacePicked = new Promise<string>((resolve) => {
    removeWorkspaceListener = window.piApp?.onWorkspacePicked((workspaceId) => {
      removeWorkspaceListener?.();
      resolve(workspaceId);
    });
  });
  await invoke("native_smoke_open_workspace");
  const nativeWorkspaceId = await withTimeout(workspacePicked, "native open-folder event");

  await window.piApp?.createSession({
    workspaceId: nativeWorkspaceId,
    title: "Packaged Tauri host smoke",
  });
  const nativeAttachment = await invoke<ComposerAttachment>("native_smoke_attachment");
  await window.piApp?.addComposerAttachments([nativeAttachment]);
  const nativeAttachmentState = await window.piApp?.getState();
  const nativeAttachmentAdded = Boolean(
    nativeAttachmentState?.composerAttachments.some(
      (attachment) => attachment.id === nativeAttachment.id,
    ),
  );
  await window.piApp?.removeComposerAttachment(nativeAttachment.id);

  const pastedImageName = "tauri-smoke-paste.png";
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(pngFile(pastedImageName));
  await waitFor(
    () => Boolean(document.querySelector('[data-testid="composer-surface"]')),
    "packaged composer render",
  );
  const pasteTarget = document.querySelector<HTMLElement>(
    '[data-testid="composer-surface"]',
  );
  if (!pasteTarget) throw new Error("Packaged composer paste target is unavailable");
  pasteTarget.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    }),
  );
  await waitForAsync(async () => {
    const latest = await window.piApp?.getState();
    return Boolean(
      latest?.composerAttachments.some(
        (attachment) => attachment.name === pastedImageName,
      ),
    );
  }, "WebKit image paste");
  const pastedState = await window.piApp?.getState();
  const pastedAttachment = pastedState?.composerAttachments.find(
    (attachment) => attachment.name === pastedImageName,
  );
  if (pastedAttachment) {
    await window.piApp?.removeComposerAttachment(pastedAttachment.id);
  }

  await invoke("native_record_smoke", {
    report: {
      ping: await window.piApp?.ping(),
      hasPiApp: Boolean(window.piApp),
      apiMethodCount: Object.keys(window.piApp ?? {}).length,
      bodyText: document.body.innerText.slice(0, 20_000),
      workspaceCount: state?.workspaces.length ?? 0,
      providerCount: Object.values(runtime).reduce(
        (count, entry) => count + entry.providers.length,
        0,
      ),
      modelCount: Object.values(runtime).reduce(
        (count, entry) => count + entry.models.length,
        0,
      ),
      themeRoundTrip: darkTheme,
      nativeThemeEvent: themeEvents[0],
      removedThemeSubscriptionStayedRemoved:
        themeEvents.length === themeEventCountAfterRemoval,
      nativeTransparency,
      backgroundWindowProbe,
      nativeWorkspaceId,
      nativeAttachmentAdded,
      pastedImageAdded: Boolean(pastedAttachment),
      notificationPermission: await window.piApp?.getNotificationPermissionStatus(),
    },
  });
}

function pngFile(name: string): File {
  const encoded =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const decoded = atob(encoded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), 5_000);
    }),
  ]);
}

async function waitForAsync(
  predicate: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(`${label} timed out`);
}

void main().catch((error) => {
  const root = document.getElementById("root");
  if (root) {
    root.textContent = `Alamelu Pi could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
});
