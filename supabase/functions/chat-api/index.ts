import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from "npm:quickjs-emscripten-core@0.31.0";
import RELEASE_SYNC from "npm:@jitl/quickjs-singlefile-browser-release-sync@0.31.0";
import { runHosted, HOSTED_SDK } from "./hosted-bundle.ts";
let hostedEngine;

const env = (name: string) => Deno.env.get(name) || "";
const site = env("CHATBOX_SITE_URL") || "https://ipmingsum2.github.io";
const allowedOrigins = new Set([
  new URL(site).origin,
  ...env("CHATBOX_ALLOWED_ORIGINS").split(",").filter(Boolean),
]);
const cache = new Map<string, { until: number; value: unknown }>();
const CAPTCHA_ACTIONS = new Set([
  "moderate",
  "role",
  "nickname",
  "automod",
  "delete_rule",
  "permission",
  "bot_scopes",
  "delete_message",
]);
async function verifyCaptcha(token: unknown) {
  if (!env("HCAPTCHA_SECRET"))
    throw new Error(
      "Verification is not configured. Contact the server owner.",
    );
  if (typeof token !== "string" || !token || token.length > 16000)
    throw new Error("Complete hCaptcha verification and try again.");
  const result = await jsonFetch("https://api.hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env("HCAPTCHA_SECRET"),
      response: token,
      sitekey: "0d2e5bd6-b20c-4fa0-a824-abb2f40e9eb8",
    }).toString(),
  });
  if (result.success !== true)
    throw new Error("Verification failed or expired. Please try again.");
}
function publicURL(value: unknown): string {
  const u = new URL(String(value));
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hostname.includes(":") ||
    !u.hostname.includes(".") ||
    /^\d/.test(u.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(u.hostname)
  )
    throw new Error("Use a public HTTPS link.");
  u.hash = "";
  return u.href;
}
async function jsonFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Provider returned ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty provider response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1500000) throw new Error("Provider response is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    all.set(chunk, pos);
    pos += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}
