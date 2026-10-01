/** Node.js 20+ client. Keep tokens on your server, never in browser code. */
export class ChatboxBot {
  constructor({
    token = process.env.CHATBOX_BOT_TOKEN,
    baseURL = "https://lflkpziiwnoamvtrbcil.supabase.co/functions/v1/chat-api",
  } = {}) {
    if (!token) throw new Error("CHATBOX_BOT_TOKEN is required");
    this.token = token;
    this.baseURL = baseURL.replace(/\/$/, "");
  }
  async request(path, { method = "GET", body, signal } = {}) {
    const res = await fetch(this.baseURL + path, {
      method,
      headers: {
        Authorization: "Bot " + this.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal || AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(
        data.message || data.error || "Bot request failed",
      );
      error.status = res.status;
      error.blocked = !!data.blocked;
      error.retryAfter = data.retry_after;
      throw error;
    }
    return data;
  }
  me() {
    return this.request("/v1/me");
  }
  channels() {
    return this.request("/v1/channels");
  }
  messages(channelId, { after, afterId, signal } = {}) {
    const query = new URLSearchParams();
    if (after) query.set("after", after);
    if (afterId) query.set("after_id", afterId);
    return this.request(
      `/v1/channels/${encodeURIComponent(channelId)}/messages?${query}`,
      { signal },
    );
  }
  send(channelId, text, { replyTo } = {}) {
    return this.request(
      `/v1/channels/${encodeURIComponent(channelId)}/messages`,
      { method: "POST", body: { text, reply_to: replyTo } },
    );
  }
  edit(messageId, text) {
    return this.request("/v1/messages/" + encodeURIComponent(messageId), {
      method: "PATCH",
      body: { text },
    });
  }
  delete(messageId) {
    return this.request("/v1/messages/" + encodeURIComponent(messageId), {
      method: "DELETE",
    });
  }
  /** Polls one channel; persist the cursor externally if your bot needs restart recovery. */
  async listen(
    channelId,
    onMessage,
    {
      intervalMs = 3000,
      signal,
      after = new Date().toISOString(),
      afterId = "",
    } = {},
  ) {
    let cursor = after,
      cursorId = afterId;
    while (!signal?.aborted) {
      try {
        const rows = await this.messages(channelId, {
          after: cursor,
          afterId: cursorId,
          signal,
        });
        for (const m of rows) {
          if (signal?.aborted) return;
          await onMessage(m);
          cursor = m.created_at;
          cursorId = m.id;
        }
      } catch (e) {
        if (signal?.aborted) return;
        if (e.status === 401 || e.status === 403) throw e;
        await delay(
          e.status === 429 ? (e.retryAfter || 60) * 1000 : 10000,
          signal,
        );
      }
      await delay(Math.max(1500, intervalMs), signal);
    }
  }
}
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
