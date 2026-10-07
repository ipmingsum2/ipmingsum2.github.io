import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { highlightDocs } from "../highlight-docs.mjs";

test("highlighted examples preserve exact copyable code and distinguish syntax tokens", async () => {
  const source = await readFile(
    new URL("../sources/docs.html", import.meta.url),
    "utf8",
  );
  const before = new JSDOM(source),
    after = new JSDOM(highlightDocs(source));
  try {
    const a = [...before.window.document.querySelectorAll("pre code")];
    const b = [...after.window.document.querySelectorAll("pre code")];
    assert.deepEqual(
      b.map((x) => x.textContent),
      a.map((x) => x.textContent),
    );
    for (const code of b) assert.ok(code.classList.contains("hljs"));
    const example = after.window.document.querySelector("#buttons pre code");
    for (const token of ["keyword", "string", "comment", "title"]) {
      assert.ok(example.querySelector(`.hljs-${token}`), token);
    }
    for (const link of after.window.document.querySelectorAll(
      'nav a[href^="#"]',
    )) {
      assert.ok(after.window.document.getElementById(link.hash.slice(1)));
    }
  } finally {
    before.window.close();
    after.window.close();
  }
});

test("button preview runs local callbacks and dismisses private replies", async () => {
  const html = await readFile(
    new URL("../sources/docs.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  try {
    dom.window.IntersectionObserver = class {
      observe() {}
    };
    dom.window.eval(
      await readFile(new URL("../docs.js", import.meta.url), "utf8"),
    );
    const d = dom.window.document,
      response = d.querySelector(".ephemeral-demo");
    assert.equal(response.hidden, true);
    for (const button of d.querySelectorAll("[data-demo-button]")) {
      button.click();
      assert.equal(response.hidden, false);
      assert.match(
        response.textContent,
        new RegExp(button.dataset.demoButton + " callback"),
      );
      d.querySelector(".dismiss-demo").click();
      assert.equal(response.hidden, true);
    }
  } finally {
    dom.window.close();
  }
});
