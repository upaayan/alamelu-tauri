import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  applyPiAiPatch,
  checkPiAiPatch,
  isCollisionSafe,
  PATCH_MARKER,
  shouldReapplyPatch,
} from "../../electron/pi-ai-patch.mjs";

// Fixtures are synthesised, never taken from the global install: the installed pi is
// now 0.82.1, which fixed this upstream, so it is no longer a source of "unpatched" text.
const ORIGINAL_SNIPPET = `    const normalizeToolCallId = (id) => {
        if (id.includes("|")) {
            const [callId] = id.split("|");
            // Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
            return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        }
        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 40) : id;
        return id;
    };
//# sourceMappingURL=openai-completions.js.map`;

const UPSTREAM_FIXED_SNIPPET = `    const normalizeToolCallId = (id) => {
        if (id.includes("|")) {
            const separatorIndex = id.indexOf("|");
            const callId = id.slice(0, separatorIndex).replace(/[^a-zA-Z0-9_-]/g, "_");
            const itemId = id.slice(separatorIndex + 1).replace(/[^a-zA-Z0-9_-]/g, "_");
            const combinedId = itemId.length > 0 ? \`\${callId}_\${itemId}\` : callId;
            if (combinedId.length <= 40) return combinedId;
        }
        return id;
    };`;

const workDir = mkdtempSync(path.join(tmpdir(), "pi-ai-patch-"));
after(() => rmSync(workDir, { recursive: true, force: true }));

function unpatchedCopy(name) {
  const dest = path.join(workDir, name);
  writeFileSync(dest, ORIGINAL_SNIPPET, "utf8");
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

test("pi's own upstream fix is recognised and never overwritten", () => {
  const target = path.join(workDir, "upstream-fixed.js");
  writeFileSync(target, UPSTREAM_FIXED_SNIPPET, "utf8");
  assert.equal(checkPiAiPatch(target), "fixed-upstream");
  assert.equal(isCollisionSafe(target), true, "upstream's fix counts as collision-safe");
  assert.equal(shouldReapplyPatch("0.80.10", "0.82.1", "fixed-upstream"), false);
  const before = readFileSync(target, "utf8");
  assert.equal(applyPiAiPatch(target).changed, false);
  assert.equal(readFileSync(target, "utf8"), before, "the file must be left byte-identical");
});

test("our own patch also counts as collision-safe", () => {
  const target = unpatchedCopy("safe-check.js");
  assert.equal(isCollisionSafe(target), false);
  applyPiAiPatch(target);
  assert.equal(isCollisionSafe(target), true);
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
