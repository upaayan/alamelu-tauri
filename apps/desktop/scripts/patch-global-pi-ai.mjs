#!/usr/bin/env node
// Patch the globally installed pi-ai normalizeToolCallId so 40-char truncation
// of composite tool-call ids can no longer collide (Alamelu Pi plan §1.6).
//
//   node apps/desktop/scripts/patch-global-pi-ai.mjs --check   report state
//   node apps/desktop/scripts/patch-global-pi-ai.mjs --apply   patch (writes .bak-alpi backup)
//
// Idempotent via marker; refuses on source drift. Re-run --apply after every `pi update`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MARKER = "alpi-patch:toolcallid-v1";

const COMPOSITE_ORIG = `        if (id.includes("|")) {
            const [callId] = id.split("|");
            // Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
            return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        }`;

const COMPOSITE_PATCHED = `        if (id.includes("|")) {
            const [callId] = id.split("|");
            /* ${MARKER} */
            const sanitized = callId.replace(/[^a-zA-Z0-9_-]/g, "_");
            return sanitized.length > 40 ? sanitized.slice(0, 31) + "_" + __alpiDjb2Hex8(sanitized) : sanitized;
        }`;

const OPENAI_ORIG = `        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 40) : id;`;

const OPENAI_PATCHED = `        if (model.provider === "openai")
            return id.length > 40 ? id.slice(0, 31) + "_" + __alpiDjb2Hex8(id) : id;`;

const HELPER = `
/* ${MARKER} helper (hoisted module-scope function) */
function __alpiDjb2Hex8(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
}
`;

function resolveTarget() {
  const piBin = process.env.PI_GUI_PI_BIN || execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
  const real = fs.realpathSync.native(piBin);
  // real = <pi-coding-agent>/dist/cli.js — package root is two levels up.
  const pkgRoot = path.resolve(path.dirname(real), "..");
  const pkgJson = path.join(pkgRoot, "package.json");
  if (!fs.existsSync(pkgJson) || !JSON.parse(fs.readFileSync(pkgJson, "utf8")).name?.includes("pi-coding-agent")) {
    throw new Error(`Resolved pi root does not look like pi-coding-agent: ${pkgRoot}`);
  }
  const target = path.join(pkgRoot, "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js");
  if (!fs.existsSync(target)) throw new Error(`pi-ai target not found: ${target}`);
  return target;
}

function stateOf(src) {
  if (src.includes(MARKER)) return "patched";
  if (src.includes(COMPOSITE_ORIG) && src.includes(OPENAI_ORIG)) return "unpatched";
  return "drifted";
}

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--apply") {
  console.error("usage: patch-global-pi-ai.mjs --check | --apply");
  process.exit(2);
}

const target = resolveTarget();
const src = fs.readFileSync(target, "utf8");
const state = stateOf(src);
console.log(`target: ${target}`);
console.log(`state:  ${state}`);

if (mode === "--check") process.exit(state === "drifted" ? 1 : 0);

if (state === "patched") {
  console.log("already patched — nothing to do");
  process.exit(0);
}
if (state === "drifted") {
  console.error("REFUSING: installed source does not match the expected unpatched signature.");
  console.error("pi has likely been updated with different code — re-derive the patch before applying.");
  process.exit(1);
}

fs.copyFileSync(target, `${target}.bak-alpi`);
let out = src.replace(COMPOSITE_ORIG, COMPOSITE_PATCHED).replace(OPENAI_ORIG, OPENAI_PATCHED);
const smIdx = out.lastIndexOf("//# sourceMappingURL=");
out = smIdx >= 0 ? out.slice(0, smIdx) + HELPER + "\n" + out.slice(smIdx) : out + HELPER;
fs.writeFileSync(target, out);

const verify = stateOf(fs.readFileSync(target, "utf8"));
if (verify !== "patched") {
  fs.copyFileSync(`${target}.bak-alpi`, target);
  console.error("verification failed after write — restored backup");
  process.exit(1);
}
console.log(`patched OK (backup at ${path.basename(target)}.bak-alpi)`);
