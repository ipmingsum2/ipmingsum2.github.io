import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("CAPTCHA tokens are not shared and cancelling or expiry allows a fresh challenge", async () => {
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only" }),
    w = dom.window;
  let callbacks,
    removed = 0,
    resets = 0;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.hcaptcha = {
    render: (_element, options) => {
      callbacks = options;
      return 42;
    },
    remove: () => removed++,
    reset: () => resets++,
  };
  try {
    w.eval(
      await readFile(
        new URL("../../js/chat-captcha.js", import.meta.url),
        "utf8",
      ),
    );
    const first = w.ChatCaptcha.request("Verify deletion");
    await Promise.resolve();
    await assert.rejects(w.ChatCaptcha.request(), /current verification/);
    callbacks["expired-callback"]();
    assert.equal(resets, 1);
    assert.match(w.document.body.textContent, /expired/);
    callbacks.callback("single-use-token");
    assert.equal(await first, "single-use-token");
    assert.equal(removed, 1);
    assert.equal(w.document.querySelector("dialog"), null);
    const cancelled = w.ChatCaptcha.request();
    await Promise.resolve();
    w.document.querySelector("button").click();
    await assert.rejects(cancelled, /cancelled/);
    const next = w.ChatCaptcha.request();
    await Promise.resolve();
    callbacks.callback("different-token");
    assert.equal(await next, "different-token");
  } finally {
    w.close();
  }
});
