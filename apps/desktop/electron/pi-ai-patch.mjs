// Collision-proof truncation patch for the globally installed pi-ai.
//
// pi-ai's normalizeToolCallId cuts composite tool-call ids to 40 chars, which makes
// parallel calls from one turn collapse into the same id — providers then reject the
// replayed history with `400 Duplicate value for 'tool_call_id'`. This module owns the
// patch: the desktop app applies it automatically on startup, and
// scripts/patch-global-pi-ai.mjs is a thin CLI over the same functions.
//
// `pi update` reinstalls pi-ai and erases the patch, which is why re-application is
// automatic rather than a note in a README.
import fs from "node:fs";
import path from "node:path";

export const PATCH_MARKER = "alpi-patch:toolcallid-v1";

const COMPOSITE_ORIG = `        if (id.includes("|")) {
            const [callId] = id.split("|");
            // Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
            return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        }`;

const COMPOSITE_PATCHED = `        if (id.includes("|")) {
            const [callId] = id.split("|");
            /* ${PATCH_MARKER} */
            const sanitized = callId.replace(/[^a-zA-Z0-9_-]/g, "_");
            return sanitized.length > 40 ? sanitized.slice(0, 31) + "_" + __alpiDjb2Hex8(sanitized) : sanitized;
        }`;

const OPENAI_ORIG = `        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 40) : id;`;

const OPENAI_PATCHED = `        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 31) + "_" + __alpiDjb2Hex8(id) : id;`;

const HELPER = `
/* ${PATCH_MARKER} helper (hoisted module-scope function) */
function __alpiDjb2Hex8(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
}
`;

/** Package root of the installed pi, derived from its resolved bin path. */
export function resolvePiRoot(piBin) {
  const real = fs.realpathSync.native(piBin);
  return path.resolve(path.dirname(real), "..");
}

/** Absolute path of the pi-ai file this patch edits. Throws if pi looks wrong. */
export function resolvePiAiTarget(piBin) {
  const root = resolvePiRoot(piBin);
  const pkgJson = path.join(root, "package.json");
  if (!fs.existsSync(pkgJson) || !String(JSON.parse(fs.readFileSync(pkgJson, "utf8")).name ?? "").includes("pi-coding-agent")) {
    throw new Error(`Resolved pi root does not look like pi-coding-agent: ${root}`);
  }
  const target = path.join(root, "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js");
  if (!fs.existsSync(target)) throw new Error(`pi-ai target not found: ${target}`);
  return target;
}

/** Installed pi version, read from package.json (no subprocess). */
export function readPiVersion(piBin) {
  const pkgJson = path.join(resolvePiRoot(piBin), "package.json");
  return String(JSON.parse(fs.readFileSync(pkgJson, "utf8")).version ?? "");
}

/** "patched" | "unpatched" | "drifted" — drifted means pi's source no longer matches. */
export function checkPiAiPatch(target) {
  const src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_MARKER)) return "patched";
  if (src.includes(COMPOSITE_ORIG) && src.includes(OPENAI_ORIG)) return "unpatched";
  return "drifted";
}

/**
 * Whether the patch should be (re-)applied. Drift is never patched blindly; a version
 * change re-checks even when the marker looks present, so a reinstall cannot slip by.
 */
export function shouldReapplyPatch(storedVersion, currentVersion, state) {
  if (state === "drifted") return false;
  if (state === "unpatched") return true;
  return storedVersion !== currentVersion;
}

/** Applies the patch in place. No-op when already patched; refuses on drift. */
export function applyPiAiPatch(target) {
  const src = fs.readFileSync(target, "utf8");
  const state = checkPiAiPatch(target);
  if (state === "patched") return { changed: false, state };
  if (state === "drifted") {
    throw new Error("Installed pi-ai does not match the expected unpatched source; refusing to patch.");
  }

  fs.copyFileSync(target, `${target}.bak-alpi`);
  let out = src.replace(COMPOSITE_ORIG, COMPOSITE_PATCHED).replace(OPENAI_ORIG, OPENAI_PATCHED);
  const smIdx = out.lastIndexOf("//# sourceMappingURL=");
  out = smIdx >= 0 ? out.slice(0, smIdx) + HELPER + "\n" + out.slice(smIdx) : out + HELPER;
  fs.writeFileSync(target, out);

  if (checkPiAiPatch(target) !== "patched") {
    fs.copyFileSync(`${target}.bak-alpi`, target);
    throw new Error("Patch verification failed after write; restored the backup.");
  }
  return { changed: true, state: "patched" };
}
