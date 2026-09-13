import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { ComposerAttachment } from "./desktop-state";
import { installTauriBridge } from "./tauri-bridge";
import { dispatchNativeAttachments } from "./tauri-native-attachments";
import "./styles.css";

async function installNativeFileDrop(): Promise<void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") {
      return;
    }
    const paths = event.payload.paths ?? [];
    if (paths.length === 0) {
      return;
    }
    const attachments = await invoke<ComposerAttachment[]>("native_attachments_from_paths", { paths });
    dispatchNativeAttachments(attachments);
  });
}

async function main(): Promise<void> {
  await installTauriBridge();
  await installNativeFileDrop();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (await invoke<boolean>("native_smoke_enabled")) {
    window.setTimeout(() => {
      void recordSmoke().catch((error) => invoke("native_record_smoke", {
        report: { error: error instanceof Error ? error.message : String(error) },
      }));
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

  const droppedPaths = nativeAttachment.kind === "file" && "fsPath" in nativeAttachment
    ? [String(nativeAttachment.fsPath)]
    : [];
  const droppedAttachments = droppedPaths.length > 0
    ? await invoke<ComposerAttachment[]>("native_attachments_from_paths", { paths: droppedPaths })
    : [];
  if (droppedAttachments[0]) {
    await window.piApp?.addComposerAttachments(droppedAttachments);
  }
  const droppedState = await window.piApp?.getState();
  const droppedFromPaths = Boolean(
    droppedAttachments[0]
    && droppedState?.composerAttachments.some((attachment) => attachment.id === droppedAttachments[0]?.id),
  );
  if (droppedAttachments[0]) {
    await window.piApp?.removeComposerAttachment(droppedAttachments[0].id);
  }

  const display = await inspectApprovedDisplay(nativeWorkspaceId);
  await invoke("native_record_smoke", {
    report: {
      display,
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
      droppedFromPaths,
      notificationPermission: await window.piApp?.getNotificationPermissionStatus(),
    },
  });
}

async function inspectApprovedDisplay(workspaceId: string) {
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
  const brand = () => button(".sidebar__brand");
  const titleCenterError = () => {
    const r = document.querySelector(".topbar__title")!.getBoundingClientRect();
    return Math.abs(r.x + r.width / 2 - window.innerWidth / 2);
  };
  const navigationInitiallyCollapsed = brand().getAttribute("aria-expanded") === "false";
  brand().click();
  await waitFor(() => document.querySelectorAll(".sidebar__nav-item").length === 3, "brand navigation");
  const navigation = [...document.querySelectorAll(".sidebar__nav-item")].map((el) => el.textContent?.trim());
  brand().click();
  await waitFor(() => !document.querySelector(".sidebar__nav"), "collapse brand navigation");

  // Seed only this smoke's disposable workspace; exercise existing per-group overflow.
  for (let i = 1; i <= 4; i++) await window.piApp?.createSession({ workspaceId, title: `Display smoke ${i}` });
  const state = await window.piApp!.getState();
  const name = state.workspaces.find((w) => w.id === workspaceId)!.name;
  const repo = () => [...document.querySelectorAll<HTMLElement>(".workspace-group")]
    .find((el) => el.querySelector(".workspace-row__name")?.textContent === name)!;
  await waitFor(() => Boolean(repo()), "smoke repo group");
  if (!repo().querySelector(".session-list")) repo().querySelector<HTMLButtonElement>(".workspace-row__select")!.click();
  await waitFor(() => repo().querySelectorAll(".session-row").length === 4, "four visible threads");
  repo().querySelector<HTMLButtonElement>(".sidebar-show-more")!.click();
  await waitFor(() => repo().querySelectorAll(".session-row").length === 5, "show more");
  repo().querySelector<HTMLButtonElement>(".sidebar-show-more")!.click();
  await waitFor(() => repo().querySelectorAll(".session-row").length === 4, "show less");
  repo().querySelector<HTMLButtonElement>(".workspace-row__new")!.click();
  await waitFor(() => document.querySelector<HTMLSelectElement>(".new-thread__workspace")?.value === workspaceId, "repo-specific draft").catch(() => {
    const picker = document.querySelector<HTMLSelectElement>(".new-thread__workspace");
    throw new Error(`Repo draft requested=${workspaceId}, actual=${picker?.value}, options=${[...(picker?.options ?? [])].map((option) => option.value).join(",")}, title=${document.querySelector(".topbar__title")?.textContent}`);
  });
  const draftTitle = document.querySelector(".topbar__session")?.textContent;
  const pickerTail = [...document.querySelectorAll(".new-thread__workspace option")].slice(-2).map((el) => el.textContent?.trim());
  const plusCenters = [...document.querySelectorAll(".sidebar__new, .workspace-row__new")].map((el) => {
    const r = el.getBoundingClientRect(); return r.x + r.width / 2;
  });
  const expandedTitleError = titleCenterError();
  button('[data-testid="sidebar-toggle"]').click();
  await waitFor(() => !document.querySelector(".sidebar"), "hide sidebar");
  const collapsedTitleError = titleCenterError();
  button('[aria-label="Search chats"]').click();
  await waitFor(() => Boolean(document.querySelector('.search-panel')), "search with hidden sidebar");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await waitFor(() => !document.querySelector(".search-panel"), "close search");
  button('[data-testid="sidebar-toggle"]').click();
  await waitFor(() => Boolean(document.querySelector(".sidebar")), "show sidebar");
  button('[aria-label="Show recent activity"]').click();
  await waitFor(() => Boolean(document.querySelector(".sidebar-timeline")), "recent activity");
  button('[aria-label="Show projects"]').click();
  await waitFor(() => Boolean(document.querySelector(".workspace-group")), "restore repo groups");
  return {
    navigationInitiallyCollapsed, navigation, draftTitle, pickerTail,
    fourThreadOverflow: true, searchWhileCollapsed: true, recentActivity: true,
    plusAligned: plusCenters.every((x) => Math.abs(x - plusCenters[0]!) <= 1),
    expandedTitleError, collapsedTitleError,
    othersLast: [...document.querySelectorAll(".workspace-row__name")].at(-1)?.textContent === "Others",
    noThreadsRows: ![...document.querySelectorAll(".sidebar button, .sidebar .section__head")].some((el) => el.textContent?.trim() === "Threads"),
    noBrandChevron: !brand().querySelector("svg"),
    noFolderTile: !document.querySelector(".workspace-row__icon-folder"),
    brandListGapPx: Number.parseFloat(getComputedStyle(document.querySelector(".sidebar__section")!).paddingTop),
    attachTitle: document.querySelector(".composer__attach")?.getAttribute("title") === "Attach",
  };
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
