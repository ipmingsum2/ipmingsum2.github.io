import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const pause = () => new Promise((r) => setTimeout(r, 10));
test("bot buttons escape labels and forms submit privately with required field limits", async () => {
  const dom = new JSDOM('<main></main><div id="modal"></div>', {
      runScripts: "outside-only",
    }),
    w = dom.window,
    d = w.document;
  try {
    const esc = (s) =>
      String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;");
    w.ChatCore = {
      esc,
      https: (s) => (s?.startsWith("https://") ? s : null),
      render: esc,
      embeds: () => "",
    };
    w.eval(
      await readFile(
        new URL("../../js/chat-interactions.js", import.meta.url),
        "utf8",
      ),
    );
    const calls = [],
      errors = [];
    const api = w.ChatInteractions({
      state: { me: { id: "alice" }, room: "lobby", profiles: [], channels: [] },
      profile: () => ({ display_name: "App" }),
      toast: () => {},
      safe: (fn) => fn().catch((e) => errors.push(e)),
      modal: (title, html) => {
        d.getElementById("modal").innerHTML = html;
      },
      closeModal: () => {
        d.getElementById("modal").innerHTML = "";
      },
      rpc: async (op, p) => {
        calls.push({ op, p });
        if (op === "button") return { id: "ticket", bot_id: "bot" };
        if (op === "submit") return { id: "child", bot_id: "bot" };
        return {
          response:
            p.id === "ticket"
              ? {
                  type: "modal",
                  modal: {
                    title: "Form",
                    fields: [
                      {
                        custom_id: "reason",
                        label: "Reason",
                        required: true,
                        max_length: 20,
                        style: 2,
                      },
                    ],
                  },
                }
              : { type: "message", text: "Private reply" },
        };
      },
    });
    d.querySelector("main").innerHTML = api.render({
      id: "m",
      components: [
        {
          components: [
            {
              label: "<img src=x onerror=alert(1)>",
              style: 1,
              custom_id: "apply",
            },
          ],
        },
      ],
    });
    assert.equal(d.querySelector("img"), null);
    d.querySelector("button").click();
    await pause();
    const field = d.querySelector("textarea");
    assert.equal(field.required, true);
    assert.equal(field.maxLength, 20);
    field.value = "my reason";
    d.querySelector("form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert.equal(
      calls.find((c) => c.op === "submit").p.fields.reason,
      "my reason",
    );
    assert.match(d.getElementById("modal").textContent, /Private reply/);
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});
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
