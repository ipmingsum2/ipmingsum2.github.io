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
  w.ChatCaptcha = {request: async () => "test-captcha-token"};
  w.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null } }),
        signUp: async (input) => {
          assert.equal(input.options.captchaToken, "test-captcha-token");
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

test("settings requests a reset for the signed-in email and displays provider failures", async () => {
  const html = await readFile(
    new URL("../../chat.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "https://ipmingsum2.github.io/external/chat.html",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const user = {
    id: "00000000-0000-4000-8000-000000000002",
    email: "member@example.test",
  };
  const profile = {
    ...user,
    username: "member",
    display_name: "Member",
    roles: [],
    banner_color: "#5865f2",
  };
  let requested;
  w.CHATBOX_CONFIG = {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public",
  };
  w.ChatIcons = () => "";
  w.ChatCaptcha = {request: async () => "test-captcha-token"};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: { user } } }),
        resetPasswordForEmail: async (email, options) => {
          requested = { email, options };
          return { error: { message: "Email rate limit exceeded" } };
        },
      },
      rpc: async (_name, args) => ({
        data: args?.action === "bootstrap" ? { profile, root: false } : {},
      }),
      from: (table) => {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          order() {
            return q;
          },
          range() {
            return q;
          },
          then(done) {
            return Promise.resolve({
              data: table === "cb_profiles" ? [profile] : [],
            }).then(done);
          },
        };
        return q;
      },
      channel: () => {
        const c = {
          on() {
            return c;
          },
          subscribe() {
            return c;
          },
        };
        return c;
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
    await new Promise((r) => setTimeout(r, 30));
    w.document.getElementById("settingsButton").click();
    await new Promise((r) => setTimeout(r, 10));
    w.document.querySelector('[data-settings="password"]').click();
    await new Promise((r) => setTimeout(r, 10));
    await w.document.getElementById("sendPasswordReset").onclick();
    assert.equal(requested.email, user.email);
    assert.equal(
      requested.options.redirectTo,
      "https://ipmingsum2.github.io/external/chat.html",
    );
    assert.equal(
      w.document.getElementById("passwordResetStatus").textContent,
      "Email rate limit exceeded",
    );
    assert.equal(
      w.document.getElementById("sendPasswordReset").disabled,
      false,
    );
  } finally {
    w.close();
  }
});