async function embed(raw: unknown) {
  const url = publicURL(raw),
    key = "embed:" + url,
    old = cache.get(key);
  if (old && old.until > Date.now()) return old.value;
  const host = new URL(url).hostname;
  let result: any = { url, title: host, site_name: host };
  try {
    // Only fixed, public metadata services are fetched. Never fetch user-controlled hosts on this server.
    if (
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        host,
      )
    ) {
      const data = await jsonFetch(
        "https://www.youtube.com/oembed?format=json&url=" +
          encodeURIComponent(url),
      );
      result = {
        url,
        title: String(data.title || host),
        site_name: "YouTube",
        description: data.author_name,
        image: data.thumbnail_url,
      };
    } else {
      const data = await jsonFetch(
        "https://api.microlink.io/?url=" + encodeURIComponent(url),
      );
      if (data.status === "success")
        result = {
          url,
          title: String(data.data.title || host),
          site_name: data.data.publisher || host,
          description: data.data.description,
          image: data.data.image?.url,
        };
    }
  } catch {
    /* Provider limits never prevent sending a message. A simple link card is the fallback. */
  }
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + 600000, value: result });
  return result;
}
async function gifs(query: string) {
  const q = query.trim().slice(0, 100) || "hello";
  if (env("GIPHY_API_KEY")) {
    const url = new URL("https://api.giphy.com/v1/gifs/search");
    url.search = new URLSearchParams({
      api_key: env("GIPHY_API_KEY"),
      q,
      limit: "24",
      rating: "pg",
      lang: "en",
    }).toString();
    const data = await jsonFetch(url.href);
    return {
      provider: "GIPHY",
      items: data.data.map((g: any) => ({
        title: g.title,
        url: g.images.original.url,
        preview: g.images.fixed_width.url,
        source: g.url,
      })),
    };
  }
  // A key-free fallback; GIPHY can be enabled later without shipping a new frontend.
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `filemime:"image/gif" ${q.replace(/[^\p{L}\p{N} ]/gu, " ")}`,
    gsrlimit: "24",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "320",
  }).toString();
  const data = await jsonFetch(url.href, {
    headers: {
      "User-Agent":
        "Chatbox/2.0 (community GIF search; https://ipmingsum2.github.io)",
    },
  });
  return {
    provider: "Wikimedia Commons",
    items: Object.values(data.query?.pages || {})
      .map((p: any) => {
        const i = p.imageinfo?.[0];
        return i
          ? {
              title: p.title.replace(/^File:/, ""),
              url: i.url,
              preview: i.thumburl || i.url,
              source: i.descriptionurl,
              license: i.extmetadata?.LicenseShortName?.value || "",
              credit: true,
            }
          : null;
      })
      .filter(Boolean),
  };
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin"),
    headers: Record<string, string> = {
      "Content-Type": "application/json",
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
      "Cache-Control": "no-store",
    };
  if (origin && allowedOrigins.has(origin))
    headers["Access-Control-Allow-Origin"] = origin;
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowedOrigins.has(origin))
    return reply({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  try {
    const url = new URL(req.url),
      auth = req.headers.get("authorization") || "";
    const admin = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (
      url.pathname.endsWith("/chat-api/hosted/run") &&
      req.method === "POST"
    ) {
      const secret = req.headers.get("x-chatbox-runner");
      if (!secret)
        return reply({ error: "Runner authorization required" }, 401);
      const claim = await admin.rpc("chat_hosted_claim", {
        runner_secret: secret,
      });
      if (claim.error)
        return reply({ error: "Runner authorization failed" }, 401);
      const jobs = claim.data || [];
      hostedEngine ||= newQuickJSWASMModuleFromVariant(
        newVariant(RELEASE_SYNC, {
          wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
        }),
      ).catch((e) => {
        hostedEngine = null;
        throw e;
      });
      const engine = await hostedEngine;
      if (!jobs.length)
        await runHosted(
          engine,
          "import {Client} from 'chatbox.js';await new Client().login();",
          HOSTED_SDK,
          { bot: { id: "health" }, message: {} },
          async () => {
            throw Error("Health check cannot call API");
          },
        );
      if (jobs.length) {
        for (const job of jobs) {
          let outcome;
          try {
            outcome = await runHosted(
              engine,
              job.source,
              HOSTED_SDK,
              job.event,
              async (action, payload) => {
                const r = await admin
                  .rpc("chat_hosted_action", {
                    job_id: job.id,
                    job_lease: job.lease,
                    action,
                    payload,
                  })
                  .abortSignal(AbortSignal.timeout(6000));
                if (r.error) throw Error(r.error.message);
                if (r.data?.blocked || r.data?.slowmode)
                  throw Error(r.data.message || "Message blocked");
                return r.data;
              },
            );
          } catch (error) {
            outcome = {
              error: String(error.message || error).slice(0, 1000),
              logs: [],
            };
          }
          const finished = await admin.rpc("chat_hosted_finish", {
            job_id: job.id,
            job_lease: job.lease,
            outcome,
          });
          if (finished.error)
            console.error("Hosted completion could not be recorded");
        }
      }
      return reply({ processed: jobs.length });
    }
    if (auth.startsWith("Bot ")) {
      const token = auth.slice(4);
      if (!/^cb_[a-f0-9]{64}$/.test(token))
        return reply({ error: "Invalid bot token" }, 401);
      const path = url.pathname.split("/chat-api")[1] || "/";
      let action: string,
        payload: any = {};
      if (path === "/v1/me" && req.method === "GET") action = "me";
      else if (path === "/v1/actions" && req.method === "POST") {
        const body = await boundedBody(req);
        if (
          typeof body.action !== "string" ||
          !body.payload ||
          typeof body.payload !== "object" ||
          Array.isArray(body.payload)
        )
          return reply({ error: "Action and payload object required" }, 400);
        action = body.action;
        payload = body.payload;
      } else if (path === "/v1/channels" && req.method === "GET")
        action = "channels";
      else if (path === "/v1/events" && req.method === "GET") {
        action = "events";
        payload = {
          after: url.searchParams.get("after"),
          after_id: url.searchParams.get("after_id"),
        };
      } else if (/^\/v1\/users\/[^/]+$/.test(path) && req.method === "GET") {
        action = "user";
        payload = { user_id: decodeURIComponent(path.split("/")[3]) };
      } else if (path === "/v1/dms" && req.method === "POST") {
        action = "dm";
        payload = { user_id: (await boundedBody(req)).user_id };
      } else if (path === "/v1/moderation" && req.method === "POST") {
        action = "moderate";
        payload = await boundedBody(req);
      } else if (path === "/v1/automod" && req.method === "POST") {
        action = "automod";
        payload = await boundedBody(req);
      } else if (
        /^\/v1\/automod\/[^/]+$/.test(path) &&
        req.method === "DELETE"
      ) {
        action = "delete_rule";
        payload = { id: decodeURIComponent(path.split("/")[3]) };
      } else if (/^\/v1\/channels\/[^/]+\/messages$/.test(path)) {
        payload.channel_id = decodeURIComponent(path.split("/")[3]);
        if (req.method === "GET") {
          action = "messages";
          if (url.searchParams.has("after"))
            payload.after = url.searchParams.get("after");
          if (url.searchParams.has("after_id"))
            payload.after_id = url.searchParams.get("after_id");
        } else if (req.method === "POST") {
          action = "send";
          const body = await boundedBody(req);
          payload = {
            text: body.text,
            embeds: body.embeds,
            ...(body.components !== undefined
              ? { components: body.components }
              : {}),
            reply_to: body.reply_to,
            channel_id: payload.channel_id,
          };
        } else return reply({ error: "Method not allowed" }, 405);
      } else if (
        /^\/v1\/messages\/[^/]+$/.test(path) &&
        ["PATCH", "DELETE"].includes(req.method)
      ) {
        action = req.method === "PATCH" ? "edit" : "delete_message";
        payload = { id: decodeURIComponent(path.split("/")[3]) };
        if (action === "edit") {
          const body = await boundedBody(req);
          payload.text = body.text;
          payload.embeds = body.embeds;
          if (body.components !== undefined)
            payload.components = body.components;
        }
      } else return reply({ error: "Endpoint not found" }, 404);
      const { data, error } = await admin.rpc("chat_bot", {
        action,
        token,
        payload,
      });
      if (error)
        return reply(
          { error: error.message },
          /token/i.test(error.message)
            ? 401
            : /Slow down/.test(error.message)
              ? 429
              : 403,
        );
      return reply(data, data?.blocked ? 422 : data?.slowmode ? 429 : 200);
    }
    if (req.method !== "POST")
      return reply({ error: "Method not allowed" }, 405);
    if (!auth && !req.body) return reply({ error: "Sign in required" }, 401);
    const body = await boundedBody(req);
    if (body.action === "verify_visitor") {
      await verifyCaptcha(body.captchaToken);
      return reply({ verified: true });
    }
    const token = auth.replace(/^Bearer /, "");
    if (!token || token === auth)
      return reply({ error: "Sign in required" }, 401);
    const { data: user, error: authError } = await admin.auth.getUser(token);
    if (authError || !user.user)
      return reply({ error: "Session expired" }, 401);
    const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: limit } = await client.rpc("chat_action", {
      action: body.action === "invite" ? "invite_rate" : "api_rate",
      payload: {},
    });
    if (limit)
      return reply(
        { error: limit.message },
        /Slow down/.test(limit.message) ? 429 : 403,
      );
    if (
      body.action === "root_reset_password" ||
      body.action === "root_wipe_account"
    ) {
      await verifyCaptcha(body.captchaToken);
      const target = String(body.user_id || "");
      const account = async (operation: string) => {
        const result = await admin.rpc("chat_root_account", {
          actor: user.user.id,
          target,
          operation,
          confirmation: String(body.confirmation || ""),
        });
        if (result.error) throw new Error(result.error.message);
        return result.data;
      };
      if (body.action === "root_reset_password") {
        await account("check");
        const password = body.password;
        if (
          typeof password !== "string" ||
          password.length < 12 ||
          password.length > 128
        )
          return reply(
            { error: "Use a new password between 12 and 128 characters." },
            400,
          );
        const result = await admin.auth.admin.updateUserById(target, {
          password,
        });
        if (result.error)
          throw new Error("Password reset failed: " + result.error.message);
        return reply({
          message:
            "Password reset. The password is never returned or displayed.",
        });
      }
      const job = await account("prepare");
      const frozen = await admin.auth.admin.updateUserById(target, {
        ban_duration: "876000h",
      });
      if (frozen.error && frozen.error.status !== 404)
        throw new Error(
          "Deletion paused while disabling sign-in. Retry this operation.",
        );
      const buckets = new Map<string, string[]>();
      for (const asset of job.assets || []) {
        if (!buckets.has(asset.bucket)) buckets.set(asset.bucket, []);
        buckets.get(asset.bucket)!.push(asset.name);
      }
      for (const [bucket, names] of buckets)
        for (let offset = 0; offset < names.length; offset += 500) {
          const result = await admin.storage
            .from(bucket)
            .remove(names.slice(offset, offset + 500));
          if (result.error)
            throw new Error(
              "Deletion paused while removing uploads. Retry this operation.",
            );
        }
      await account("purge");
      const deleted = await admin.auth.admin.deleteUser(target);
      if (deleted.error && deleted.error.status !== 404)
        throw new Error(
          "Chat data removed, but login deletion needs a retry. Keep this dialog open and retry.",
        );
      await account("finish");
      return reply({
        message: "Account and associated chat data permanently deleted.",
      });
    }
    if (body.action === "verified_action" || body.action === "verify_session") {
      if (
        body.action === "verified_action" &&
        !CAPTCHA_ACTIONS.has(body.operation)
      )
        return reply({ error: "Unsupported verified action" }, 400);
      await verifyCaptcha(body.captchaToken);
      if (body.action === "verify_session") {
        const claims = JSON.parse(
          atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (
          typeof claims.session_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(claims.session_id)
        )
          return reply({ error: "Sign in again to verify this session." }, 401);
        const result = await admin.rpc("chat_verify_session", {
          actor: user.user.id,
          auth_session: claims.session_id,
        });
        if (result.error) return reply({ error: result.error.message }, 403);
        return reply(result.data);
      }
      const result = await admin.rpc("chat_verified_action", {
        actor: user.user.id,
        action: body.operation,
        payload: body.payload || {},
      });
      if (result.error) return reply({ error: result.error.message }, 403);
      return reply(result.data);
    }
    if (body.action === "embed") return reply(await embed(body.url));
    if (body.action === "gifs") return reply(await gifs(String(body.q || "")));
    if (body.action === "invite") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        return reply({ error: "Enter a valid email address" }, 400);
      if (env("RESEND_API_KEY")) {
        if (!env("CHATBOX_EMAIL_FROM"))
          throw new Error(
            "Email sender is not configured. Set CHATBOX_EMAIL_FROM or use Copy Invite Link.",
          );
        await jsonFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env("RESEND_API_KEY"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env("CHATBOX_EMAIL_FROM"),
            to: [email],
            subject: "You’re invited to CHATBOX",
            text: `You have been invited to join CHATBOX.\n\nCreate your account: ${site}/external/register.html\n\nAlready a member? ${site}/external/chat.html`,
          }),
        });
      } else {
        const { error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: site + "/external/chat.html?invited=1",
        });
        if (error)
          throw new Error(
            "Email delivery failed. Use Copy Invite Link, or ask root to check Supabase SMTP and invitation limits. " +
              error.message,
          );
      }
      return reply({
        message:
          "Email invitation sent. The recipient can follow the link to join.",
      });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
});
async function boundedBody(req: Request): Promise<Record<string, any>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("JSON body required");
  let text = "",
    bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 100000) throw new Error("Request is too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("JSON object required");
  return body;
}
