import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { ChatboxBot } from "../chatbox-bot.mjs";
const source = stripTypeScriptTypes(
  (
    await readFile(
      new URL("../../../supabase/functions/chat-api/index.ts", import.meta.url),
      "utf8",
    )
  ).replace(/^import[\s\S]*?;\s*/gm, ""),
);
function harness({
  result = {},
  auth = true,
  inviteError = null,
  secrets = {},
  captcha = null,
  rpcError = null,
  storageError = null,
} = {}) {
  let handler;
  const calls = [];
  const sandbox = {
    atob,
    URL,
    URLSearchParams,
    Request,
    Response,
    AbortSignal,
    TextDecoder,
    Uint8Array,
    Map,
    Set,
    console,
    Deno: {
      env: {
        get: (n) =>
          ({
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "server-only",
            SUPABASE_ANON_KEY: "public",
            ...secrets,
          })[n],
      },
      serve: (fn) => (handler = fn),
    },
    createClient: () => ({
      storage: {
        from: (bucket) => ({
          remove: async (names) => {
            calls.push({ name: "removeStorage", bucket, names });
            return { error: storageError };
          },
        }),
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: result, error: rpcError };
      },
      auth: {
        admin: {
          updateUserById: async (id, attributes) => {
            calls.push({ name: "updateUser", id, attributes });
            return { error: null };
          },
          deleteUser: async (id) => {
            calls.push({ name: "deleteUser", id });
            return { error: null };
          },
          inviteUserByEmail: async (email, options) => {
            calls.push({ name: "invite", email, options });
            return { error: inviteError };
          },
        },
        getUser: async () => ({
          data: { user: auth ? { id: "user" } : null },
          error: null,
        }),
      },
    }),
    fetch: async (url, options) => {
      if (captcha !== null && url === "https://api.hcaptcha.com/siteverify") {
        calls.push({ name: "siteverify", options });
        return new Response(JSON.stringify(captcha), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw Error("Unexpected external fetch");
    },
  };
  vm.runInNewContext(source, sandbox);
  return {
    request: (path, options = {}) =>
      handler(
        new Request(
          "https://example.supabase.co/functions/v1/chat-api" + path,
          options,
        ),
      ),
    calls,
  };
}
test("bot endpoint propagates slowmode as 429 and forwards timestamp plus ID cursors", async () => {
  const h = harness({
    result: { slowmode: true, retry_after: 27, message: "Wait" },
  });
  const token = "cb_" + "a".repeat(64);
  const res = await h.request(
    "/v1/channels/my%20channel/messages?after=2026-01-01T00%3A00%3A00Z&after_id=last",
    { headers: { Authorization: "Bot " + token } },
  );
  assert.equal(res.status, 429);
  assert.equal((await res.json()).retry_after, 27);
  assert.equal(h.calls[0].args.payload.channel_id, "my channel");
  assert.equal(h.calls[0].args.payload.after_id, "last");
});
test("generic bot actions pass through checked dispatcher and preserve component payloads", async () => {
  const h = harness(),
    headers = {
      Authorization: "Bot cb_" + "a".repeat(64),
      "Content-Type": "application/json",
    };
  const response = await h.request("/v1/actions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "interaction_reply",
      payload: { id: "ticket", text: "done", ephemeral: true },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].name, "chat_bot");
  assert.equal(h.calls[0].args.action, "interaction_reply");
  assert.equal(h.calls[0].args.payload.ephemeral, true);
  const bad = await h.request("/v1/actions", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "send", payload: [] }),
  });
  assert.equal(bad.status, 400);
  const components = [
    { components: [{ custom_id: "apply", label: "Apply", style: 1 }] },
  ];
  await h.request("/v1/channels/lobby/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "apply", components }),
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.calls.at(-1).args.payload.components)),
    components,
  );
});

