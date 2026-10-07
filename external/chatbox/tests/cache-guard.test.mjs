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
test("VPN guard activates at midnight Hong Kong on October 20 and ignores old overrides", () => {
  const dom = new JSDOM('', {url:'https://ipmingsum2.github.io/external/chat.html', runScripts:'outside-only'});
  const w=dom.window;
  try {
    let now=Date.parse('2026-10-19T15:59:59Z'), timer, delay;
    w.Date.now=()=>now;
    w.setTimeout=(fn, ms)=>{timer=fn;delay=ms;};
    w.sessionStorage.setItem('chatbox:vpn-bypass:7b36a92e','1');
    w.eval(guard);
    assert.equal(w.document.scripts.length,0);
    assert.equal(delay,1000);
    now=Date.parse('2026-10-19T16:00:00Z');
    timer();
    assert.equal(w.document.scripts.length,1);
    assert.match(w.document.scripts[0].src,/anti-vpn\.js$/);
  } finally {w.close();}
});
