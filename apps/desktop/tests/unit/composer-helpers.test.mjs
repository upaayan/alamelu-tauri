import assert from "node:assert/strict";
import test from "node:test";
import {
  clipboardHasPlainText,
  clipboardLooksLikeImage,
  extractAttachableClipboardFiles,
  hasFilesInDataTransfer,
} from "../../src/composer-attachments.ts";
import { fitComposerTextarea } from "../../src/composer-height.ts";
import { composerHistoryEntries, stepComposerHistory } from "../../src/composer-history.ts";

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

function message(role, text, id = text) {
  return { kind: "message", role, text, id, createdAt: "2026-11-07T00:00:00.000Z" };
}

test("composer history lists only the user's own non-blank messages, oldest first", () => {
  const transcript = [
    message("user", "first"),
    message("assistant", "answer one"),
    { kind: "tool", id: "t1", callId: "c1", toolName: "bash", status: "success", label: "ls", createdAt: "2026-11-07T00:00:00.000Z" },
    message("user", "   ", "image-only"),
    message("compactionSummary", "summary"),
    message("user", "second"),
  ];
  assert.deepEqual(composerHistoryEntries(transcript), ["first", "second"]);
  assert.deepEqual(composerHistoryEntries([]), []);
});

test("composer history steps like a terminal and leaves other keys alone", () => {
  const history = ["first", "second", "third"];
  const base = { hasAttachments: false, history, sessionKey: "w:s" };
  const step = (key, draft, state) => stepComposerHistory({ ...base, key, draft, state });

  // Up from an empty box brings back the newest message.
  const up1 = step("ArrowUp", "", undefined);
  assert.equal(up1.draft, "third");
  // More Ups go older and stop at the oldest.
  const up2 = step("ArrowUp", up1.draft, up1.state);
  assert.equal(up2.draft, "second");
  const up3 = step("ArrowUp", up2.draft, up2.state);
  assert.equal(up3.draft, "first");
  const up4 = step("ArrowUp", up3.draft, up3.state);
  assert.equal(up4.draft, "first");
  assert.equal(up4.state.index, 0);
  // Down goes newer; past the newest it empties the box and ends recall.
  const down1 = step("ArrowDown", up4.draft, up4.state);
  assert.equal(down1.draft, "second");
  const down2 = step("ArrowDown", down1.draft, down1.state);
  assert.equal(down2.draft, "third");
  const down3 = step("ArrowDown", down2.draft, down2.state);
  assert.deepEqual(down3, { draft: "", state: undefined });

  // Typed text and Down without recall are left alone.
  assert.equal(step("ArrowUp", "typed text", undefined), undefined);
  assert.equal(step("ArrowDown", "", undefined), undefined);
  // Attachments, or no history, block the start.
  assert.equal(stepComposerHistory({ ...base, key: "ArrowUp", draft: "", state: undefined, hasAttachments: true }), undefined);
  assert.equal(stepComposerHistory({ ...base, key: "ArrowUp", draft: "", state: undefined, history: [] }), undefined);
  // Editing the recalled text ends recall, so the arrows move the cursor again.
  assert.equal(step("ArrowUp", "third, edited", up1.state), undefined);
  // A different thread ends recall; an empty box there starts from its own newest message.
  assert.equal(stepComposerHistory({ ...base, key: "ArrowUp", draft: "third", state: up1.state, sessionKey: "w:other" }), undefined);
  assert.equal(stepComposerHistory({ ...base, key: "ArrowUp", draft: "", state: up1.state, sessionKey: "w:other", history: ["elsewhere"] }).draft, "elsewhere");
});
