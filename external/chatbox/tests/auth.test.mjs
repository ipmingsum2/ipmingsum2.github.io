import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("registration profile errors remain visible and retry does not create another Auth account", async () => {
  const html = await readFile(
    new URL("../../register.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "https://chat.example/external/register.html",
    runScripts: "outside-only",
  });
  const w = dom.window;
  let signups = 0,
    profileAttempts = 0;
  w.CHATBOX_CONFIG = {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public",
  };
  w.ChatIcons = () => "";
  w.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null } }),
        signUp: async () => {
          signups++;
          return { data: { session: { user: { id: "new-user" } } } };
        },
      },
      rpc: async (_name, { action }) => {
        if (action === "profile") {
          profileAttempts++;
          return { error: { message: "Username is already taken" } };
        }
        return { data: {} };
      },
    }),
  };
  try {
    w.eval(
      await readFile(new URL("../../js/chat-core.js", import.meta.url), "utf8"),
    );
    w.eval(
      await readFile(new URL("../../js/chat.js", import.meta.url), "utf8"),
    );
    const d = w.document;
    d.getElementById("email").value = "fake@example.test";
    d.getElementById("password").value = "test-only-password";
    d.getElementById("username").value = "taken";
    const submit = () =>
      d.getElementById("authForm").onsubmit({ preventDefault() {} });
    await submit();
    assert.equal(d.getElementById("authView").hidden, false);
    assert.match(
      d.getElementById("authError").textContent,
      /account was created.*Username is already taken/,
    );
    assert.equal(d.getElementById("email").disabled, true);
    assert.equal(d.getElementById("authSubmit").disabled, false);
    d.getElementById("username").value = "another-name";
    await submit();
    assert.equal(signups, 1);
    assert.equal(profileAttempts, 2);
  } finally {
    w.close();
  }
});
