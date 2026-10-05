import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const source = await readFile(
  new URL("../../js/chat-cache.js", import.meta.url),
  "utf8",
);
test("cache deduplicates requests, expires values, and discards in-flight work after logout", async () => {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  try {
    dom.window.eval(source);
    const c = new dom.window.ChatCache(2);
    let count = 0,
      resolve;
    const load = () => {
      count++;
      return new Promise((r) => (resolve = r));
    };
    const one = c.get("private", load),
      two = c.get("private", load);
    await Promise.resolve();
    assert.equal(count, 1);
    c.invalidate();
    resolve("old-user-data");
    await Promise.all([one, two]);
    assert.equal(c.values.size, 0);
    assert.equal(await c.get("private", () => ++count, 10000), 2);
    assert.equal(await c.get("private", () => ++count), 2);
    c.values.get("private").until = 0;
    assert.equal(await c.get("private", () => ++count), 3);
    await c.get("b", () => 1);
    await c.get("c", () => 2);
    assert.equal(c.values.size, 2);
  } finally {
    dom.window.close();
  }
});
const guard = await readFile(
  new URL("../../js/chat-guard.js", import.meta.url),
  "utf8",
);
test("VPN guard waits ten seconds, requires matching digest, and rejects late overrides", async () => {
  for (const bypass of [false, true]) {
    const dom = new JSDOM("", {
        url: "https://ipmingsum2.github.io/external/chat.html",
        runScripts: "outside-only",
      }),
      w = dom.window;
    let timer, delay;
    try {
      w.TextEncoder = TextEncoder;
      w.crypto.subtle = {
        digest: async (_, data) =>
          new Uint8Array(
            Buffer.from(
              data[0] === 65
                ? guard.match(/expectedHash\s*=\s*["']([a-f0-9]+)["']/)[1]
                : "0".repeat(64),
              "hex",
            ),
          ).buffer,
      };
      w.setTimeout = (f, t) => {
        timer = f;
        delay = t;
      };
      w.eval(guard);
      assert.equal(delay, 10000);
      assert.equal(w.document.scripts.length, 0);
      w.dispatchEvent(
        new w.CustomEvent("chatbox:vpn-bypass:7b36a92e", {
          detail: "B".repeat(64),
        }),
      );
      await new Promise((r) => setImmediate(r));
      assert.equal(w.sessionStorage.length, 0);
      if (bypass) {
        w.dispatchEvent(
          new w.CustomEvent("chatbox:vpn-bypass:7b36a92e", {
            detail: "A".repeat(64),
          }),
        );
        await new Promise((r) => setImmediate(r));
      }
      timer();
      assert.equal(w.document.scripts.length, bypass ? 0 : 1);
      if (!bypass) {
        w.dispatchEvent(new w.Event("chatbox:vpn-bypass:7b36a92e"));
        assert.equal(w.sessionStorage.length, 0);
      }
    } finally {
      w.close();
    }
  }
});
