#!/usr/bin/env node
// CLI over the shared patch core in ../electron/pi-ai-patch.mjs.
// The desktop app applies this automatically on startup; this entry point exists for
// manual use (e.g. patching without launching the app).
//
//   node apps/desktop/scripts/patch-global-pi-ai.mjs --check
//   node apps/desktop/scripts/patch-global-pi-ai.mjs --apply
import { execFileSync } from "node:child_process";
import { applyPiAiPatch, checkPiAiPatch, readPiVersion, resolvePiAiTarget } from "../electron/pi-ai-patch.mjs";

function resolvePiBin() {
  const configured = process.env.PI_GUI_PI_BIN?.trim();
  if (configured) return configured;
  return execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
}

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--apply") {
  console.error("usage: patch-global-pi-ai.mjs --check | --apply");
  process.exit(2);
}

const piBin = resolvePiBin();
const target = resolvePiAiTarget(piBin);
const state = checkPiAiPatch(target);
console.log(`pi:     ${piBin} (v${readPiVersion(piBin)})`);
console.log(`target: ${target}`);
console.log(`state:  ${state}`);

if (mode === "--check") {
  process.exit(state === "drifted" ? 1 : 0);
}

if (state === "patched") {
  console.log("already patched — nothing to do");
  process.exit(0);
}
if (state === "drifted") {
  console.error("REFUSING: installed pi-ai does not match the expected unpatched source.");
  console.error("pi has likely changed this code — re-derive the patch before applying.");
  process.exit(1);
}

applyPiAiPatch(target);
console.log("patched OK (backup written alongside the target as .bak-alpi)");
