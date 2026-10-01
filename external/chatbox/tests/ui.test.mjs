import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const pause = () => new Promise((r) => setTimeout(r, 10));
test("custom selects keep form values, keyboard navigation, focus, and modal accessibility", async () => {
  const dom = new JSDOM(
    '<dialog open><form><label>Duration<select name="duration"><option value="1">1 hour</option><option value="24">24 hours</option></select></label></form></dialog>',
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  const w = dom.window,
    d = w.document;
  try {
    w.eval(
      await readFile(new URL("../../js/chat-ui.js", import.meta.url), "utf8"),
    );
    const button = d.querySelector("[role=combobox]");
    button.click();
    assert.equal(
      d.querySelector("[role=listbox]").closest("dialog"),
      d.querySelector("dialog"),
    );
    assert.equal(button.getAttribute("aria-expanded"), "true");
    d.activeElement.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.equal(d.activeElement.textContent, "24 hours");
    d.activeElement.click();
    await pause();
    assert.equal(new w.FormData(d.querySelector("form")).get("duration"), "24");
    assert.equal(button.textContent, "24 hours");
    assert.equal(d.activeElement, button);
    button.click();
    d.activeElement.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(d.querySelector("[role=listbox]"), null);
    assert.equal(button.getAttribute("aria-expanded"), "false");
  } finally {
    w.close();
  }
});
