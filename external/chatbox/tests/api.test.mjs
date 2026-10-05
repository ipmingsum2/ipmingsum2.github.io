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
} = {}) {
  let handler;
  const calls = [];
  const sandbox = {
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
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: result, error: null };
      },
      auth: {
        admin: {
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
    fetch: async () => {
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
