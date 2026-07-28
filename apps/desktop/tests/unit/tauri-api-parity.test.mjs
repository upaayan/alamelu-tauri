import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parse(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

test("Tauri bridge exposes every PiDesktopApi property", () => {
  const ipcSource = parse(path.join(desktopDir, "src", "ipc.ts"));
  const apiInterface = ipcSource.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === "PiDesktopApi",
  );
  assert.ok(apiInterface, "PiDesktopApi interface not found");
  const expected = apiInterface.members
    .map((member) => member.name)
    .filter(Boolean)
    .map((name) => name.text)
    .sort();

  const bridgeSource = parse(path.join(desktopDir, "src", "tauri-bridge.ts"));
  let apiObject;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "api" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      apiObject = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(bridgeSource);
  assert.ok(apiObject, "Tauri api object not found");
  const actual = apiObject.properties
    .map((property) => property.name)
    .filter(Boolean)
    .map((name) => name.text)
    .sort();

  assert.deepEqual(actual, expected);
});
