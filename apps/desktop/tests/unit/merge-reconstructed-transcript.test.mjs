import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import ts from "typescript";

const sourcePath = path.resolve("apps/desktop/electron/transcript-merge.ts");
const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
  fileName: sourcePath,
}).outputText;
// Written inside the repo so the transpiled module can resolve workspace packages.
const dir = mkdtempSync(path.resolve("apps/desktop/.merge-transcript-"));
const modulePath = path.join(dir, "transcript-merge.mjs");
writeFileSync(modulePath, transpiled, "utf8");
after(() => rmSync(dir, { recursive: true, force: true }));

const { mergeReconstructedTranscript } = await import(path.toNamespacedPath(modulePath));

const msg = (role, text, createdAt, id = `${role}-${text}`) => ({ kind: "message", role, text, createdAt, id });
const tool = (callId, createdAt) => ({ kind: "tool", id: callId, callId, toolName: "read", status: "success", label: "read", createdAt });
const activity = (label, createdAt, extra = {}) => ({ kind: "activity", id: `a-${label}`, label, createdAt, ...extra });
const summary = (label, createdAt) => ({ kind: "summary", id: `s-${label}`, label, createdAt, presentation: "divider" });

test("an empty reconstruction never replaces the cache", () => {
  const cached = [msg("user", "hello", "2026-01-01T00:00:00Z")];
  assert.deepEqual(mergeReconstructedTranscript(cached, []), cached);
});

test("live-only activity and summary rows survive the merge", () => {
  const cached = [
    msg("user", "hello", "2026-01-01T00:00:00Z"),
    activity("Resumed session", "2026-01-01T00:00:01Z"),
    summary("Worked for 3s", "2026-01-01T00:00:05Z"),
  ];
  const rebuilt = [msg("user", "hello", "2026-01-01T00:00:00Z"), tool("call-1", "2026-01-01T00:00:02Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  assert.ok(merged.some((i) => i.kind === "activity" && i.label === "Resumed session"));
  assert.ok(merged.some((i) => i.kind === "summary" && i.label === "Worked for 3s"));
  assert.ok(merged.some((i) => i.kind === "tool" && i.callId === "call-1"), "the reconstructed tool row is gained");
});

test("a cached message the reconstruction lacks is never dropped", () => {
  const cached = [msg("user", "kept", "2026-01-01T00:00:00Z"), msg("assistant", "also kept", "2026-01-01T00:00:01Z")];
  const rebuilt = [msg("user", "kept", "2026-01-01T00:00:00Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  assert.equal(merged.filter((i) => i.kind === "message").length, 2);
  assert.ok(merged.some((i) => i.kind === "message" && i.text === "also kept"));
});

test("messages present in both are not duplicated", () => {
  const cached = [msg("user", "same", "2026-01-01T00:00:00Z")];
  const rebuilt = [msg("user", "same", "2026-01-01T00:00:00Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  assert.equal(merged.filter((i) => i.kind === "message" && i.text === "same").length, 1);
});

test("a cached tool row the reconstruction lacks is kept; shared ones are not duplicated", () => {
  const cached = [tool("call-old", "2026-01-01T00:00:00Z"), tool("call-shared", "2026-01-01T00:00:01Z")];
  const rebuilt = [tool("call-shared", "2026-01-01T00:00:01Z"), tool("call-new", "2026-01-01T00:00:02Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  const ids = merged.filter((i) => i.kind === "tool").map((i) => i.callId).sort();
  assert.deepEqual(ids, ["call-new", "call-old", "call-shared"]);
});

test("a pending activity row is never carried through a merge", () => {
  const cached = [activity("Working…", "2026-01-01T00:00:03Z", { pending: true }), activity("Stopped", "2026-01-01T00:00:04Z")];
  const rebuilt = [msg("user", "hi", "2026-01-01T00:00:00Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  assert.equal(merged.some((i) => i.kind === "activity" && i.pending), false);
  assert.ok(merged.some((i) => i.kind === "activity" && i.label === "Stopped"));
});

test("the merged result is ordered by timestamp", () => {
  const cached = [activity("later marker", "2026-01-01T00:00:09Z")];
  const rebuilt = [msg("user", "first", "2026-01-01T00:00:01Z"), msg("assistant", "second", "2026-01-01T00:00:05Z")];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  const times = merged.map((i) => Date.parse(i.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("nothing is lost overall: every cached row is represented or superseded", () => {
  const cached = [
    msg("user", "q", "2026-01-01T00:00:00Z"),
    activity("Resumed session", "2026-01-01T00:00:01Z"),
    tool("call-a", "2026-01-01T00:00:02Z"),
    msg("assistant", "a", "2026-01-01T00:00:03Z"),
    summary("Worked for 1s", "2026-01-01T00:00:04Z"),
  ];
  const rebuilt = [
    msg("user", "q", "2026-01-01T00:00:00Z"),
    tool("call-a", "2026-01-01T00:00:02Z"),
    tool("call-b", "2026-01-01T00:00:02Z"),
    msg("assistant", "a", "2026-01-01T00:00:03Z"),
  ];
  const merged = mergeReconstructedTranscript(cached, rebuilt);
  for (const item of cached) {
    const present =
      item.kind === "message"
        ? merged.some((m) => m.kind === "message" && m.role === item.role && m.text === item.text)
        : merged.some((m) => m.kind === item.kind && (m.callId ?? m.label) === (item.callId ?? item.label));
    assert.ok(present, `cached ${item.kind} row was lost: ${item.label ?? item.text ?? item.callId}`);
  }
  assert.ok(merged.some((i) => i.kind === "tool" && i.callId === "call-b"), "and the new tool row is gained");
});
