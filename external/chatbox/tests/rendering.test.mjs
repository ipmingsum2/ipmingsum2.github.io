import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
const dom = new JSDOM("<!doctype html>", {
  url: "https://chat.example",
  runScripts: "outside-only",
});
const w = dom.window;
w.marked = marked;
w.DOMPurify = DOMPurify(w);
w.hljs = hljs;
w.eval(
  await readFile(new URL("../../js/chat-core.js", import.meta.url), "utf8"),
);
const c = w.ChatCore;
test("rich embeds render fields and Markdown without executable URLs or HTML", () => {
  const html = c.embeds([
    {
      title: "<script>alert(1)</script>",
      url: "javascript:alert(1)",
      description: "**Safe**",
      author: { name: "Bot" },
      fields: [{ name: "Field", value: "`code`", inline: true }],
      image: { url: "https://example.com/image.png" },
      thumbnail: { url: "javascript:alert(1)" },
      color: 0x5865f2,
    },
  ]);
  const d = new JSDOM(html).window.document;
  assert.equal(
    d.querySelectorAll('script,iframe,[onerror],a[href^="javascript:"]').length,
    0,
  );
  assert.equal(d.querySelectorAll("img").length, 1);
  assert.equal(d.querySelector(".embed-field code").textContent, "code");
  assert.equal(
    d.querySelector(".embed-description strong").textContent,
    "Safe",
  );
});
test("Markdown headings, subtext, bold and inline code render safely", () => {
  const html = c.render(
    "# Title\n## Two\n### Three\n-# small\n\n**bold** *italic* `const x=1`",
  );
  assert.match(html, /<h1>Title/);
  assert.match(html, /<h2>Two/);
  assert.match(html, /<h3>Three/);
  assert.match(html, /class="subtext"/);
  assert.match(html, /<strong>bold/);
  assert.match(html, /<code>const x=1<\/code>/);
});
test("filename fences highlight Luau, JS, TS, C++ and C#", () => {
  for (const [info, lang] of [
    ["file.luau", "lua"],
    ["file.js", "javascript"],
    ["file.ts", "typescript"],
    ["file.cpp", "cpp"],
    ["file.cs", "csharp"],
  ]) {
    assert.equal(c.language(info), lang);
    assert.match(
      c.render("```" + info + "\nconst value = 42;\n```"),
      /code-label/,
    );
  }
  assert.match(c.render("```js\nconst value = 42;\n```"), /hljs-keyword/);
});
test("raw HTML and iframe markup cannot execute", () => {
  const html = c.render(
    '<script>alert(1)</script>\n<iframe src="https://evil.test"></iframe>\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n!iframe src="https://example.com"!',
  );
  const d = new JSDOM(html).window.document;
  assert.equal(d.querySelectorAll("script,iframe,[onerror]").length, 0);
  assert.equal(d.querySelectorAll('a[href^="javascript:"]').length, 0);
});
test("mentions are clickable outside code; names cannot inject HTML", () => {
  const html = c.render(
    "Hi <@user-1> in <#room-1>\n\n`<@user-1>`",
    [{ id: "user-1", username: "<img onerror=x>" }],
    [{ id: "room-1", name: "general" }],
  );
  const d = new JSDOM(html).window.document;
  assert.equal(d.querySelectorAll("button.mention").length, 2);
  assert.equal(d.querySelector("button[data-channel]").textContent, "#general");
  assert.equal(d.querySelectorAll("img").length, 0);
  assert.equal(d.querySelector("code").textContent, "<@user-1>");
});
test("command correction suggests, rather than silently running, close matches", () => {
  assert.equal(c.suggest("/settngs")[0].name, "/settings");
  assert.equal(
    c.suggest("hello @al", [
      { id: "1", username: "alice", display_name: "Alice" },
    ])[0].value,
    "<@1> ",
  );
  assert.equal(c.suggest("hello")[0], undefined);
});