test("invitations use a fixed callback and report delivery failures without claiming success", async () => {
  const request = (h) =>
    h.request("", {
      method: "POST",
      headers: {
        Authorization: "Bearer session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "invite",
        email: "Recipient@Example.test",
        redirect_to: "https://untrusted.example",
      }),
    });
  const success = harness();
  assert.equal((await request(success)).status, 200);
  const invite = success.calls.find((c) => c.name === "invite");
  assert.equal(invite.email, "recipient@example.test");
  assert.equal(
    invite.options.redirectTo,
    "https://ipmingsum2.github.io/external/chat.html?invited=1",
  );
  assert.equal(success.calls[0].args.action, "invite_rate");
  const fail = await request(
    harness({ inviteError: { message: "Email rate limit exceeded" } }),
  );
  assert.equal(fail.status, 400);
  assert.match((await fail.json()).error, /Copy Invite Link/);
  const incomplete = await request(
    harness({ secrets: { RESEND_API_KEY: "test" } }),
  );
  assert.equal(incomplete.status, 400);
  assert.match((await incomplete.json()).error, /CHATBOX_EMAIL_FROM/);
});
test("API rejects invalid origins, missing user auth, and malformed bot tokens before dispatch", async () => {
  const h = harness();
  assert.equal(
    (
      await h.request("", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal((await h.request("", { method: "POST" })).status, 401);
  assert.equal(
    (await h.request("/v1/me", { headers: { Authorization: "Bot invalid" } }))
      .status,
    401,
  );
  assert.equal(h.calls.length, 0);
});
test("metadata only accepts public HTTPS URLs; provider failures yield a link card", async () => {
  const h = harness();
  const req = (url) =>
    h.request("", {
      method: "POST",
      headers: {
        Authorization: "Bearer session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "embed", url }),
    });
  for (const url of [
    "http://example.com",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://user:pass@example.com",
    "https://[::1]/",
  ])
    assert.equal((await req(url)).status, 400);
  const res = await req("https://example.com/post");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, "example.com");
});
test("bot HTTP routes forward DM, embed, event and moderation payloads to the authenticated dispatcher", async () => {
  const h = harness(),
    headers = {
      Authorization: "Bot cb_" + "b".repeat(64),
      "Content-Type": "application/json",
    };
  for (const [path, method, body, action] of [
    ["/v1/dms", "POST", { user_id: "member" }, "dm"],
    [
      "/v1/moderation",
      "POST",
      { user_id: "member", action: "warning", reason: "Test" },
      "moderate",
    ],
    ["/v1/automod", "POST", { name: "Words", words: ["one, two"] }, "automod"],
    ["/v1/automod/rule-id", "DELETE", undefined, "delete_rule"],
    ["/v1/users/member", "GET", undefined, "user"],
    ["/v1/events?after=2026-01-01&after_id=last", "GET", undefined, "events"],
    [
      "/v1/channels/lobby/messages",
      "POST",
      { embeds: [{ title: "Hello" }] },
      "send",
    ],
    [
      "/v1/messages/message-id",
      "PATCH",
      { embeds: [{ description: "Edited" }] },
      "edit",
    ],
  ]) {
    const response = await h.request(path, {
      method,
      headers,
      body: body && JSON.stringify(body),
    });
    assert.equal(response.status, 200, path);
    const call = h.calls.at(-1);
    assert.equal(call.name, "chat_bot");
    assert.equal(call.args.action, action);
    if (body?.embeds)
      assert.deepEqual(
        JSON.parse(JSON.stringify(call.args.payload.embeds)),
        body.embeds,
      );
    if (action === "events") assert.equal(call.args.payload.after_id, "last");
  }
});

test("SDK preserves equal timestamp cursor IDs and exposes slowmode retry duration", async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return new Response(
      JSON.stringify({ slowmode: true, retry_after: 12, message: "Wait" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const bot = new ChatboxBot({
      token: "test",
      baseURL: "https://example.com",
    });
    await assert.rejects(
      bot.messages("space channel", {
        after: "2026-01-01T00:00:00Z",
        afterId: "same-time-id",
      }),
      (e) => e.status === 429 && e.retryAfter === 12,
    );
    const u = new URL(requested);
    assert.equal(u.searchParams.get("after_id"), "same-time-id");
    assert.match(u.pathname, /space%20channel/);
  } finally {
    globalThis.fetch = original;
  }
});

test("human moderation verifies single-use hCaptcha server-side and binds actor to the JWT", async () => {
  const headers = {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
  };
  const input = {
    action: "verified_action",
    operation: "moderate",
    payload: { user_id: "target", action: "warning" },
    actor: "forged",
    captchaToken: "valid-token",
  };
  const h = harness({
    secrets: { HCAPTCHA_SECRET: "server-only-test" },
    captcha: { success: true },
    result: { ok: true },
  });
  const response = await h.request("", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const verify = h.calls.find((x) => x.name === "siteverify");
  const params = new URLSearchParams(verify.options.body);
  assert.equal(params.get("sitekey"), "0d2e5bd6-b20c-4fa0-a824-abb2f40e9eb8");
  assert.equal(params.get("response"), "valid-token");
  assert.equal(
    h.calls.find((x) => x.name === "chat_verified_action").args.actor,
    "user",
  );
  assert.doesNotMatch(await response.text(), /server-only-test/);
  for (const captcha of [{ success: false }, { success: "true" }]) {
    const denied = harness({ secrets: { HCAPTCHA_SECRET: "test" }, captcha });
    const res = await denied.request("", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    assert.notEqual(res.status, 200);
    assert.equal(
      denied.calls.some((x) => x.name === "chat_verified_action"),
      false,
    );
  }
  const missing = harness();
  assert.notEqual(
    (
      await missing.request("", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
    200,
  );
});

test("root password resets never return passwords and stop on failed root authorization", async () => {
  const options = {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "root_reset_password",
      user_id: "target",
      password: "not-a-real-password",
      captchaToken: "valid",
    }),
  };
  const h = harness({
    secrets: { HCAPTCHA_SECRET: "test" },
    captcha: { success: true },
  });
  const res = await h.request("", options);
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /not-a-real-password/);
  assert.equal(
    h.calls.find((x) => x.name === "chat_root_account").args.actor,
    "user",
  );
  assert.equal(h.calls.find((x) => x.name === "updateUser").id, "target");
  const denied = harness({
    secrets: { HCAPTCHA_SECRET: "test" },
    captcha: { success: true },
    rpcError: { message: "Root permission required" },
  });
  assert.notEqual((await denied.request("", options)).status, 200);
  assert.equal(
    denied.calls.some((x) => x.name === "updateUser"),
    false,
  );
});

test("root deletion removes uploads before data and login, and stops safely on storage failure", async () => {
  const options = {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "root_wipe_account",
      user_id: "target",
      confirmation: "DELETE member",
      captchaToken: "valid",
    }),
  };
  const setup = {
    secrets: { HCAPTCHA_SECRET: "test" },
    captcha: { success: true },
    result: {
      assets: [{ bucket: "chatbox-private", name: "target/file.png" }],
    },
  };
  const h = harness(setup);
  assert.equal((await h.request("", options)).status, 200);
  const operations = h.calls
    .filter((x) =>
      [
        "chat_root_account",
        "updateUser",
        "removeStorage",
        "deleteUser",
      ].includes(x.name),
    )
    .map((x) => x.args?.operation || x.name);
  assert.deepEqual(operations, [
    "prepare",
    "updateUser",
    "removeStorage",
    "purge",
    "deleteUser",
    "finish",
  ]);
  const failed = harness({
    ...setup,
    storageError: { message: "Storage unavailable" },
  });
  assert.notEqual((await failed.request("", options)).status, 200);
  assert.equal(
    failed.calls.some(
      (x) => x.name === "deleteUser" || x.args?.operation === "purge",
    ),
    false,
  );
  const denied = harness({
    ...setup,
    rpcError: { message: "Root permission required" },
  });
  assert.notEqual((await denied.request("", options)).status, 200);
  assert.equal(
    denied.calls.some((x) =>
      ["updateUser", "removeStorage", "deleteUser"].includes(x.name),
    ),
    false,
  );
});
