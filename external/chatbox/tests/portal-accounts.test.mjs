import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";
const icons = await readFile(
  new URL("../../js/chat-icons.js", import.meta.url),
  "utf8",
);
const pause = () => new Promise((r) => setTimeout(r, 10));
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

test("account switcher keeps separate sessions, never stores passwords and clears the page on switch", async () => {
  const dom = new JSDOM('<div id="modal"></div>', {
      url: "https://chat.example",
    }),
    d = dom.window.document;
  const sessions = (id) => ({
    user: {
      id,
      email: id + "@example.test",
      user_metadata: { display_name: id },
    },
    access_token: "access-" + id,
    refresh_token: "refresh-" + id,
    expires_at: 123,
  });
  const storage = new Map(),
    calls = [];
  let subscriber,
    current = sessions("alice"),
    reloads = 0;
  const client = {
    auth: {
      onAuthStateChange: (fn) => (subscriber = fn),
      getSession: async () => ({ data: { session: current } }),
      setSession: async (tokens) => {
        calls.push(tokens);
        current = sessions(tokens.access_token.slice(7));
        return { data: { session: current } };
      },
    },
  };
  const context = {
    window: {
      supabase: {
        createClient: () => ({
          auth: {
            signInWithPassword: async (input) => {
              calls.push(input);
              return { data: { session: sessions("carol") } };
            },
            stopAutoRefresh() {},
          },
        }),
      },
    },
    document: d,
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
    },
    URL,
    FormData: dom.window.FormData,
    location: { reload: () => reloads++ },
  };
  context.window.ChatCaptcha = { request: async () => "verified-on-server" };
  vm.runInNewContext(icons, context);
  vm.runInNewContext(
    await readFile(
      new URL("../../js/chat-accounts.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const account = context.window.ChatAccounts({
    client,
    config: {
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "public",
    },
    esc,
    toast: () => {},
    modal: (_title, html) => (d.getElementById("modal").innerHTML = html),
    closeModal: () => {},
  });
  try {
    account.remember(sessions("alice"));
    account.remember(sessions("bob"));
    await account.show();
    assert.equal(d.querySelectorAll("[data-switch-account]").length, 2);
    assert.ok(!d.body.innerHTML.includes("refresh-bob"));
    d.querySelector('[data-switch-account="bob"]').click();
    await pause();
    assert.equal(reloads, 1);
    assert.equal(calls[0].refresh_token, "refresh-bob");
    current = { ...sessions("bob"), refresh_token: "new-bob" };
    subscriber("TOKEN_REFRESHED", current);
    assert.ok([...storage.values()][0].includes("new-bob"));
    account.add();
    d.querySelector("[name=email]").value = "carol@example.test";
    d.querySelector("[name=password]").value = "never-store-this-password";
    d.querySelector("form").dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert.equal(
      calls.find((x) => x.email).options.captchaToken,
      "verified-on-server",
    );
    assert.equal(reloads, 2);
    assert.ok(![...storage.values()][0].includes("never-store-this-password"));
    subscriber("SIGNED_OUT", null);
    assert.ok(![...storage.values()][0].includes("refresh-carol"));
    assert.ok([...storage.values()][0].includes("new-bob"));
    account.forget("alice");
    assert.ok(![...storage.values()][0].includes("refresh-alice"));
  } finally {
    dom.window.close();
  }
});

test("Developer Portal has identity, credentials, API commands and hosting outside server settings", async () => {
  const html = await readFile(
    new URL("../sources/developers.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
      url: "http://localhost/external/developers.html?preview",
      runScripts: "outside-only",
    }),
    w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  try {
    w.eval(icons);
    w.eval(
      await readFile(
        new URL("../../js/chat-developers.js", import.meta.url),
        "utf8",
      ),
    );
    await pause();
    assert.equal(w.document.querySelectorAll("[data-open-app]").length, 1);
    w.document.querySelector("[data-open-app]").click();
    await pause();
    for (const field of ["username", "avatar_url", "banner_url", "bio"])
      assert.ok(w.document.querySelector(`[name="${field}"]`));
    w.document.querySelector('[data-app-tab="commands"]').click();
    await pause();
    assert.match(
      w.document.getElementById("applicationPanel").textContent,
      /chatbox.js/,
    );
    assert.equal(w.document.querySelector("textarea"), null);
    w.document.querySelector('[data-app-tab="bot"]').click();
    await pause();
    assert.ok(w.document.getElementById("rotateApplicationToken"));
    assert.equal(
      w.document.querySelector('[aria-label="New bot token"]'),
      null,
    );
  } finally {
    w.close();
  }
});

