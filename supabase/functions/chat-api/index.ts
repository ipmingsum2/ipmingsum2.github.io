import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const env = (name: string) => Deno.env.get(name) || "";
const site = env("CHATBOX_SITE_URL") || "https://ipmingsum2.github.io";
const allowedOrigins = new Set([
  new URL(site).origin,
  ...env("CHATBOX_ALLOWED_ORIGINS").split(",").filter(Boolean),
]);
const cache = new Map<string, { until: number; value: unknown }>();
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
    if (auth.startsWith("Bot ")) {
      const token = auth.slice(4);
      if (!/^cb_[a-f0-9]{64}$/.test(token))
        return reply({ error: "Invalid bot token" }, 401);
      const path = url.pathname.split("/chat-api")[1] || "/";
      let action: string,
        payload: any = {};
      if (path === "/v1/me" && req.method === "GET") action = "me";
      else if (path === "/v1/channels" && req.method === "GET")
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
    const body = await boundedBody(req);
    const { error: limit } = await client.rpc("chat_action", {
      action: body.action === "invite" ? "invite_rate" : "api_rate",
      payload: {},
    });
    if (limit)
      return reply(
        { error: limit.message },
        /Slow down/.test(limit.message) ? 429 : 403,
      );
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
