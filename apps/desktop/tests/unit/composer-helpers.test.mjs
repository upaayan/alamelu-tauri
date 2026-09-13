import assert from "node:assert/strict";
import test from "node:test";
import {
  clipboardHasPlainText,
  clipboardLooksLikeImage,
  extractAttachableClipboardFiles,
  hasFilesInDataTransfer,
} from "../../src/composer-attachments.ts";
import { fitComposerTextarea } from "../../src/composer-height.ts";

function transfer({ types = [], files = [], items = [] } = {}) {
  return { types, files, items };
}

test("clipboard helpers distinguish image, file, and text", () => {
  assert.equal(clipboardLooksLikeImage(transfer({ types: ["image/png"] })), true);
  assert.equal(clipboardLooksLikeImage(transfer({ types: ["text/plain"] })), false);
  assert.equal(clipboardHasPlainText(transfer({ types: ["text/plain", "image/png"] })), true);
  assert.equal(hasFilesInDataTransfer(transfer({ types: ["Files"] })), true);
  assert.equal(hasFilesInDataTransfer(transfer({ types: ["text/plain"] })), false);

  const png = new File([Uint8Array.from([1])], "shot.png", { type: "image/png" });
  const note = new File([Uint8Array.from([2])], "note.txt", { type: "text/plain" });
  const files = extractAttachableClipboardFiles(transfer({
    types: ["Files"],
    files: [png, note],
    items: [],
  }));
  assert.equal(files.length, 2);
});

test("fitComposerTextarea grows, wraps, and shrinks without collapsing to 0 first", () => {
  const grow = { scrollHeight: 80, clientHeight: 24, style: { height: "24px" } };
  fitComposerTextarea(grow, 220);
  assert.equal(grow.style.height, "80px");
  assert.equal(grow.style.overflowY, "hidden");

  const cap = { scrollHeight: 400, clientHeight: 24, style: { height: "24px" } };
  fitComposerTextarea(cap, 220);
  assert.equal(cap.style.height, "220px");
  assert.equal(cap.style.overflowY, "auto");

  const shrink = { scrollHeight: 24, clientHeight: 80, style: {} };
  const heights = [];
  Object.defineProperty(shrink.style, "height", {
    get() {
      return this._height;
    },
    set(value) {
      heights.push(value);
      this._height = value;
    },
  });
  fitComposerTextarea(shrink, 220);
  assert.deepEqual(heights, ["auto", "24px"]);
  assert.ok(!heights.includes("0px"));
});

test("dispatchNativeAttachments emits captured attachments", async () => {
  const target = new EventTarget();
  globalThis.window = target;
  const { dispatchNativeAttachments, NATIVE_ATTACHMENTS_EVENT } = await import("../../src/tauri-native-attachments.ts");
  const seen = [];
  const listener = (event) => {
    seen.push(event.detail);
  };
  target.addEventListener(NATIVE_ATTACHMENTS_EVENT, listener);
  dispatchNativeAttachments([]);
  dispatchNativeAttachments([{ id: "a", kind: "file", name: "note.txt", mimeType: "text/plain", fsPath: "/tmp/note.txt" }]);
  target.removeEventListener(NATIVE_ATTACHMENTS_EVENT, listener);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].name, "note.txt");
});
