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

test("verification yields to the provider challenge and restores settings, focus and form values", async () => {
  const dom = new JSDOM(
      '<body><main id="app"><button id="start">Verify</button></main><dialog open><input value="Unsaved nickname"></dialog><div id="provider"><iframe src="https://newassets.hcaptcha.com/challenge"></iframe></div></body>',
      { runScripts: "outside-only" },
    ),
    w = dom.window;
  let callbacks;
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.hcaptcha = {
    render: (_element, options) => {
      callbacks = options;
      return 7;
    },
    remove: () => {},
    reset: () => {},
  };
  try {
    w.eval(
      await readFile(
        new URL("../../js/chat-captcha.js", import.meta.url),
        "utf8",
      ),
    );
    const d = w.document,
      parent = d.querySelector("dialog"),
      start = d.getElementById("start");
    start.focus();
    const pending = w.ChatCaptcha.request("Verify this moderation action");
    await Promise.resolve();
    const overlay = d.querySelector(".captcha-overlay");
    assert.equal(parent.open, false);
    assert.equal(d.getElementById("app").inert, true);
    assert.notEqual(d.getElementById("provider").inert, true);
    assert.equal(d.querySelector(".captcha-card").tagName, "SECTION");
    assert.equal(
      d.querySelector(".captcha-card").getAttribute("role"),
      "dialog",
    );
    callbacks["open-callback"]();
    assert.equal(overlay.classList.contains("is-challenging"), true);
    callbacks["close-callback"]();
    assert.equal(overlay.classList.contains("is-challenging"), false);
    callbacks["open-callback"]();
    callbacks["chalexpired-callback"]();
    assert.equal(overlay.classList.contains("is-challenging"), false);
    assert.match(d.querySelector(".captcha-note").textContent, /expired/);
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    await assert.rejects(pending, /cancelled/);
    assert.equal(parent.open, true);
    assert.equal(parent.querySelector("input").value, "Unsaved nickname");
    assert.notEqual(d.getElementById("app").inert, true);
    assert.equal(d.activeElement, start);
    assert.equal(d.querySelector(".captcha-overlay"), null);
  } finally {
    w.close();
  }
});
