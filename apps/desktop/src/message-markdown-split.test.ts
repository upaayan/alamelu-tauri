import assert from "node:assert/strict";
import test from "node:test";
import { splitStreamingMarkdown } from "./message-markdown-split.ts";

test("incomplete first paragraph stays in the tail", () => {
  assert.deepEqual(splitStreamingMarkdown("hello"), { stable: "", tail: "hello" });
});

test("completed paragraphs stay stable", () => {
  assert.deepEqual(splitStreamingMarkdown("para one\n\npara two still going"), {
    stable: "para one\n\n",
    tail: "para two still going",
  });
});

test("an open fence stays in the tail", () => {
  const split = splitStreamingMarkdown("done\n\n```js\nconst x = 1\n");
  assert.equal(split.stable, "done\n\n");
  assert.ok(split.tail.startsWith("```js"));
});

test("a closed fence can be stable", () => {
  const split = splitStreamingMarkdown("```js\nconst x = 1\n```\n\nmore");
  assert.ok(split.stable.includes("```js"));
  assert.equal(split.tail, "more");
});
