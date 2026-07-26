import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  applyPiAiPatch,
  checkPiAiPatch,
  PATCH_MARKER,
  shouldReapplyPatch,
} from "../../electron/pi-ai-patch.mjs";

// The real installed file is the fixture source, but every test operates on a COPY in
// a temp dir — the global npm tree is never touched by tests.
const REAL_PI_AI = path.join(
  process.env.HOME ?? "",
  ".nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent",
  "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",
);

const workDir = mkdtempSync(path.join(tmpdir(), "pi-ai-patch-"));
after(() => rmSync(workDir, { recursive: true, force: true }));

function freshCopy(name) {
  const dest = path.join(workDir, name);
  copyFileSync(REAL_PI_AI, dest);
  return dest;
}

/** Restores a patched copy back to the shape pi ships, so "unpatched" can be tested. */
function unpatchedCopy(name) {
  const dest = freshCopy(name);
  const src = readFileSync(dest, "utf8");
  if (!src.includes(PATCH_MARKER)) return dest;
  const backup = `${REAL_PI_AI}.bak-alpi`;
  copyFileSync(backup, dest);
  return dest;
}

test("shouldReapplyPatch: same version and already patched is a no-op", () => {
  assert.equal(shouldReapplyPatch("0.80.10", "0.80.10", "patched"), false);
});

test("shouldReapplyPatch: a version change re-checks even when the marker is present", () => {
  assert.equal(shouldReapplyPatch("0.80.10", "0.81.0", "patched"), true);
});

test("shouldReapplyPatch: an unpatched file is always applied", () => {
  assert.equal(shouldReapplyPatch("0.80.10", "0.80.10", "unpatched"), true);
});

test("shouldReapplyPatch: drifted source is never patched blindly", () => {
  assert.equal(shouldReapplyPatch(undefined, "0.81.0", "drifted"), false);
  assert.equal(shouldReapplyPatch("0.80.10", "0.80.10", "drifted"), false);
});

test("checkPiAiPatch reports drift when pi's source no longer matches", () => {
  const target = path.join(workDir, "drifted.js");
  writeFileSync(target, "export function somethingElse() { return 1; }\n", "utf8");
  assert.equal(checkPiAiPatch(target), "drifted");
});

test("applyPiAiPatch refuses to touch a drifted file", () => {
  const target = path.join(workDir, "drifted-apply.js");
  writeFileSync(target, "export function somethingElse() { return 1; }\n", "utf8");
  assert.throws(() => applyPiAiPatch(target), /refusing to patch/i);
});

test("applyPiAiPatch patches an unpatched copy and is idempotent", () => {
  const target = unpatchedCopy("roundtrip.js");
  assert.equal(checkPiAiPatch(target), "unpatched");

  const first = applyPiAiPatch(target);
  assert.equal(first.changed, true);
  assert.equal(checkPiAiPatch(target), "patched");

  const second = applyPiAiPatch(target);
  assert.equal(second.changed, false, "re-applying an already patched file must be a no-op");
  assert.equal(checkPiAiPatch(target), "patched");
});

test("the patched truncation keeps colliding ids distinct and within 40 chars", () => {
  const target = unpatchedCopy("behaviour.js");
  applyPiAiPatch(target);
  const patched = readFileSync(target, "utf8");
  assert.ok(patched.includes("__alpiDjb2Hex8"), "hash helper must be present");

  // Same algorithm the patched file uses, applied to real colliding ids from the
  // 2026-07-24 session that produced the duplicate-id 400.
  const djb2 = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  const normalize = (id) => {
    const sanitized = id.split("|")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    return sanitized.length > 40 ? `${sanitized.slice(0, 31)}_${djb2(sanitized)}` : sanitized;
  };
  const ids = [
    "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-0|fc_a",
    "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-1|fc_b",
    "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-2|fc_c",
  ].map(normalize);

  assert.equal(new Set(ids).size, 3, "sibling tool calls must not collapse to one id");
  for (const id of ids) {
    assert.ok(id.length <= 40, `id must fit the 40 char limit: ${id}`);
    assert.match(id, /^[a-zA-Z0-9_-]+$/, "id must stay wire-legal");
  }
});