test("typed slash UI submits named values, nested commands, false booleans and channel references", async () => {
  const dom = new JSDOM('<div id="modal"></div>', {
      runScripts: "outside-only",
    }),
    w = dom.window,
    d = w.document,
    calls = [];
  const state = {
    me: { id: "alice" },
    room: "lobby",
    profiles: [{ id: "bob", display_name: "Bob", username: "bob" }],
    channels: [{ id: "lobby", name: "general", kind: "text" }],
    categories: [],
  };
  w.ChatCore = {
    esc,
    roles: ["Moderator"],
    https: () => null,
    render: esc,
    embeds: () => "",
  };
  w.eval(icons);
  w.eval(
    await readFile(
      new URL("../../js/chat-interactions.js", import.meta.url),
      "utf8",
    ),
  );
  const options = [
    {
      type: 2,
      name: "group",
      description: "Group",
      options: [
        {
          type: 1,
          name: "run",
          description: "Run",
          options: [
            {
              type: 4,
              name: "count",
              description: "Count",
              required: true,
              min_value: 1,
              max_value: 10,
            },
            { type: 5, name: "confirm", description: "Confirm" },
            { type: 6, name: "user", description: "User" },
            { type: 7, name: "channel", description: "Channel" },
            {
              type: 3,
              name: "mode",
              description: "Mode",
              choices: [{ name: "Quick", value: "quick" }],
            },
            { type: 11, name: "file", description: "File" },
            { type: 3, name: "note", description: "Note", format: "multiline" },
          ],
        },
      ],
    },
  ];
  const errors = [];
  const api = w.ChatInteractions({
    state,
    profile: () => ({ display_name: "Bot" }),
    toast: () => {},
    safe: (fn) =>
      Promise.resolve()
        .then(fn)
        .catch((e) => errors.push(e)),
    modal: (_t, html) => (d.getElementById("modal").innerHTML = html),
    closeModal: () => d.getElementById("modal").replaceChildren(),
    upload: () => {},
    rpc: async (op, p) => {
      calls.push({ op, p });
      return op === "commands"
        ? [{ bot_id: "bot", name: "tools", description: "Tools", options }]
        : op === "status"
          ? { response: { type: "sent" } }
          : { id: "ticket", bot_id: "bot" };
    },
  });
  try {
    await api.command("tools", "");
    assert.ok(d.querySelector("form"));
    assert.equal(d.querySelector('[name="arg-count"]').max, "10");
    assert.ok(d.querySelector('[name="arg-file"][type=file]'));
    assert.ok(d.querySelector('textarea[name="arg-note"]'));
    for (const [name, value] of Object.entries({
      count: "3",
      confirm: "false",
      user: "bob",
      channel: "lobby",
      mode: '"quick"',
      note: "Hello",
    }))
      d.querySelector(`[name="arg-${name}"]`).value = value;
    d.querySelector("form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    const submission = calls.find((x) => x.op === "command").p;
    assert.equal(submission.options[0].name, "group");
    assert.equal(submission.options[0].options[0].name, "run");
    const leaf = submission.options[0].options[0].options;
    assert.equal(leaf.find((x) => x.name === "count").value, 3);
    assert.equal(leaf.find((x) => x.name === "confirm").value, false);
    assert.equal(leaf.find((x) => x.name === "user").value, "bob");
    assert.equal(leaf.find((x) => x.name === "mode").value, "quick");
    assert.deepEqual(errors, []);
  } finally {
    w.close();
  }
});
test("Developer Portal renews expired human verification for command and hosting reads", async () => {
  const html = await readFile(
    new URL("../sources/developers.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
      url: "https://chat.example/external/developers.html#bot",
      runScripts: "outside-only",
    }),
    w = dom.window;
  const calls = [];
  let verified = false;
  w.CHATBOX_CONFIG = {
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "public",
    functionName: "chat-api",
  };
  w.ChatCaptcha = {
    request: async (label) => {
      calls.push({ captcha: label });
      return "single-use-test-token";
    },
  };
  w.ChatAccounts = () => ({ remember() {}, show() {} });
  w.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    verified = true;
    return {
      ok: true,
      json: async () => ({
        expires_at: new Date(Date.now() + 900000).toISOString(),
      }),
    };
  };
  w.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: "owner" },
              access_token: "fake-test-session",
            },
          },
        }),
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "chat_hosted" && !verified)
          return { error: { message: "CHATBOX_VERIFICATION_REQUIRED" } };
        if (name === "chat_hosted")
          return {
            data: [{ name: "hello", description: "Hello", options: [] }],
          };
        return {
          data:
            args.action === "bootstrap"
              ? { root: false }
              : [
                  {
                    id: "bot",
                    owner_id: "owner",
                    enabled: true,
                    profile: {
                      display_name: "Bot",
                      username: "bot",
                      banner_color: "#5865f2",
                    },
                  },
                ],
        };
      },
    }),
  };
  try {
    w.eval(icons);
    w.eval(
      await readFile(
        new URL("../../js/chat-developers.js", import.meta.url),
        "utf8",
      ),
    );
    await pause();
    w.document.querySelector('[data-app-tab="commands"]').click();
    await pause();
    assert.equal(calls.filter((x) => x.captcha).length, 1);
    assert.equal(calls.filter((x) => x.name === "chat_hosted").length, 2);
    assert.equal(
      calls.find((x) => x.action === "verify_session").captchaToken,
      "single-use-test-token",
    );
    assert.match(
      w.document.getElementById("registeredCommands").textContent,
      /hello/,
    );
  } finally {
    w.close();
  }
});
