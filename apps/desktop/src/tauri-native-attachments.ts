import type { ComposerAttachment, ComposerImageAttachment } from "./desktop-state";

export const NATIVE_ATTACHMENTS_EVENT = "alamelu-native-attachments";

export async function requestNativeClipboardImage(): Promise<ComposerImageAttachment | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ComposerImageAttachment | null>("native_read_clipboard_image");
  } catch {
    return null;
  }
}

export async function requestNativeClipboardFiles(): Promise<ComposerAttachment[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<ComposerAttachment[]>("native_read_clipboard_files")) ?? [];
  } catch {
    return [];
  }
}

export async function requestNativePickedAttachments(): Promise<ComposerAttachment[] | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<ComposerAttachment[]>("native_pick_attachments")) ?? [];
  } catch {
    return null;
  }
}

export function dispatchNativeAttachments(attachments: readonly ComposerAttachment[]): void {
  if (attachments.length === 0) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(NATIVE_ATTACHMENTS_EVENT, { detail: attachments }),
  );
}
