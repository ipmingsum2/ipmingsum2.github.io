/* CHATBOX v2 — static client, Supabase authorization and realtime. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    C = window.ChatCore,
    { esc, https } = C,
    cfg = window.CHATBOX_CONFIG;
  const preview =
    new URLSearchParams(location.search).has("preview") &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  const register = location.pathname.endsWith("/register.html");
  const state = {
    user: null,
    me: null,
    root: false,
    profiles: [],
    channels: [],
    categories: [],
    messages: [],
    members: [],
    mentions: {},
    room: null,
    reply: null,
    edit: null,
    mode: "channels",
    rules: [],
    history: [],
    bots: [],
    suggestions: [],
    suggestion: 0,
    older: true,
    loading: false,
    gate: null,
    timeout: null,
  };
  let client = null,
    live = null,
    refreshTimer = null,
    poll = null,
    modalReturnFocus = null,
    searchTimer = null,
    roomRequest = 0;
  const embedCache = new Map();
  let slowmode = { seconds: 0, bypass: false, until: 0 },
    sending = false;
  const signedMedia = new Map();
  let passwordRecovery = false;
  let pendingRegistration = null;
  let social = null;
  let profilePopup = null,
    followMessages = true,
    scrollFrame = 0;
  const messageResize = window.ResizeObserver
    ? new ResizeObserver(() => {
        if (followMessages) scrollBottom();
      })
    : null;
  const demoId = "00000000-0000-4000-8000-000000000001";
  function toast(message, error = false) {
    const el = document.createElement("div");
    el.className = "toast" + (error ? " error" : "");
    el.textContent = message;
    $("toasts").append(el);
    setTimeout(() => el.remove(), 6000);
  }
  async function safe(fn) {
    try {
      return await fn();
    } catch (e) {
      toast(e.message || String(e), true);
      console.error(e);
    }
  }
  async function checked(q) {
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  function avatar(p, size = "") {
    const url = https(p?.avatar_url);
    const tint = ["#7774d8", "#628f94", "#aa718a", "#9571b8", "#b4895b"][
      [...(p?.id || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % 5
    ];
    return url
      ? `<img class="avatar ${size}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="avatar ${size}" style="background:linear-gradient(135deg,${tint},#34364d)">${esc((p?.display_name || p?.username || "?").slice(0, 2).toUpperCase())}</span>`;
  }
  function profile(id) {
    return (
      state.profiles.find((p) => p.id === id) || {
        id,
        username: "unknown",
        display_name: "Unknown member",
        roles: [],
      }
    );
  }
  function staff() {
    return state.root || (state.me?.roles || []).length > 0;
  }
  function admin() {
    return state.root || (state.me?.roles || []).some((r) => r !== "Moderator");
  }
  function channel() {
    return state.channels.find((c) => c.id === state.room);
  }
  function channelName(ch) {
    if (ch?.kind !== "dm") return ch?.name || "channel";
    const ids = state.members
      .filter((m) => m.channel_id === ch.id && m.user_id !== state.me.id)
      .map((m) => m.user_id);
    return (
      ids.map((id) => profile(id).display_name).join(", ") || "Direct message"
    );
  }
  async function rpc(action, payload = {}) {
    if (preview) return demoAction(action, payload);
    return checked(client.rpc("chat_action", { action, payload }));
  }
  async function query(table, options = {}) {
    if (preview) return demoQuery(table, options);
    const rows = [];
    const keys = {
      cb_channel_members: ["channel_id", "user_id"],
      cb_overwrites: ["channel_id", "subject", "permission"],
    };
    for (let offset = 0; ; offset += 500) {
      let q = client.from(table).select(options.select || "*");
      if (options.eq)
        for (const [k, v] of Object.entries(options.eq)) q = q.eq(k, v);
      if (options.order)
        q = q.order(options.order, {
          ascending: options.ascending ?? true,
          nullsFirst: false,
        });
      for (const key of keys[table] || ["id"])
        if (key !== options.order) q = q.order(key);
      const page = await checked(q.range(offset, offset + 499));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function edge(body) {
    if (preview) {
      if (body.action === "embed")
        return {
          url: body.url,
          title: "A link worth sharing",
          description:
            "Link previews appear here when the metadata service is connected.",
          site_name: new URL(body.url).hostname,
        };
      throw new Error(
        "Connect the Supabase function to use live GIF search or email invitations.",
      );
    }
    const { data, error } = await client.functions.invoke(cfg.functionName, {
      body,
    });
    if (error) {
      let message = error.message;
      try {
        const detail = await error.context.json();
        message = detail.error || message;
      } catch {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function modal(title, body, footer = "", subtitle = "") {
    window.ChatUI?.closeAll();
    modalReturnFocus = document.activeElement;
    $("modalContent").innerHTML =
      `<header class="modal-heading"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-button" data-close aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}`;
    if (!$("modal").open) $("modal").showModal();
  }
  function closeModal() {
    $("modal").close();
    modalReturnFocus?.focus?.();
  }
  function field(name, label, value = "", type = "text", extra = "") {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  }
  function area(name, label, value = "", note = "") {
    return `<label>${label}<textarea name="${name}">${esc(value)}</textarea></label>${note ? `<p class="small-note">${note}</p>` : ""}`;
  }
  function values(form) {
    return Object.fromEntries(new FormData(form));
  }
  function lines(s) {
    return String(s || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  function phrases(value) {
    return [
      ...new Set(
        String(value || " ")
          .split(/[,\r\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  }
  function rolePills(p, editable = false) {
    return (p.roles || [])
      .map(
        (r) =>
          `<span class="role-pill">${esc(r)}${editable ? `<button data-remove-role="${esc(r)}" data-user="${p.id}" aria-label="Remove ${esc(r)} role">×</button>` : ""}</span>`,
      )
      .join("");
  }
  function formSave(id, fn) {
    $(id).onsubmit = (e) => {
      e.preventDefault();
      safe(async () => {
        const b = e.target.querySelector("[type=submit]");
        b.disabled = true;
        try {
          await fn(values(e.target), e.target);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      });
    };
  }
  function select(name, label, options, value) {
    return `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  }
  function setConnected(text = "") {
    $("connectionState").hidden = !text;
    $("connectionState").textContent = text;
  }
  function setAuth() {
    social?.closeThread();
    window.ChatUI?.closeAll();
    state.user = null;
    state.me = null;
    $("appView").hidden = true;
    $("authView").hidden = false;
    if (live) client?.removeChannel(live);
    clearInterval(poll);
    if ($("moderationGate").open) $("moderationGate").close();
  }
  function authSetup() {
    if (register) {
      document.title = "Create an account · CHATBOX";
      $("authTitle").textContent = "Create an account.";
      $("authSubtitle").textContent = "Your people are one conversation away.";
      $("registrationFields").hidden = false;
      $("username").required = true;
      $("password").autocomplete = "new-password";
      $("authSubmit").innerHTML = "Create Account <span>→</span>";
      $("authSwitch").innerHTML =
        'Already have an account? <a href="/external/chat.html">Log in</a>';
      $("authNote").textContent =
        "Use an email-shaped address. It does not have to be a real inbox; you can change your password in settings.";
    }
    $("togglePassword").onclick = () => {
      const show = $("password").type === "password";
      $("password").type = show ? "text" : "password";
      $("togglePassword").textContent = show ? "Hide" : "Show";
      $("togglePassword").setAttribute(
        "aria-label",
        show ? "Hide password" : "Show password",
      );
    };
    $("authForm").onsubmit = async (e) => {
      e.preventDefault();
      $("authError").textContent = "";
      $("authSubmit").disabled = true;
      try {
        if (!client)
          throw new Error(
            "Could not load the connection library. Please refresh.",
          );
        const email = $("email").value.trim(),
          password = $("password").value;
        let result;
        if (register && pendingRegistration) {
          result = { data: { session: { user: pendingRegistration } } };
        } else if (register) {
          result = await client.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name:
                  $("displayName").value.trim() || $("username").value.trim(),
              },
            },
          });
        } else
          result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (!result.data.session) {
          $("authError").textContent =
            "This Supabase project still requires email confirmation. Ask root to disable confirmation to allow made-up email addresses.";
          return;
        }
        if (register) {
          pendingRegistration = result.data.session.user;
          $("email").disabled = true;
          $("password").disabled = true;
          $("authSubmit").textContent = "Finish Account";
          await rpc("bootstrap");
          await rpc("profile", {
            username: $("username").value.toLowerCase().trim(),
            display_name:
              $("displayName").value.trim() || $("username").value.trim(),
          });
          location.replace("/external/chat.html");
        } else await start(result.data.session.user);
      } catch (e) {
        $("authError").textContent = pendingRegistration
          ? "Your account was created. Update the profile details below and try again: " +
            e.message
          : e.message;
      } finally {
        $("authSubmit").disabled = false;
      }
    };
  }
  async function start(user) {
    state.user = user;
    const boot = await rpc("bootstrap");
    state.me = boot.profile;
    state.root = boot.root;
    await refreshGate();
    if (state.gate) return;
    $("authView").hidden = true;
    $("appView").hidden = false;
    await refresh();
    const wanted = decodeURIComponent(location.hash.slice(1));
    await openChannel(
      state.channels.some((c) => c.id === wanted)
        ? wanted
        : state.channels.find((c) => c.kind !== "dm" && c.kind !== "thread")
            ?.id,
    );
    subscribe();
    if (
      passwordRecovery ||
      (new URLSearchParams(location.search).has("invited") && user.invited_at)
    )
      setInitialPassword();
  }
  async function refresh() {
    const results = await Promise.all([
      query("cb_profiles", { order: "display_name" }),
      query("cb_channels", { order: "sort_order" }),
      query("cb_categories", { order: "sort_order" }),
      query("cb_channel_members"),
    ]);
    [state.profiles, state.channels, state.categories, state.members] = results;
    state.categories = state.categories.filter((c) => !c.deleted_at);
    state.profiles = state.profiles.map((p) => ({
      ...p,
      account_display_name: p.display_name,
      display_name: p.nickname || p.display_name,
    }));
    state.me = profile(state.user.id);
    state.mentions = preview
      ? state.mentions
      : await checked(client.rpc("chat_mentions"));
    renderSidebar();
    renderMembers();
    $("selfProfile").innerHTML =
      `${avatar(state.me)}<span><b>${esc(state.me.display_name)}</b><small>${esc(state.me.status || "Ready to chat")}</small></span>`;
    $("adminButton").hidden = !staff();
    $("addChannel").hidden = !admin();
    if (state.room && !state.channels.some((c) => c.id === state.room)) {
      state.room = null;
      state.messages = [];
      renderMessages();
      await openChannel(state.channels[0]?.id);
    }
  }
  function renderSidebar() {
    const list = state.channels.filter((c) =>
      state.mode === "dm"
        ? c.kind === "dm"
        : c.kind !== "dm" && c.kind !== "thread",
    );
    $("sidebarHeading").textContent =
      state.mode === "dm" ? "DIRECT MESSAGES" : "YOUR CHANNELS";
    let html = "";
    const groups =
      state.mode === "dm"
        ? [{ id: null, name: "Your conversations" }]
        : [{ id: null, name: "Text channels" }, ...state.categories];
    for (const group of groups) {
      const items = list.filter(
        (c) => state.mode === "dm" || (c.category_id || null) === group.id,
      );
      if (!items.length && !group.id) continue;
      html += `<div class="category-heading">⌄ ${esc(group.name.toUpperCase())}</div>`;
      for (const ch of items) {
        const n =
          (state.mentions[ch.id] || 0) +
          state.channels
            .filter((c) => c.parent_id === ch.id)
            .reduce((n, c) => n + (state.mentions[c.id] || 0), 0);
        html += `<button class="channel-link ${ch.id === state.room ? "active" : ""}" data-channel="${esc(ch.id)}"><span class="channel-symbol">${channelIcon(ch)}</span><span class="name">${esc(channelName(ch))}</span>${n ? `<span class="badge" aria-label="${n} mentions">${n > 99 ? "99+" : n}</span>` : ""}</button>`;
      }
    }
    $("channelList").innerHTML =
      html ||
      `<div class="empty-state">${state.mode === "dm" ? "Open a member’s profile to start a conversation." : "No channels available."}</div>`;
  }
  function renderMembers() {
    const people =
      channel()?.kind === "dm"
        ? state.profiles.filter((p) =>
            state.members.some(
              (m) => m.channel_id === state.room && m.user_id === p.id,
            ),
          )
        : state.profiles;
    $("memberCount").textContent = people.length;
    $("memberList").innerHTML = people
      .map(
        (p) =>
          `<button class="member-row ${p.roles?.length ? "staff" : ""}" data-profile="${p.id}">${avatar(p)}<span><b>${esc(p.display_name)}${p.is_bot ? '<span class="bot-label">APP</span>' : ""}</b><small>${esc(p.status || p.roles?.[0] || "@" + p.username)}</small></span></button>`,
      )
      .join("");
  }
  function channelIcon(ch) {
    return window.ChatIcons(
      ch.kind === "dm"
        ? "dm"
        : ch.is_private
          ? "channel-private"
          : ch.kind === "announcement"
            ? "announcement"
            : "channel",
    );
  }
  async function openChannel(id) {
    if (state.channels.find((c) => c.id === id)?.kind === "thread" && social)
      return social.openThread(id);
    if (!id) {
      state.room = null;
      renderMessages();
      $("channelTitle").textContent = "Your conversations";
      $("channelTopic").textContent = "Choose an existing channel";
      $("messageText").placeholder = "Choose a channel";
      return;
    }
    const request = ++roomRequest;
    state.room = id;
    state.reply = null;
    state.edit = null;
    state.older = true;
    $("replyBar").hidden = true;
    $("blockedNotice").hidden = true;
    $("searchMessages").value = "";
    const ch = channel();
    if (!ch) return;
    if (ch.kind === "dm") state.mode = "dm";
    else state.mode = "channels";
    location.hash = id;
    $("channelTitle").textContent = channelName(ch);
    $("channelTopic").textContent =
      ch.topic ||
      (ch.kind === "dm"
        ? "Just between you."
        : ch.is_private
          ? "A private place for your group."
          : "A place to say hello, share, and stay connected.");
    $("channelIcon").innerHTML = channelIcon(ch);
    $("messageText").placeholder =
      `Message ${ch.kind === "dm" ? "@" : "#"}${channelName(ch)}`;
    $("channelSettingsButton").hidden =
      ch.kind === "dm" || (!admin() && ch.created_by !== state.me.id);
    $("appView").classList.remove("show-channels");
    state.messages = [];
    renderSidebar();
    renderMembers();
    $("messages").innerHTML =
      '<div class="empty-state">Loading conversation…</div>';
    const messages = await loadMessages(id);
    if (request !== roomRequest) return;
    state.messages = messages;
    await refreshSlowmode(id);
    renderMessages();
    scrollBottom();
    await rpc("read", { channel_id: id });
    state.mentions[id] = 0;
    renderSidebar();
    social?.onChannel();
  }
  async function loadMessages(id, before) {
    if (preview) return state.demoMessages.filter((m) => m.room === id);
    let q = client
      .from("cb_messages")
      .select("*")
      .eq("room", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(60);
    if (before)
      q = q.or(
        `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
      );
    const rows = await checked(q);
    state.older = rows.length === 60;
    return signMedia(rows.reverse());
  }
  function messageHTML(m) {
    if (m.automod_event && !m.deleted) return automodMessage(m);
    const p = profile(m.user_id),
      parent = state.messages.find((x) => x.id === m.reply_to),
      ping = m.text?.includes(`<@${state.me.id}>`);
    return `<article class="message ${ping ? "pinged" : ""}" id="message-${esc(m.id)}">${m.reply_to ? `<div class="reply-context" data-jump="${esc(m.reply_to)}">${parent ? `${avatar(profile(parent.user_id))}<b>${esc(profile(parent.user_id).display_name)}</b> ${esc(parent.deleted ? "Message deleted" : parent.text.slice(0, 90))}` : "↳ Reply to an earlier message"}</div>` : ""}<button class="text-button" data-profile="${p.id}" aria-label="View ${esc(p.display_name)} profile">${avatar(p)}</button><div><div><button class="message-author ${p.roles?.length ? "staff" : ""}" data-profile="${p.id}">${esc(p.display_name)}</button>${p.is_bot ? '<span class="bot-label">APP</span>' : ""}<time datetime="${esc(m.created_at)}" title="${esc(new Date(m.created_at).toLocaleString())}">${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>${m.edited_at ? '<small class="muted"> (edited)</small>' : ""}</div><div class="body">${m.deleted ? '<i class="muted">Message deleted</i>' : m.poll_id ? "" : m.thread_id ? "Started a thread" : C.render(m.text, state.profiles, state.channels)}</div>${!m.deleted ? attachmentHTML(m) + C.embeds(m.embeds || [], state.profiles, state.channels) + (social?.messageExtra(m) || "") : ""}<div class="embeds" data-embeds="${esc(m.id)}"></div></div>${!m.deleted ? `<div class="message-actions">${channel()?.kind !== "dm" ? `<button data-create-thread="${esc(m.id)}" title="Create thread">≋ Thread</button>` : ""}<button data-reply="${esc(m.id)}" title="Reply">↩ Reply</button>${m.user_id === state.me.id && !m.poll_id && !m.thread_id ? `<button data-edit="${esc(m.id)}">Edit</button>` : ""}${m.user_id === state.me.id || staff() ? `<button data-delete="${esc(m.id)}">Delete</button>` : ""}</div>` : ""}</article>`;
  }
  function attachmentHTML(m) {
    const url = https(m.resolved_url || m.image_url);
    if (!url) return "";
    const path = new URL(url).pathname.toLowerCase();
    if (
      /\.(png|jpe?g|gif|webp|avif)$/.test(path) ||
      /giphy\.com$/.test(new URL(url).hostname)
    )
      return `<img class="attachment-img" src="${esc(url)}" alt="${esc(m.attachment_name || "Image attachment")}" loading="lazy" referrerpolicy="no-referrer">`;
    if (/\.(mp4|webm|mov)$/.test(path))
      return `<video class="attachment-video" src="${esc(url)}" controls preload="metadata"></video>`;
    if (/\.(mp3|wav|ogg|m4a)$/.test(path))
      return `<chat-audio src="${esc(url)}" filename="${esc(m.attachment_name || new URL(url).pathname.split("/").pop())}" bytes="${Number(m.attachment_bytes) || 0}"></chat-audio>`;
    return `<a class="attachment-file" href="${esc(url)}" target="_blank" rel="noopener noreferrer">↓ ${esc(m.attachment_name || "Download attachment")}</a>`;
  }
  function renderMessages() {
    const priorIds = new Set(
      [...$("messages").querySelectorAll(".message")].map((el) => el.id),
    );
    const audioNodes = new Map(
      [...document.querySelectorAll("chat-audio")].map((el) => [
        el.getAttribute("src"),
        el,
      ]),
    );
    const ch = channel();
    if (!ch) {
      $("messages").innerHTML =
        '<div class="empty-state">Choose a conversation to get started.</div>';
      return;
    }
    const filter = $("searchMessages").value.toLowerCase();
    const messages = state.messages.filter(
      (m) => !filter || m.text?.toLowerCase().includes(filter),
    );
    let html =
      state.older && !preview
        ? '<button class="load-older" id="loadOlder">Load earlier messages</button>'
        : "";
    if (!filter)
      html += `<section class="channel-welcome"><div class="welcome-icon">${ch.kind === "dm" ? "↗" : "#"}</div><div class="eyebrow">${ch.kind === "dm" ? "A CONVERSATION, JUST FOR YOU" : "YOU’RE IN GOOD COMPANY"}</div><h2>${ch.kind === "dm" ? esc(channelName(ch)) : `Welcome to #${esc(ch.name)}.`}</h2><p>${esc(ch.topic || "This is the beginning of something good. Start a conversation.")}</p></section>`;
    let date = "";
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      if (d !== date) {
        html += `<div class="date-divider">${esc(d)}</div>`;
        date = d;
      }
      html += messageHTML(m);
    }
    $("messages").innerHTML = '<div class="message-content">' + html + "</div>";
    social?.decorate();
    messageResize?.disconnect();
    messageResize?.observe($("messages").firstElementChild);
    $("messages")
      .querySelectorAll(".message")
      .forEach((el) => {
        if (!priorIds.has(el.id)) el.classList.add("message-enter");
      });
    document.querySelectorAll("chat-audio").forEach((el) => {
      const old = audioNodes.get(el.getAttribute("src"));
      if (old) el.replaceWith(old);
    });
    if ($("loadOlder"))
      $("loadOlder").onclick = () =>
        safe(async () => {
          const room = state.room,
            oldHeight = $("messages").scrollHeight,
            rows = await loadMessages(room, state.messages[0]);
          if (room !== state.room) return;
          state.messages = [...rows, ...state.messages];
          renderMessages();
          $("messages").scrollTop = $("messages").scrollHeight - oldHeight;
        });
    hydrateEmbeds();
  }
  async function hydrateEmbeds() {
    const room = state.room;
    for (const m of state.messages.slice(-60)) {
      if (m.deleted) continue;
      const urls = [
        ...new Set((m.text || "").match(/https:\/\/[^\s<>]+/g) || []),
      ].slice(0, 3);
      for (const raw of urls) {
        const url = raw.replace(/[).,!?]+$/, "");
        if (!https(url)) continue;
        try {
          if (!embedCache.has(url))
            embedCache.set(
              url,
              edge({ action: "embed", url }).catch(() => ({
                url,
                title: new URL(url).hostname,
                site_name: new URL(url).hostname,
              })),
            );
          const data = await embedCache.get(url);
          if (state.room !== room) return;
          const host = document.querySelector(
            `[data-embeds="${CSS.escape(m.id)}"]`,
          );
          if (!host || host.querySelector(`[data-url="${CSS.escape(url)}"]`))
            continue;
          const el = document.createElement("div");
          el.className = "link-embed";
          el.dataset.url = url;
          el.innerHTML = `<small>${esc(data.site_name || new URL(url).hostname)}</small><a href="${esc(https(data.url) || url)}" target="_blank" rel="noopener noreferrer">${esc(data.title || url)}</a>${data.description ? `<p>${esc(data.description.slice(0, 250))}</p>` : ""}${https(data.image) ? `<img src="${esc(https(data.image))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}`;
          host.append(el);
        } catch {}
      }
    }
  }
  function scrollBottom() {
    followMessages = true;
    const room = state.room;
    cancelAnimationFrame(scrollFrame);
    $("messages").scrollTop = $("messages").scrollHeight;
    scrollFrame = requestAnimationFrame(() => {
      if (state.room === room && followMessages)
        $("messages").scrollTop = $("messages").scrollHeight;
    });
  }
  function subscribe() {
    if (preview) return;
    if (live) client.removeChannel(live);
    live = client
      .channel("chatbox-" + state.user.id)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (payload.table === "cb_reads") return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => safe(sync), 350);
      })
      .subscribe((status) => {
        setConnected(
          status === "SUBSCRIBED"
            ? ""
            : "Reconnecting… your messages will refresh automatically.",
        );
      });
    clearInterval(poll);
    poll = setInterval(() => {
      if (document.visibilityState === "visible") safe(sync);
    }, 20000);
  }
  async function sync() {
    if (!state.user || state.loading) return;
    state.loading = true;
    try {
      await refreshGate();
      if (state.gate) return;
      await refresh();
      if (state.room) {
        await refreshSlowmode();
        const room = state.room,
          nearBottom =
            $("messages").scrollHeight -
              $("messages").scrollTop -
              $("messages").clientHeight <
            120;
        const fresh = await loadMessages(room);
        if (room !== state.room) return;
        const map = new Map(state.messages.map((m) => [m.id, m]));
        fresh.forEach((m) => map.set(m.id, m));
        state.messages = [...map.values()].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
        const oldTop = $("messages").scrollTop;
        renderMessages();
        if (followMessages || nearBottom) scrollBottom();
        else $("messages").scrollTop = oldTop;
        if (document.hasFocus()) {
          await rpc("read", { channel_id: room });
          state.mentions[room] = 0;
          renderSidebar();
        }
      }
      await social?.refresh();
    } finally {
      state.loading = false;
    }
  }
  async function refreshSlowmode(id = state.room) {
    if (!id) return;
    const status = await rpc("channel_status", { channel_id: id });
    if (state.room !== id) return;
    slowmode = {
      seconds: Number(status.seconds) || 0,
      bypass: !!status.bypass,
      until: Date.now() + (Number(status.retry_after) || 0) * 1000,
    };
    $("channelSettingsButton").hidden =
      channel()?.kind === "dm" || !slowmode.bypass;
    renderSlowmode();
  }
  function renderSlowmode() {
    const seconds = Math.max(
        0,
        Math.ceil((slowmode.until - Date.now()) / 1000),
      ),
      waiting = seconds > 0 && !slowmode.bypass && !state.edit;
    const el = $("slowmodeStatus");
    el.hidden = !slowmode.seconds;
    el.classList.toggle("waiting", waiting);
    el.textContent = "◷ " + (waiting ? seconds : slowmode.seconds) + "s";
    el.title = waiting
      ? "You can send again in " + seconds + " seconds"
      : slowmode.bypass
        ? "Slowmode: " + slowmode.seconds + " seconds. You can bypass slowmode."
        : "Slowmode: " + slowmode.seconds + " seconds between messages";
    el.setAttribute("aria-label", el.title);
    $("sendButton").disabled =
      sending || waiting || !state.room || isTimedOut();
  }
  setInterval(() => {
    if (state.me && !document.hidden) {
      renderSlowmode();
      renderTimeout();
    }
  }, 500);
  function isTimedOut() {
    return (
      !!state.timeout &&
      new Date(state.timeout.expires_at).getTime() > Date.now()
    );
  }
  function renderTimeout() {
    let bar = $("timeoutBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "timeoutBar";
      bar.className = "timeout-bar";
      bar.setAttribute("role", "status");
      $("messageForm").before(bar);
    }
    const muted = isTimedOut();
    bar.hidden = !muted;
    $("messageForm").hidden = muted;
    for (const id of [
      "messageText",
      "attachButton",
      "gifButton",
      "emojiButton",
    ])
      $(id).disabled = muted;
    if (muted) {
      const n = Math.max(
        0,
        Math.ceil((new Date(state.timeout.expires_at) - Date.now()) / 1000),
      );
      const d = Math.floor(n / 86400),
        h = Math.floor((n % 86400) / 3600),
        m = Math.floor((n % 3600) / 60);
      bar.innerHTML =
        '<span class="timeout-symbol">◷</span><div><b>Timed Out</b><small>You cannot chat, reply, or vote during this timeout.</small></div><strong>' +
        [d + "d", h + "h", m + "m", (n % 60) + "s"].join(" ") +
        "</strong>";
    }
  }
  function automodMessage(m) {
    const e = m.automod_event,
      p = profile(e.user_id),
      ch = state.channels.find((c) => c.id === e.channel_id);
    return (
      '<article class="automod-log" id="message-' +
      esc(m.id) +
      '"><span class="automod-avatar">' +
      window.ChatIcons("shield") +
      '</span><div><header><b>AutoMod</b> <span class="bot-label">✓ SYSTEM</span> has blocked a message in <button class="mention" data-channel="' +
      esc(e.channel_id) +
      '"># ' +
      esc(ch?.name || "channel") +
      "</button> <time>" +
      esc(
        new Date(m.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      ) +
      '</time></header><div class="automod-evidence">' +
      avatar(p) +
      '<div><button class="message-author" data-profile="' +
      esc(p.id) +
      '">' +
      esc(p.display_name) +
      "</button><blockquote>" +
      esc(e.content) +
      "</blockquote><small>Matched: " +
      esc(e.matched) +
      " · Rule: " +
      esc(e.rule) +
      " · " +
      esc(
        e.actions?.length
          ? e.actions.map((x) => (x === "timeout" ? "Mute" : x)).join(", ")
          : "Message blocked",
      ) +
      (e.expires_at
        ? " · Until " + esc(new Date(e.expires_at).toLocaleString())
        : "") +
      '</small></div></div><footer><button class="text-button" data-moderate="' +
      esc(p.id) +
      '">Actions</button> · <button class="text-button" data-channel="' +
      esc(e.channel_id) +
      '">Go to channel</button></footer></div></article>'
    );
  }
  async function signMedia(rows) {
    await Promise.all(
      rows.map(async (m) => {
        if (!m.image_url?.startsWith("cb-media:")) return;
        const path = m.image_url.slice(9),
          old = signedMedia.get(path);
        if (old && old.until > Date.now()) {
          m.resolved_url = old.url;
          return;
        }
        const { data, error } = await client.storage
          .from("chatbox-private")
          .createSignedUrl(path, 300);
        if (!error) {
          m.resolved_url = data.signedUrl;
          signedMedia.set(path, {
            url: data.signedUrl,
            until: Date.now() + 240000,
          });
        }
      }),
    );
    return rows;
  }
  async function upload(file, isAvatar = false) {
    if (file.size > 12 * 1024 * 1024)
      throw new Error("Please keep attachments below 12 MB.");
    if (preview) throw new Error("File uploads need a connected account.");
    const ext =
      file.name
        .split(".")
        .pop()
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 12) || "bin";
    const path = `${state.me.id}/${isAvatar ? "avatar" : state.room}/${crypto.randomUUID()}.${ext}`;
    const bucket = isAvatar ? "chat-media" : "chatbox-private";
    await checked(
      client.storage
        .from(bucket)
        .upload(path, file, { cacheControl: "3600", upsert: false }),
    );
    return isAvatar
      ? client.storage.from(bucket).getPublicUrl(path).data.publicUrl
      : "cb-media:" + path;
  }
  async function sendMessage(imageUrl = null, name = null) {
    if (!state.room || sending) return;
    const sendRoom = state.room,
      editId = state.edit,
      replyId = state.reply?.id || null;
    if (!state.edit && !slowmode.bypass && slowmode.until > Date.now()) {
      renderSlowmode();
      toast("Slowmode is active. Your draft is saved.");
      return;
    }
    let text = $("messageText").value.trim();
    const file = $("attachment").files[0];
    if (!text && !file && !imageUrl) return;
    if (text.startsWith("/") && !state.edit) {
      const command = text.split(/\s/)[0],
        arg = text.slice(command.length).trim();
      if (command === "/clear") {
        $("messageText").value = "";
        return;
      }
      if (command === "/settings") {
        openSettings();
        $("messageText").value = "";
        return;
      }
      if (command === "/admin") {
        await openAdmin();
        $("messageText").value = "";
        return;
      }
      if (command === "/help") {
        showHelp();
        $("messageText").value = "";
        return;
      }
      if (command === "/me") text = "*" + arg + "*";
      else if (command === "/shrug") text = arg + " ¯\\_(ツ)_/¯";
      else {
        const suggestions = C.suggest(command);
        if (suggestions.length) {
          updateSuggestions();
          toast("Choose the suggested command, or remove / to send as text.");
          return;
        }
        throw new Error(
          "Unknown command. Use /help to see available commands.",
        );
      }
    }
    sending = true;
    $("sendButton").disabled = true;
    try {
      if (file) {
        imageUrl = await upload(file);
        if (
          /\.(luau?|[cm]?js|jsx|tsx?|cpp|cc|cs|py|json|css|html|sql|sh)$/i.test(
            file.name,
          ) &&
          file.size < 14000
        ) {
          const code = await file.text();
          text +=
            "\n\n" +
            String.fromCharCode(96).repeat(3) +
            file.name +
            "\n" +
            code.replaceAll(
              String.fromCharCode(96).repeat(3),
              String.fromCharCode(96, 8203, 96, 96),
            ) +
            "\n" +
            String.fromCharCode(96).repeat(3);
        }
      }
      const result = await rpc(editId ? "edit" : "send", {
        id: editId,
        channel_id: sendRoom,
        text,
        image_url: imageUrl,
        attachment_name: name || file?.name,
        attachment_bytes: file?.size,
        reply_to: replyId,
      });
      if (state.room !== sendRoom) {
        toast(
          result?.message || "Message sent to the previous channel",
          !!result?.blocked,
        );
        return;
      }
      if (result?.slowmode) {
        slowmode.until = Date.now() + result.retry_after * 1000;
        renderSlowmode();
        toast(result.message);
        return;
      }
      if (result?.blocked) {
        await refreshGate();
        $("blockedNotice").hidden = false;
        $("blockedNotice").innerHTML =
          `<strong>⛨ This content is blocked by this server.</strong><p>From server moderators: “${esc(result.message)}”</p><small>Only you can see this · </small><button class="text-button" data-dismiss-block>Dismiss message</button>`;
        return;
      }
      $("blockedNotice").hidden = true;
      $("messageText").value = "";
      $("messageText").style.height = "auto";
      $("attachment").value = "";
      $("attachmentLabel").textContent =
        "Make yourself at home. Say something.";
      state.reply = null;
      state.edit = null;
      $("replyBar").hidden = true;
      $("autocomplete").hidden = true;
      if (result?.id) {
        const delivered = (await signMedia([result]))[0];
        const index = state.messages.findIndex((m) => m.id === delivered.id);
        if (index < 0) state.messages.push(delivered);
        else state.messages[index] = delivered;
        renderMessages();
      }
      scrollBottom();
      await sync();
      await refreshSlowmode();
      scrollBottom();
    } finally {
      sending = false;
      renderSlowmode();
    }
  }
  function updateSuggestions() {
    const input = $("messageText");
    state.suggestions = C.suggest(
      input.value.slice(0, input.selectionStart),
      state.profiles,
      state.channels.filter((c) => c.kind !== "dm"),
    );
    state.suggestion = 0;
    renderSuggestions();
    input.style.height = "auto";
    input.style.height = Math.min(150, input.scrollHeight) + "px";
  }
  function renderSuggestions() {
    $("autocomplete").hidden = !state.suggestions.length;
    $("autocomplete").innerHTML = state.suggestions
      .map(
        (s, i) =>
          `<button class="suggestion ${i === state.suggestion ? "selected" : ""}" role="option" aria-selected="${i === state.suggestion}" data-suggest="${i}"><b>${esc(s.name)}</b><small>${esc(s.description || "")}</small></button>`,
      )
      .join("");
  }
  function applySuggestion(i) {
    const s = state.suggestions[i],
      t = $("messageText"),
      pos = t.selectionStart;
    if (!s) return;
    t.setRangeText(s.value, pos - s.length, pos, "end");
    state.suggestions = [];
    $("autocomplete").hidden = true;
    t.focus();
  }
  function replyTo(id, edit = false) {
    const m = state.messages.find((m) => m.id === id);
    if (!m) return;
    state.reply = edit ? null : m;
    state.edit = edit ? id : null;
    if (edit) $("messageText").value = m.text;
    $("replyBar").hidden = false;
    $("replyBar").innerHTML =
      `<span>${edit ? "Editing your message" : "Replying to <b>" + esc(profile(m.user_id).display_name) + "</b>"}</span><button class="text-button" data-cancel-reply aria-label="Cancel reply">×</button>`;
    $("messageText").focus();
  }
  async function showProfile(id, anchor = null, full = false) {
    const p = profile(id);
    profilePopup?.close();
    if (!full && window.ChatUI) {
      const el = document.createElement("article");
      el.className = "profile-card profile-popout";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", p.display_name + " profile");
      el.innerHTML = `<div class="profile-banner" style="background-color:${/^#[0-9a-f]{6}$/i.test(p.banner_color) ? p.banner_color : "#5865f2"}"></div><button class="profile-popout-close icon-button" aria-label="Close profile">×</button><div class="profile-inner">${avatar(p)}<h2>${esc(p.display_name)}${p.is_bot ? '<span class="bot-label">APP</span>' : ""}</h2><small class="muted">${esc(p.username)}${p.pronouns ? " · " + esc(p.pronouns) : ""}</small>${p.status ? `<p class="profile-status">● ${esc(p.status)}</p>` : ""}<p class="profile-bio profile-bio-preview">${esc(p.bio || "This member hasn’t written a bio yet.")}</p><button class="text-button profile-expand">View Full Profile</button><div class="profile-role-list">${rolePills(p)}</div><div class="profile-actions">${id === state.me.id ? '<button class="primary" data-profile-edit>Edit Profile</button>' : !p.is_bot ? '<button class="primary" data-profile-message>Message</button>' : ""}</div></div>`;
      const trigger = anchor || $("selfProfile");
      profilePopup = window.ChatUI.floating(el, trigger, () => {
        profilePopup = null;
      });
      el.querySelector(".profile-popout-close").onclick = () =>
        profilePopup?.close(true);
      el.querySelector(".profile-expand").onclick = () =>
        showProfile(id, trigger, true);
      el.querySelector("[data-profile-edit]")?.addEventListener("click", () => {
        profilePopup?.close();
        openSettings("profile");
      });
      el.querySelector("[data-profile-message]")?.addEventListener(
        "click",
        () =>
          safe(async () => {
            const dm = await rpc("dm", { user_id: id });
            profilePopup?.close();
            await refresh();
            await openChannel(dm.id);
          }),
      );
      return;
    }
    modal(
      "",
      `<article class="profile-card"><div class="profile-banner" style="background:${/^#[0-9a-f]{6}$/i.test(p.banner_color) ? p.banner_color : "#5865f2"}"></div><div class="profile-inner">${avatar(p)}<h2>${esc(p.display_name)}${p.is_bot ? '<span class="bot-label">APP</span>' : ""}</h2><small class="muted">${esc(p.username)} ${p.pronouns ? " · " + esc(p.pronouns) : ""}</small><div class="status-line">${p.status ? "● " + esc(p.status) : ""}</div><div>${rolePills(p, state.root)}</div><p class="profile-bio">${esc(p.bio || "This member hasn’t written a bio yet.")}</p>${state.root && !p.is_bot ? select("profileRole", "Add a role", [["", "Choose a role"], ...C.roles.map((r) => [r, r])], "") : ""}<div class="profile-actions">${id === state.me.id ? '<button class="primary" id="profileEdit">Edit profile</button>' : !p.is_bot ? '<button class="primary" id="profileMessage">Message</button>' : ""}${staff() && id !== state.me.id ? '<button class="secondary" id="profileModerate">Moderate</button>' : ""}</div></div></article>`,
    );
    if ($("profileEdit"))
      $("profileEdit").onclick = () => openSettings("profile");
    if ($("profileMessage"))
      $("profileMessage").onclick = () =>
        safe(async () => {
          const dm = await rpc("dm", { user_id: id });
          closeModal();
          await refresh();
          await openChannel(dm.id);
        });
    if ($("profileModerate"))
      $("profileModerate").onclick = () => moderationForm(id);
    const roleSelect = document.querySelector("[name=profileRole]");
    if (roleSelect)
      roleSelect.onchange = () =>
        safe(async () => {
          if (!roleSelect.value) return;
          await rpc("role", {
            user_id: id,
            role: roleSelect.value,
            remove: false,
          });
          await refresh();
          showProfile(id, anchor, true);
        });
  }
  function settingsFrame(tab, content) {
    modalReturnFocus = document.activeElement;
    $("modalContent").innerHTML =
      `<div class="settings-layout"><nav class="settings-nav"><small>USER SETTINGS</small>${[
        ["account", "My Account"],
        ["profile", "Profiles"],
        ["standing", "Account Standing"],
        ["appearance", "Appearance"],
        ["password", "Password"],
      ]
        .map(
          ([id, label]) =>
            `<button data-settings="${id}" class="${tab === id ? "active" : ""}">${label}</button>`,
        )
        .join(
          "",
        )}<button data-logout>Log Out</button><button data-close>← Back to chat</button></nav><section class="settings-content">${content}</section></div>`;
    if (!$("modal").open) $("modal").showModal();
  }
  async function openSettings(tab = "account") {
    const p = state.me;
    let html = "";
    if (tab === "account") {
      const email = state.user.email || "preview@example.com",
        masked = email.replace(/^(.)(.*)(@.*)$/, "$1********$3");
      html = `<h2>My Account</h2><div class="account-card"><div class="account-banner" style="background:${/^#[0-9a-f]{6}$/i.test(p.banner_color) ? p.banner_color : "#5865f2"}"></div><div class="account-person">${avatar(p)}<div><h3>${esc(p.display_name)}</h3>${rolePills(p)}</div></div></div><h3>Account Info</h3><div class="account-row"><div><b>Username</b><small>${esc(p.username)}</small></div><button class="secondary" data-settings="profile">Edit</button></div><div class="account-row"><div><b>Email</b><small><span id="maskedEmail">${esc(masked)}</span> <button class="text-button" id="revealEmail">Reveal</button></small></div><button class="secondary" id="editEmail">Edit</button></div><div class="account-row"><b>Password</b><button class="secondary" data-settings="password">Edit</button></div><button class="standing-row" data-settings="standing"><span class="standing-icon">✓</span><div><strong>Account Standing</strong><p>Review your moderation history and account status.</p></div><span>View →</span></button>`;
      settingsFrame(tab, html);
      $("revealEmail").onclick = () => {
        $("maskedEmail").textContent = email;
        $("revealEmail").hidden = true;
      };
      $("editEmail").onclick = () => {
        modal(
          "Change email",
          `<form id="emailForm">${field("email", "New email", email, "email", "required")}<p class="small-note">Supabase may send confirmation to your old and new addresses, depending on the project’s settings.</p><button class="primary" type="submit">Save email</button></form>`,
        );
        formSave("emailForm", async (v) => {
          if (preview) throw new Error("Email changes need a live account.");
          await checked(client.auth.updateUser({ email: v.email }));
          toast(
            "Email change submitted. Check whether confirmation is required.",
          );
          closeModal();
        });
      };
      return;
    }
    if (tab === "profile") {
      html = `<h2>Profiles</h2><form id="profileForm"><div class="field-row">${field("display_name", "Display name", p.account_display_name || p.display_name, "text", 'maxlength="64" required')}${field("username", "Username", p.username, "text", 'pattern="[a-z0-9_.-]{2,32}" required')}</div>${field("pronouns", "Pronouns", p.pronouns || "", "text", 'maxlength="60"')}${area("bio", "About me", p.bio || "")}${field("status", "Custom status", p.status || "", "text", 'maxlength="160"')}<div class="field-row">${field("banner_color", "Banner color", p.banner_color || "#5865f2", "color")}${field("avatar_url", "Avatar image URL", p.avatar_url || "", "url")}</div><label>Upload avatar<input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><p class="small-note">Make your profile feel like you.</p><button class="primary" type="submit">Save Changes</button></form>`;
    }
    if (tab === "password")
      html = `<h2>Change Password</h2><p class="muted">Use your current password to set a new one.</p><form id="passwordForm">${field("current", "Current password", "", "password", 'autocomplete="current-password" required')}${field("password", "New password", "", "password", 'autocomplete="new-password" minlength="8" required')}${field("confirm", "Confirm new password", "", "password", 'autocomplete="new-password" minlength="8" required')}<button class="primary" type="submit">Update Password</button></form>`;
    if (tab === "appearance")
      html = `<h2>Appearance</h2><h3>Motion</h3><label class="check-label"><input id="motionToggle" type="checkbox" ${localStorage.getItem("chatbox-reduce-motion") === "true" ? "checked" : ""}> Reduce animations</label><p class="small-note">Your device’s reduced-motion preference is always respected.</p><h3>Message display</h3><label class="check-label"><input id="compactToggle" type="checkbox" ${localStorage.getItem("chatbox-compact") === "true" ? "checked" : ""}> Compact messages</label><label class="check-label"><input id="memberToggle" type="checkbox" ${!$("appView").classList.contains("hide-members") ? "checked" : ""}> Show member sidebar on desktop</label><p class="small-note">Appearance settings are saved on this device.</p>`;
    if (tab === "standing") {
      state.history = await query("cb_moderation", {
        eq: { user_id: p.id },
        order: "created_at",
        ascending: false,
      });
      const active = state.history.filter(activeCase);
      html = `<h2>Account Standing</h2><div class="standing-row"><span class="standing-icon">${active.length ? "!" : "✓"}</span><div><strong>${active.length ? "Your account has active restrictions" : "All good"}</strong><p>${active.length ? "See the details below." : "Thank you for keeping CHATBOX welcoming."}</p></div></div><h3>Moderation history</h3>${historyHTML(state.history)}`;
    }
    settingsFrame(tab, html);
    if (tab === "password") {
      $("passwordForm").insertAdjacentHTML(
        "afterend",
        '<h3 style="margin-top:28px">Reset by email</h3><p class="small-note">Send a reset link to your account email. This requires an inbox you can access; made-up addresses cannot receive it.</p><button class="secondary" id="sendPasswordReset">Send Reset Link</button><p id="passwordResetStatus" class="small-note" role="status"></p>',
      );
      $("sendPasswordReset").onclick = async () => {
        const button = $("sendPasswordReset"),
          status = $("passwordResetStatus");
        button.disabled = true;
        try {
          if (preview)
            throw new Error("Password resets need a connected account.");
          await checked(
            client.auth.resetPasswordForEmail(state.user.email, {
              redirectTo: new URL("/external/chat.html", location.origin).href,
            }),
          );
          status.textContent =
            "Reset link requested. Check your inbox and spam folder.";
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    }
    if (tab === "profile")
      formSave("profileForm", async (v) => {
        const file = $("avatarUpload").files[0];
        if (file) {
          if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
            throw new Error("Choose a PNG, JPG, WebP, or GIF image.");
          v.avatar_url = await upload(file, true);
        }
        await rpc("profile", v);
        await refresh();
        toast("Profile saved");
      });
    if (tab === "password")
      formSave("passwordForm", async (v) => {
        if (preview) throw new Error("Password changes need a live account.");
        if (v.password !== v.confirm)
          throw new Error("The new passwords do not match.");
        const auth = await client.auth.signInWithPassword({
          email: state.user.email,
          password: v.current,
        });
        if (auth.error) throw new Error("Current password is incorrect.");
        await checked(client.auth.updateUser({ password: v.password }));
        $("passwordForm").reset();
        toast("Password updated");
      });
    if (tab === "appearance") {
      $("motionToggle").onchange = (e) => {
        document.body.classList.toggle("reduce-motion", e.target.checked);
        localStorage.setItem("chatbox-reduce-motion", e.target.checked);
      };
      $("compactToggle").onchange = (e) => {
        document.body.classList.toggle(
          "reduce-motion",
          localStorage.getItem("chatbox-reduce-motion") === "true",
        );
        document.body.classList.toggle("compact", e.target.checked);
        localStorage.setItem("chatbox-compact", e.target.checked);
      };
      $("memberToggle").onchange = (e) => {
        $("appView").classList.toggle("hide-members", !e.target.checked);
        localStorage.setItem("chatbox-hide-members", !e.target.checked);
      };
    }
  }
  function activeCase(x) {
    return (
      ["ban", "timeout", "warning"].includes(x.action) &&
      !x.revoked_at &&
      (!x.expires_at || new Date(x.expires_at) > new Date()) &&
      (x.action !== "warning" || !x.acknowledged_at)
    );
  }
  function historyHTML(rows) {
    return rows.length
      ? rows
          .map(
            (x) =>
              `<article class="history-card"><div class="rule-top"><b>${esc(x.action[0].toUpperCase() + x.action.slice(1))}</b><small class="muted">${esc(new Date(x.created_at).toLocaleString())}</small></div><p><b>Reason:</b> ${esc(x.reason)}</p>${x.note ? `<p><b>Moderator note:</b> ${esc(x.note)}</p>` : ""}${x.evidence ? `<p><b>Offensive item:</b> ${esc(x.evidence)}</p>` : ""}<small class="muted">${x.revoked_at ? "Revoked" : x.acknowledged_at ? "Acknowledged" : x.expires_at ? "Expires " + esc(new Date(x.expires_at).toLocaleString()) : x.action === "ban" ? "Permanent" : ""}</small></article>`,
          )
          .join("")
      : '<div class="empty-state">No moderation history. Keep it up.</div>';
  }
  async function refreshGate() {
    if (!state.user) return;
    const rows = await query("cb_moderation", {
      eq: { user_id: state.user.id },
      order: "created_at",
      ascending: false,
    });
    state.timeout =
      rows
        .filter((x) => x.action === "timeout" && activeCase(x))
        .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0] ||
      null;
    renderTimeout();
    const gate =
      rows.find((x) => x.action === "ban" && activeCase(x)) ||
      rows.find((x) => x.action === "warning" && activeCase(x));
    state.gate = gate;
    if (!gate) {
      if ($("moderationGate").open) $("moderationGate").close();
      return;
    }
    $("appView").hidden = true;
    if ($("modal").open) closeModal();
    const banned = gate.action === "ban";
    $("moderationGate").innerHTML =
      `<h1>${banned ? (gate.expires_at ? "Account suspended" : "Account banned") : "Warning"}</h1><div class="moderation-body"><p>Our moderators determined that activity on your account violated this community’s rules.</p><div class="moderation-detail"><h4>REVIEWED</h4><p>${esc(new Date(gate.created_at).toLocaleString())}</p><h4>MODERATOR NOTE</h4><p>${esc(gate.note || "Please follow the community rules.")}</p><h4>REASON</h4><p>${esc(gate.reason)}</p>${gate.evidence ? `<h4>OFFENSIVE ITEM</h4><p>${esc(gate.evidence)}</p>` : ""}${gate.expires_at ? `<h4>REACTIVATION</h4><p>${esc(new Date(gate.expires_at).toLocaleString())}</p>` : ""}</div><div class="moderation-buttons">${!banned ? '<label class="check-label"><input id="agreeWarning" type="checkbox"> I understand and will follow the community rules.</label><button class="primary" id="ackWarning" disabled>Re-activate My Account</button>' : '<button class="secondary" id="checkRestriction">Check account status</button>'}<button class="secondary" data-logout>Log Out</button></div></div>`;
    if (!$("moderationGate").open) $("moderationGate").showModal();
    if (!banned) {
      $("agreeWarning").onchange = (e) =>
        ($("ackWarning").disabled = !e.target.checked);
      $("ackWarning").onclick = () =>
        safe(async () => {
          await rpc("acknowledge", { id: gate.id });
          await start(state.user);
        });
    } else $("checkRestriction").onclick = () => safe(() => start(state.user));
  }
  async function announcements() {
    const rows = await query("cb_announcements", {
      order: "created_at",
      ascending: false,
    });
    rows.sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned));
    modal(
      "Announcements",
      `<p class="muted">Updates from your community.</p>${admin() ? '<button class="primary" id="newAnnouncement">Write announcement</button>' : ""}${rows.map((a) => `<article class="history-card"><small class="muted">${a.is_pinned ? "◆ PINNED · " : ""}${esc(new Date(a.created_at).toLocaleDateString())}</small><h3>${esc(a.title)}</h3><div class="body">${C.render(a.body, state.profiles, state.channels)}</div>${admin() ? `<button class="secondary" data-announcement-edit="${esc(a.id)}">Edit</button>` : ""}</article>`).join("") || '<div class="empty-state">No announcements yet.</div>'}`,
    );
    if ($("newAnnouncement"))
      $("newAnnouncement").onclick = () => announcementForm();
    document
      .querySelectorAll("[data-announcement-edit]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            announcementForm(
              rows.find((a) => a.id === b.dataset.announcementEdit),
            )),
      );
  }
  function announcementForm(a = {}) {
    modal(
      a.id ? "Edit announcement" : "Write announcement",
      `<form id="announcementForm">${field("title", "Title", a.title || "", "text", 'required maxlength="200"')}${area("body", "Announcement", a.body || "")}<label class="check-label"><input type="checkbox" name="is_pinned" ${a.is_pinned ? "checked" : ""}> Pin announcement</label><button class="primary" type="submit">Save Announcement</button></form>`,
    );
    formSave("announcementForm", async (v) => {
      await rpc("announcement", { ...v, id: a.id, is_pinned: !!v.is_pinned });
      await announcements();
      toast("Announcement saved");
    });
  }
  async function openAdmin(tab = "overview") {
    if (!staff()) throw new Error("Staff access required.");
    let html = "";
    if (tab === "overview")
      html = `<h2>Server settings</h2><p class="muted">A welcoming community starts with good tools.</p><div class="field-row"><article class="rule-card"><h3>${state.profiles.length} members</h3><p>Profiles, roles, and moderation.</p><button class="secondary" data-admin="members">Manage members</button></article><article class="rule-card"><h3>${state.channels.filter((c) => c.kind !== "dm").length} channels</h3><p>Spaces for every conversation.</p><button class="secondary" data-admin="channels">Manage channels</button></article></div><article class="rule-card"><div class="rule-top"><span class="rule-icon">⛨</span><div><h3>AutoMod</h3><p>Block unwanted content before it reaches your community.</p></div></div><button class="primary" data-admin="automod">Configure AutoMod</button></article>`;
    if (tab === "members")
      html = `<h2>Members & Roles</h2><p class="small-note">Only root can assign or remove roles. Owners cannot grant roles.</p><input id="memberSearch" placeholder="Search members" aria-label="Search members"><div id="adminMemberList">${adminMembersHTML()}</div>`;
    if (tab === "automod") {
      if (!admin()) throw new Error("Administrator permission required.");
      state.rules = await query("cb_automod", { order: "created_at" });
      html = `<div class="toolbar-row"><h2>AutoMod</h2><button class="primary" id="newRule">Create Rule</button></div><p class="muted">Let’s keep the conversation healthy.</p><p class="small-note">Add as many rules and word lists as you need. Each rule can include words, PostgreSQL regular expressions, allowed words, and its own block message.</p>${state.rules.map((r) => `<article class="rule-card"><div class="rule-top"><span class="rule-icon">⛨</span><div style="flex:1"><h3>${esc(r.name)}</h3><p>${r.enabled ? "Blocking matching messages" : "Paused"}</p></div><label class="check-label"><input type="checkbox" data-rule-toggle="${esc(r.id)}" ${r.enabled ? "checked" : ""} aria-label="Enable ${esc(r.name)}"></label></div><div class="rule-summary"><span>${r.words.length} words</span><span>${r.patterns.length} patterns</span><span>${r.allowed_words.length} allowed words</span></div><p>“${esc(r.block_message)}”</p><div class="rule-actions"><button class="secondary" data-rule-edit="${esc(r.id)}">Edit Rule</button><button class="danger" data-rule-delete="${esc(r.id)}">Delete</button></div></article>`).join("") || '<div class="empty-state">No rules yet. Create your first word list.</div>'}`;
    }
    if (tab === "channels")
      html = `<div class="toolbar-row"><h2>Channels & Categories</h2><button class="primary" id="newAdminChannel">Create Channel</button></div><button class="secondary" id="newCategory">＋ Create Category</button><div class="category-admin-list">${state.categories.map((c) => `<div class="account-row"><div><b>⌄ ${esc(c.name)}</b><small>${state.channels.filter((ch) => ch.category_id === c.id).length} channels</small></div><button class="danger" data-category-delete="${esc(c.id)}">Delete category</button></div>`).join("")}</div>${state.channels
        .filter((c) => c.kind !== "dm")
        .map(
          (c) =>
            `<div class="account-row"><div><b># ${esc(c.name)}</b><small>${c.is_private ? "Private" : "Public"} · ${c.kind}</small></div><button class="secondary" data-channel-edit="${esc(c.id)}">Edit</button></div>`,
        )
        .join("")}`;
    if (tab === "moderation") {
      state.history = await query("cb_moderation", {
        order: "created_at",
        ascending: false,
      });
      html = `<div class="toolbar-row"><h2>Moderation History</h2><button class="primary" id="newModeration">Moderate member</button></div>${historyHTML(state.history)}`;
    }
    if (tab === "bots") {
      state.bots = await query("cb_bots", {
        select: "id,owner_id,enabled,created_at,scopes",
      });
      html = `<div class="toolbar-row"><h2>Apps & Bots</h2><button class="primary" id="newBot">Create Bot</button></div><p class="small-note">Bots use the same channel permissions and AutoMod as members. Tokens are shown once. <a href="/external/chatbox/index.html" target="_blank">Read the Node.js API guide ↗</a></p>${state.bots.map((b) => `<article class="rule-card"><h3>${esc(profile(b.id).display_name)} <span class="bot-label">APP</span></h3><p>${b.enabled ? "Active" : "Revoked"} · ID: ${esc(b.id)}</p><p class="small-note">Permissions: ${esc((b.scopes || []).join(", ") || "Messaging only")}</p><div class="rule-actions">${state.root ? `<button class="secondary" data-bot-scopes="${b.id}">Permissions</button>` : ""}<button class="secondary" data-bot-rotate="${b.id}">Rotate token</button><button class="danger" data-bot-revoke="${b.id}">Revoke token</button></div></article>`).join("") || '<div class="empty-state">Your bots will appear here.</div>'}`;
    }
    $("modalContent").innerHTML =
      `<div class="settings-layout"><nav class="settings-nav"><small>CHATBOX SERVER</small>${[
        ["overview", "Overview"],
        ["members", "Members & Roles"],
        ["automod", "AutoMod"],
        ["channels", "Channels"],
        ["moderation", "Moderation"],
        ["bots", "Apps & Bots"],
      ]
        .map(
          ([id, label]) =>
            `<button data-admin="${id}" class="${id === tab ? "active" : ""}">${label}</button>`,
        )
        .join(
          "",
        )}<button data-close>← Back to chat</button></nav><section class="settings-content">${html}</section></div>`;
    if (!$("modal").open) $("modal").showModal();
    if ($("memberSearch"))
      $("memberSearch").oninput = (e) =>
        ($("adminMemberList").innerHTML = adminMembersHTML(e.target.value));
    if ($("newRule")) $("newRule").onclick = () => ruleForm();
    if ($("newAdminChannel"))
      $("newAdminChannel").onclick = () => channelForm();
    if ($("newCategory")) $("newCategory").onclick = categoryForm;
    if ($("newModeration")) $("newModeration").onclick = () => moderationForm();
    if ($("newBot"))
      $("newBot").onclick = () => {
        modal(
          "Create a bot",
          `<form id="botForm">${field("name", "Bot name", "", "text", 'required maxlength="64"')}<p class="small-note">The bot will start with member permissions. Use channel permission overrides to give it access to private channels.</p><button class="primary" type="submit">Create Bot</button></form>`,
        );
        formSave("botForm", async (v) => {
          const r = await rpc("create_bot", v);
          await refresh();
          showToken(r.token);
        });
      };
  }
  function adminMembersHTML(filter = "") {
    return state.profiles
      .filter((p) =>
        (p.username + " " + p.display_name)
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
      .map(
        (p) =>
          `<div class="member-admin">${avatar(p)}<div class="member-detail"><button class="message-author" data-profile="${p.id}">${esc(p.display_name)}</button><small>@${esc(p.username)}</small>${rolePills(p, state.root)}</div>${
            state.root && !p.is_bot
              ? `<select data-add-role="${p.id}" aria-label="Add role to ${esc(p.display_name)}"><option value="">＋ Add role</option>${C.roles
                  .filter((r) => !p.roles.includes(r))
                  .map((r) => `<option>${esc(r)}</option>`)
                  .join("")}</select>`
              : ""
          }<button class="text-button" data-nickname="${p.id}">Nickname</button><button class="text-button" data-moderate="${p.id}">Moderate</button></div>`,
      )
      .join("");
  }
  function ruleForm(id) {
    const r = state.rules.find((r) => r.id === id) || {
      name: "Custom word list",
      words: [],
      patterns: [],
      allowed_words: [],
      enabled: true,
      block_message: "This content is blocked by this server.",
      exempt_channels: [],
      exempt_roles: [],
    };
    modal(
      id ? "Edit AutoMod rule" : "Create AutoMod rule",
      `<form id="ruleForm" class="rule-editor">${field("name", "Rule name", r.name, "text", "required")}${area("words", "Block words and phrases", r.words.join("\n"), "Separate phrases with commas or new lines. Plain phrases match whole words; cat* matches prefixes, *cat suffixes, and *cat* matches anywhere. No fixed list or rule count limit.")}${area("patterns", "Regular expression patterns", r.patterns.join("\n"), "One PostgreSQL regular expression per line. Invalid patterns cannot be saved.")}${area("allowed_words", "Allowed words", r.allowed_words.join("\n"), "Separate allowed phrases with commas or new lines. Wildcards work here too. Regex patterns stay one per line.")}${area("block_message", "Custom block message", r.block_message)}<h3>Actions</h3><p class="small-note">Matching messages are always blocked. Additional actions respect the rule creator’s role hierarchy; root cannot be punished automatically.</p><div class="automod-action-options">${[
        ["warning", "Warn member"],
        ["timeout", "Mute / timeout member"],
        ["ban", "Ban member"],
      ]
        .map(
          ([value, label]) =>
            `<label class="check-label"><input type="checkbox" name="action_${value}" ${(r.actions || []).includes(value) ? "checked" : ""}> ${label}</label>`,
        )
        .join(
          "",
        )}</div>${field("timeout_seconds", "Mute duration (seconds)", r.timeout_seconds || 600, "number", 'min="1" max="2419200" required')}${field("ban_seconds", "Ban duration (seconds; leave blank for permanent)", r.ban_seconds || "", "number", 'min="1" max="31536000"')}${select("log_channel_id", "Send alerts to", [["", "No log channel"], ...state.channels.filter((c) => c.is_private && ["text", "announcement"].includes(c.kind)).map((c) => [c.id, "# " + c.name])], r.log_channel_id || "")}<p class="small-note">Choose a private channel you can manage. Alerts contain blocked content and moderation details.</p>${area("exempt_channels", "Exempt channel IDs", r.exempt_channels.join("\n"))}${area("exempt_roles", "Exempt role names", r.exempt_roles.join("\n"))}<label class="check-label"><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}> Enable this rule</label><label>Import a word list (.txt)<input type="file" id="wordImport" accept=".txt,text/plain"></label><div class="toolbar-row"><button class="secondary" type="button" data-admin="automod">Cancel</button><button class="primary" type="submit">Save Rule</button></div></form>`,
    );
    $("wordImport").onchange = () =>
      safe(async () => {
        const file = $("wordImport").files[0];
        if (file) {
          const ta = document.querySelector("[name=words]");
          ta.value = [ta.value, await file.text()].filter(Boolean).join("\n");
        }
      });
    formSave("ruleForm", async (v) => {
      await rpc("automod", {
        ...v,
        id,
        enabled: !!v.enabled,
        actions: ["warning", "timeout", "ban"].filter((a) => v["action_" + a]),
        timeout_seconds: Number(v.timeout_seconds),
        ban_seconds: v.ban_seconds ? Number(v.ban_seconds) : null,
        words: phrases(v.words),
        patterns: lines(v.patterns),
        allowed_words: phrases(v.allowed_words),
        exempt_channels: lines(v.exempt_channels),
        exempt_roles: lines(v.exempt_roles),
      });
      toast("AutoMod rule saved");
      await openAdmin("automod");
    });
  }
  function categoryForm() {
    modal(
      "Create a category",
      `<form id="categoryForm">${field("name", "Category name", "", "text", 'required maxlength="80"')}${field("sort_order", "Position", "0", "number")}<button class="primary" type="submit">Create Category</button></form>`,
    );
    formSave("categoryForm", async (v) => {
      await rpc("category", v);
      await refresh();
      await openAdmin("channels");
    });
  }
  async function channelForm(id) {
    if (id) {
      const permission = await rpc("channel_status", { channel_id: id });
      if (!permission.bypass)
        throw new Error("Manage channel permission required.");
    } else if (!admin()) throw new Error("Administrator permission required.");
    const ch = state.channels.find((c) => c.id === id) || {
      name: "",
      topic: "",
      kind: "text",
      sort_order: 0,
    };
    modal(
      id ? "Channel settings" : "Create a channel",
      `<form id="channelForm"><div class="field-row">${field("name", "Channel name", ch.name, "text", 'required maxlength="80"')}${select(
        "kind",
        "Channel type",
        [
          ["text", "Text channel"],
          ["announcement", "Announcements"],
        ],
        ch.kind,
      )}</div>${field("topic", "Topic", ch.topic)}<div class="slowmode-setting"><h3>◷ Slowmode</h3><p class="small-note">Give conversations room to breathe. Set the time each member waits between messages. Members who can manage this channel bypass slowmode.</p>${field("slowmode_seconds", "Seconds between messages", ch.slowmode_seconds || 0, "number", 'min="0" max="21600" step="1" required')}<div class="slowmode-presets">${[0, 5, 10, 30, 60, 300, 600, 3600, 21600].map((s) => `<button type="button" class="secondary" data-slowmode="${s}">${s === 0 ? "Off" : s < 60 ? s + "s" : s < 3600 ? s / 60 + "m" : s / 3600 + "h"}</button>`).join("")}</div></div><div class="field-row">${select("category_id", "Category", [["", "No category"], ...state.categories.map((c) => [c.id, c.name])], ch.category_id || "")}${field("sort_order", "Position", ch.sort_order, "number")}</div><label class="check-label"><input name="is_private" type="checkbox" ${ch.is_private ? "checked" : ""}> Private channel</label><label class="check-label"><input name="is_locked" type="checkbox" ${ch.is_locked ? "checked" : ""}> Lock channel (read only for members)</label><button class="primary" type="submit">Save Channel</button></form>${id ? `<h3 style="margin-top:30px">Permissions</h3><p class="small-note">Set each permission separately. Individual member overrides take priority over role overrides. Inherit uses the channel defaults.</p>${select("subject", "Role or member", [["everyone", "Everyone"], ...C.roles.map((r) => ["role:" + r, r]), ...state.profiles.map((p) => ["user:" + p.id, "@" + p.username])], "everyone")}<div id="permissionEditor"></div><div style="margin-top:30px"><button class="danger" id="archiveChannel">Archive Channel</button><p class="small-note">Archiving hides the channel and keeps its messages.</p></div>` : ""}`,
    );
    document.querySelectorAll("[data-slowmode]").forEach(
      (b) =>
        (b.onclick = () => {
          document.querySelector("[name=slowmode_seconds]").value =
            b.dataset.slowmode;
        }),
    );
    formSave("channelForm", async (v) => {
      const r = await rpc("channel", {
        ...v,
        channel_id: id,
        is_private: !!v.is_private,
        is_locked: !!v.is_locked,
      });
      await refresh();
      closeModal();
      await openChannel(r.id);
      toast("Channel saved");
    });
    if (id) {
      const rows = await query("cb_overwrites", { eq: { channel_id: id } });
      const draw = () => {
        const subject = document.querySelector("[name=subject]").value;
        $("permissionEditor").innerHTML = [
          "view",
          "send",
          "attach",
          "manage",
          "mention_everyone",
        ]
          .map((perm) => {
            const row = rows.find(
              (r) => r.subject === subject && r.permission === perm,
            );
            return `<div class="permission-grid"><p>${{ view: "View channel", send: "Send messages", attach: "Attach files", manage: "Manage channel", mention_everyone: "Mention everyone" }[perm]}</p><select data-permission="${perm}" aria-label="${perm}">${[
              ["inherit", "/ Inherit"],
              ["true", "✓ Allow"],
              ["false", "× Deny"],
            ]
              .map(
                ([v, t]) =>
                  `<option value="${v}" ${String(row?.value ?? "inherit") === v ? "selected" : ""}>${t}</option>`,
              )
              .join("")}</select></div>`;
          })
          .join("");
        document.querySelectorAll("[data-permission]").forEach(
          (s) =>
            (s.onchange = () =>
              safe(async () => {
                const value = s.value === "inherit" ? null : s.value === "true";
                await rpc("permission", {
                  channel_id: id,
                  subject,
                  permission: s.dataset.permission,
                  value,
                });
                const old = rows.findIndex(
                  (r) =>
                    r.subject === subject &&
                    r.permission === s.dataset.permission,
                );
                if (old >= 0) rows.splice(old, 1);
                if (value !== null)
                  rows.push({
                    subject,
                    permission: s.dataset.permission,
                    value,
                  });
                toast("Permission saved");
                await refresh();
              })),
        );
      };
      document.querySelector("[name=subject]").onchange = draw;
      draw();
      $("archiveChannel").onclick = () =>
        confirmAction(
          "Archive channel?",
          `#${ch.name} will disappear from the sidebar. Its message history is retained.`,
          async () => {
            await rpc("archive_channel", { channel_id: id });
            closeModal();
            await refresh();
          },
        );
    }
  }
  function moderationForm(id) {
    modal(
      "Moderate a member",
      `<form id="moderationForm">${select(
        "user_id",
        "Member",
        state.profiles
          .filter((p) => p.id !== state.me.id)
          .map((p) => [p.id, "@" + p.username]),
        id,
      )}${select(
        "action",
        "Action",
        [
          ["warning", "Warning"],
          ["timeout", "Timeout"],
          ["ban", "Ban / suspend"],
          ["unban", "Remove ban"],
          ["untimeout", "Remove timeout"],
        ],
        "warning",
      )}${field("reason", "Reason", "", "text", "required")}${area("note", "Moderator note")}${area("evidence", "Offensive item / evidence")}${field("expires_at", "Expiry (required for timeouts; blank means permanent ban)", "", "datetime-local")}<button class="danger" type="submit">Apply Moderation</button></form>`,
    );
    formSave("moderationForm", async (v) => {
      if (v.expires_at) v.expires_at = new Date(v.expires_at).toISOString();
      await rpc("moderate", v);
      toast("Moderation saved");
      await openAdmin("moderation");
    });
  }
  function setInitialPassword() {
    modal(
      "Set your password",
      `<form id="initialPasswordForm">${field("password", "New password", "", "password", 'minlength="8" autocomplete="new-password" required')}${field("confirm", "Confirm password", "", "password", 'minlength="8" autocomplete="new-password" required')}<button class="primary" type="submit">Save Password</button></form>`,
    );
    formSave("initialPasswordForm", async (v) => {
      if (v.password !== v.confirm) throw new Error("Passwords do not match.");
      await checked(client.auth.updateUser({ password: v.password }));
      passwordRecovery = false;
      history.replaceState(null, "", location.pathname + location.hash);
      closeModal();
      toast("Password saved. You can now sign in with email and password.");
    });
  }
  function showToken(token) {
    modal(
      "Save your bot token",
      `<p>This token is only shown now. Store it in an environment variable on your bot’s host.</p><div class="token-box">${esc(token)}</div><p class="small-note">Never put this token in a browser script or commit it to GitHub.</p><button class="primary" id="copyBotToken">Copy token</button>`,
    );
    $("copyBotToken").onclick = () =>
      safe(async () => {
        await navigator.clipboard.writeText(token);
        toast("Bot token copied");
      });
  }
  function confirmAction(title, text, fn) {
    modal(
      title,
      `<p>${esc(text)}</p>`,
      `<button class="secondary" data-close>Cancel</button><button class="danger" id="confirmAction">Confirm</button>`,
    );
    $("confirmAction").onclick = () => safe(fn);
  }
  function inviteDialog() {
    const url = new URL("/external/register.html", location.origin).href;
    modal(
      "Invite your people",
      `<p class="muted">Good conversations are better together.</p><label>Invite link<input id="inviteLink" readonly value="${esc(url)}"></label><button class="primary" id="copyInvite">Copy Invite Link</button><h3 style="margin-top:28px">Invite by email</h3><form id="inviteForm">${field("email", "Their email address", "", "email", "required")}<p class="small-note">Email invitations need a real inbox. The invite link works without email delivery.</p><button class="secondary" type="submit">Send Email Invite</button><p id="inviteStatus" role="status" class="small-note"></p></form>`,
    );
    $("copyInvite").onclick = () =>
      safe(async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Invite link copied");
        } catch {
          $("inviteLink").select();
          toast("Select and copy the invite link.");
        }
      });
    formSave("inviteForm", async (v) => {
      const r = await edge({ action: "invite", email: v.email });
      $("inviteStatus").textContent = r.message || "Invitation sent.";
    });
  }
  function gifDialog() {
    modal(
      "Find the right GIF",
      `<div class="toolbar-row"><b>GIFs</b><small class="muted" id="gifProvider">Find something worth sending</small></div><form id="gifSearch"><input name="q" type="search" placeholder="Search GIFs" aria-label="Search GIFs" autofocus><button class="primary" style="margin-top:12px" type="submit">Search</button></form><div id="gifResults" class="gif-grid">${["hello", "lol", "love", "happy birthday", "celebrate", "cat"].map((q) => `<button class="gif-category" data-gif-query="${q}">${q}</button>`).join("")}</div>`,
    );
    formSave("gifSearch", async (v) => searchGIF(v.q));
  }
  async function searchGIF(q) {
    $("gifResults").innerHTML = '<p class="muted">Searching…</p>';
    try {
      const r = await edge({ action: "gifs", q });
      $("gifProvider").textContent = "Powered by " + r.provider;
      $("gifResults").innerHTML =
        r.items
          .map(
            (g) =>
              `<button data-gif="${esc(https(g.url))}" data-title="${esc(g.title)}" data-credit="${g.credit ? esc(g.source) : ""}" data-license="${esc(g.license || "")}" title="${esc(g.title)}"><img src="${esc(https(g.preview))}" alt="${esc(g.title)}" loading="lazy"></button>`,
          )
          .join("") || "<p>No GIFs found.</p>";
    } catch (e) {
      $("gifResults").innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
    }
  }
  function emojiDialog() {
    modal(
      "Emoji",
      `<div class="emoji-grid">${["😀", "😂", "🥹", "😍", "😎", "🤔", "😭", "😅", "❤️", "💜", "🔥", "✨", "🎉", "💯", "👀", "👍", "👋", "🙌", "👏", "🤝", "✅", "❌", "⭐", "☕", "🍕", "🎮", "🎧", "🌙", "🌈", "🐱", "🐶", "🚀"].map((x) => `<button data-emoji="${x}" aria-label="${x}">${x}</button>`).join("")}</div>`,
    );
  }
  function showHelp() {
    modal(
      "A little help",
      `<h3>Commands</h3>${C.commands.map((c) => `<div class="account-row"><code>${esc(c.name)}</code><small class="muted">${esc(c.description)}</small></div>`).join("")}<h3 style="margin-top:24px">Make your message yours</h3><p class="small-note"># Heading · ## Subheading · ### Small heading<br>-# Small muted text<br>**bold** · *italic* · &#96;inline code&#96;<br>Use three backticks and a language or filename for highlighted code (Luau, JS, TS, C++, C#, and more).<br>Type @ to mention a member or # to link to a channel. Paste a website or YouTube link for a preview.</p>`,
    );
  }
  function findDialog() {
    modal(
      "Find a conversation",
      `<input id="conversationQuery" placeholder="Search channels or members" aria-label="Search channels or members"><div id="conversationResults"></div>`,
    );
    const draw = () => {
      const q = $("conversationQuery").value.toLowerCase();
      $("conversationResults").innerHTML =
        state.channels
          .filter((c) => channelName(c).toLowerCase().includes(q))
          .map(
            (c) =>
              `<button class="channel-link" data-channel="${esc(c.id)}"># ${esc(channelName(c))}</button>`,
          )
          .join("") +
        state.profiles
          .filter((p) =>
            (p.username + " " + p.display_name).toLowerCase().includes(q),
          )
          .map(
            (p) =>
              `<button class="member-row" data-profile="${p.id}">${avatar(p)}<span>${esc(p.display_name)} <small>@${esc(p.username)}</small></span></button>`,
          )
          .join("");
    };
    $("conversationQuery").oninput = draw;
    draw();
    $("conversationQuery").focus();
  }
  function wire() {
    social = window.ChatSocial?.({
      state,
      rpc,
      refresh,
      sync,
      modal,
      closeModal,
      profile,
      avatar,
      attachmentHTML,
      openChannel,
      toast,
      safe,
      preview,
      scrollBottom,
      socialRPC: (action, payload) =>
        checked(client.rpc("chat_social", { action, payload })),
      getMessages: async (id, before) => {
        if (preview) return state.demoMessages.filter((m) => m.room === id);
        let q = client
          .from("cb_messages")
          .select("*")
          .eq("room", id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(100);
        if (before)
          q = q.or(
            `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
          );
        return signMedia((await checked(q)).reverse());
      },
    });
    const icons = {
      settingsButton: "settings",
      channelSettingsButton: "settings",
      membersButton: "members",
      dmButton: "dm",
      announcementsButton: "announcement",
      attachButton: "plus",
      emojiButton: "smile",
      sendButton: "send",
      mobileMenu: "menu",
      addChannel: "plus",
    };
    for (const [id, name] of Object.entries(icons))
      $(id).innerHTML = window.ChatIcons(name);
    $("adminButton").innerHTML =
      window.ChatIcons("shield") + "<span>Server settings</span>";
    $("inviteButton").innerHTML =
      window.ChatIcons("invite") + "<span>Invite people</span>";
    document.addEventListener("click", (e) => {
      const b = e.target.closest("button,a,[data-jump]");
      if (!b) return;
      safe(async () => {
        if (b.hasAttribute("data-close")) return closeModal();
        if (b.hasAttribute("data-logout")) {
          if (!preview) await client.auth.signOut();
          closeModal();
          setAuth();
          return;
        }
        if (b.dataset.channel) {
          closeModal();
          await openChannel(b.dataset.channel);
        }
        if (b.dataset.profile) await showProfile(b.dataset.profile, b);
        if (b.dataset.settings) await openSettings(b.dataset.settings);
        if (b.dataset.admin) await openAdmin(b.dataset.admin);
        if (b.dataset.reply) replyTo(b.dataset.reply);
        if (b.dataset.edit) replyTo(b.dataset.edit, true);
        if (b.dataset.delete)
          confirmAction(
            "Delete message?",
            "The message will be replaced with a deleted message notice.",
            async () => {
              await rpc("delete_message", { id: b.dataset.delete });
              closeModal();
              await sync();
            },
          );
        if (b.dataset.jump) {
          const el = $("message-" + b.dataset.jump);
          if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
          else toast("Load earlier messages to view the replied-to message.");
        }
        if (b.dataset.suggest) applySuggestion(+b.dataset.suggest);
        if (b.hasAttribute("data-cancel-reply")) {
          state.reply = null;
          state.edit = null;
          $("replyBar").hidden = true;
        }
        if (b.hasAttribute("data-dismiss-block"))
          $("blockedNotice").hidden = true;
        if (b.dataset.removeRole) {
          await rpc("role", {
            user_id: b.dataset.user,
            role: b.dataset.removeRole,
            remove: true,
          });
          await refresh();
          toast("Role removed");
          await openAdmin("members");
        }
        if (b.dataset.ruleEdit) ruleForm(b.dataset.ruleEdit);
        if (b.dataset.ruleDelete)
          confirmAction(
            "Delete AutoMod rule?",
            "This removes the rule and its word lists.",
            async () => {
              await rpc("delete_rule", { id: b.dataset.ruleDelete });
              await openAdmin("automod");
            },
          );
        if (b.dataset.channelEdit) await channelForm(b.dataset.channelEdit);
        if (b.dataset.moderate) moderationForm(b.dataset.moderate);
        if (b.dataset.nickname) {
          const p = profile(b.dataset.nickname);
          modal(
            "Change nickname",
            `<p class="muted">Set a community nickname for @${esc(p.username)}. Leave blank to use their display name.</p><form id="nicknameForm">${field("nickname", "Nickname", p.nickname || "", "text", 'maxlength="64"')}<button class="primary" type="submit">Save nickname</button></form>`,
          );
          formSave("nicknameForm", async (v) => {
            await rpc("nickname", { user_id: p.id, nickname: v.nickname });
            await refresh();
            renderMessages();
            await openAdmin("members");
          });
        }
        if (b.dataset.categoryDelete) {
          const id = b.dataset.categoryDelete;
          modal(
            "Delete category",
            `<p>Channels in this category will move to the uncategorized list. Their messages and permissions are kept.</p><button class="danger" id="confirmCategoryDelete">Delete category</button>`,
          );
          $("confirmCategoryDelete").onclick = () =>
            safe(async () => {
              await rpc("delete_category", { id });
              await refresh();
              await openAdmin("channels");
            });
        }
        if (b.dataset.botScopes) {
          const bot = state.bots.find((x) => x.id === b.dataset.botScopes);
          modal(
            "Bot permissions",
            `<form id="botScopeForm"><p>Only root can grant these permissions. The bot cannot moderate staff or assign roles.</p>${[
              ["moderate", "Warn, mute and ban members"],
              ["manage_messages", "Delete messages in accessible channels"],
              ["automod", "Manage AutoMod rules"],
            ]
              .map(
                ([key, label]) =>
                  `<label class="check-label"><input type="checkbox" name="${key}" ${bot.scopes?.includes(key) ? "checked" : ""}> ${label}</label>`,
              )
              .join(
                "",
              )}<button class="primary" type="submit">Save permissions</button></form>`,
          );
          formSave("botScopeForm", async (v) => {
            await rpc("bot_scopes", { id: bot.id, scopes: Object.keys(v) });
            await openAdmin("bots");
          });
        }
        if (b.dataset.botRotate) {
          const r = await rpc("rotate_bot", { id: b.dataset.botRotate });
          showToken(r.token);
        }
        if (b.dataset.botRevoke) {
          await rpc("revoke_bot", { id: b.dataset.botRevoke });
          await openAdmin("bots");
        }
        if (b.dataset.gifQuery) await searchGIF(b.dataset.gifQuery);
        if (b.dataset.gif) {
          if (b.dataset.credit)
            $("messageText").value +=
              "\n[" +
              (b.dataset.title || "GIF").replace(/[\[\]]/g, "") +
              "](" +
              b.dataset.credit +
              ") · " +
              b.dataset.license;
          await sendMessage(b.dataset.gif, b.dataset.title || "GIF");
          closeModal();
        }
        if (b.dataset.emoji) {
          $("messageText").value += b.dataset.emoji;
          closeModal();
          $("messageText").focus();
        }
      });
    });
    document.addEventListener("change", (e) =>
      safe(async () => {
        if (e.target.dataset.addRole && e.target.value) {
          await rpc("role", {
            user_id: e.target.dataset.addRole,
            role: e.target.value,
            remove: false,
          });
          await refresh();
          await openAdmin("members");
        }
        if (e.target.dataset.ruleToggle) {
          const r = state.rules.find(
            (r) => r.id === e.target.dataset.ruleToggle,
          );
          await rpc("automod", { ...r, enabled: e.target.checked });
          toast(e.target.checked ? "Rule enabled" : "Rule paused");
        }
      }),
    );
    $("messageForm").onsubmit = (e) => {
      e.preventDefault();
      safe(() => sendMessage());
    };
    $("messageText").oninput = updateSuggestions;
    $("messageText").onkeydown = (e) => {
      if (!$("autocomplete").hidden) {
        if (["ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          state.suggestion =
            (state.suggestion +
              (e.key === "ArrowDown" ? 1 : -1) +
              state.suggestions.length) %
            state.suggestions.length;
          renderSuggestions();
          return;
        }
        if (["Enter", "Tab"].includes(e.key)) {
          e.preventDefault();
          applySuggestion(state.suggestion);
          return;
        }
        if (e.key === "Escape") {
          $("autocomplete").hidden = true;
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        safe(() => sendMessage());
      }
    };
    $("attachButton").setAttribute("aria-label", "Add to message");
    $("attachButton").onclick = (e) =>
      social ? social.composerMenu(e.currentTarget) : $("attachment").click();
    $("attachment").onchange = () => {
      $("attachmentLabel").textContent =
        $("attachment").files[0]?.name ||
        "Make yourself at home. Say something.";
    };
    $("gifButton").onclick = gifDialog;
    $("emojiButton").onclick = emojiDialog;
    $("settingsButton").onclick = () => safe(() => openSettings());
    $("selfProfile").onclick = (e) =>
      safe(() => showProfile(state.me.id, e.currentTarget));
    $("messages").addEventListener(
      "scroll",
      () => {
        const el = $("messages");
        followMessages = el.scrollHeight - el.clientHeight - el.scrollTop < 100;
      },
      { passive: true },
    );
    $("editProfileShortcut").onclick = () =>
      safe(() => openSettings("profile"));
    $("adminButton").onclick = () => safe(() => openAdmin());
    $("serverMenu").onclick = () =>
      safe(() => (staff() ? openAdmin() : openSettings()));
    $("addChannel").onclick = () => safe(() => channelForm());
    $("channelSettingsButton").onclick = () =>
      safe(() => channelForm(state.room));
    $("inviteButton").onclick = inviteDialog;
    $("findConversation").onclick = findDialog;
    $("helpButton").onclick = showHelp;
    $("announcementsButton").onclick = () => safe(announcements);
    $("membersButton").onclick = () =>
      $("appView").classList.toggle("hide-members");
    $("mobileMenu").onclick = () =>
      $("appView").classList.toggle("show-channels");
    $("homeButton").onclick = () => {
      state.mode = "channels";
      renderSidebar();
    };
    $("dmButton").onclick = () => {
      state.mode = "dm";
      renderSidebar();
      $("appView").classList.add("show-channels");
    };
    $("searchMessages").oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderMessages, 150);
    };
    $("moderationGate").addEventListener("cancel", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && state.me) {
        e.preventDefault();
        findDialog();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.me) safe(sync);
    });
    window.addEventListener("offline", () =>
      setConnected("You’re offline. Your draft is still here."),
    );
    window.addEventListener("online", () => safe(sync));
    document.body.classList.toggle(
      "compact",
      localStorage.getItem("chatbox-compact") === "true",
    );
    $("appView").classList.toggle(
      "hide-members",
      localStorage.getItem("chatbox-hide-members") === "true",
    );
  }
  function demoInit() {
    const now = Date.now(),
      time = (i) => new Date(now - (8 - i) * 60000).toISOString();
    state.demoProfiles = [
      {
        id: demoId,
        username: "alvin",
        display_name: "Alvin",
        roles: ["Owner"],
        bio: "Building a little corner of the internet.\nCode, games, and good conversations.",
        pronouns: "he / him",
        status: "Making things happen",
        banner_color: "#5965eb",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        username: "sophie",
        display_name: "Sophie",
        roles: ["Moderator"],
        status: "Probably listening to music",
        banner_color: "#9054b0",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        username: "alex",
        display_name: "Alex",
        roles: [],
        status: "Working on something cool",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        username: "nova",
        display_name: "Nova",
        roles: [],
        status: "One more game?",
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        username: "orbit",
        display_name: "Orbit",
        roles: [],
        is_bot: true,
        status: "Here to help",
      },
    ];
    state.demoCategories = [
      { id: "community", name: "The community", sort_order: 0 },
      { id: "creative", name: "Make something", sort_order: 1 },
      { id: "staff", name: "Behind the scenes", sort_order: 2 },
      { id: "empty", name: "Coming soon", sort_order: 3 },
    ];
    state.demoChannels = [
      {
        id: "lobby",
        name: "general",
        topic: "The everyday, the extraordinary, and everything in between.",
        category_id: "community",
        kind: "text",
        created_by: demoId,
      },
      {
        id: "announcements",
        name: "announcements",
        topic: "The latest from your community.",
        category_id: "community",
        kind: "announcement",
      },
      {
        id: "introductions",
        name: "introductions",
        category_id: "community",
        kind: "text",
      },
      {
        id: "off-topic",
        name: "off-topic",
        category_id: "community",
        kind: "text",
      },
      {
        id: "share-your-work",
        name: "share-your-work",
        category_id: "creative",
        kind: "text",
      },
      {
        id: "dev-talk",
        name: "dev-talk",
        category_id: "creative",
        kind: "text",
      },
      {
        id: "inspiration",
        name: "inspiration",
        category_id: "creative",
        kind: "text",
      },
      {
        id: "staff-chat",
        name: "staff-chat",
        category_id: "staff",
        kind: "text",
        is_private: true,
      },
    ];
    state.demoMessages = [
      {
        id: "demo1",
        room: "lobby",
        user_id: demoId,
        text: "Hey everyone! Welcome to our new space. ✨\nMake yourself at home — share what you’re working on, ask questions, or just hang out.",
        created_at: time(1),
      },
      {
        id: "demo2",
        room: "lobby",
        user_id: state.demoProfiles[1].id,
        text: "This already feels so cozy. Love the new look 💜",
        created_at: time(2),
      },
      {
        id: "demo3",
        room: "lobby",
        user_id: state.demoProfiles[2].id,
        text: "Finally finished my little weekend project! I’ll drop it in <#share-your-work> in a bit.",
        created_at: time(3),
      },
      {
        id: "demo4",
        room: "lobby",
        user_id: state.demoProfiles[3].id,
        text:
          "<@" + demoId + "> the channel organization is *so much* better now.",
        reply_to: "demo1",
        created_at: time(4),
      },
      {
        id: "demo5",
        room: "lobby",
        user_id: demoId,
        text: 'Glad you like it! And yes, code blocks finally look right 😌\n```welcome.luau\nlocal community = "CHATBOX"\nprint("Welcome to " .. community)\n```',
        created_at: time(5),
      },
      {
        id: "demo6",
        embeds: [
          {
            title: "Listening party",
            description: "Bring your favorite track. **Everyone is welcome.**",
            color: 5793266,
            fields: [
              { name: "When", value: "Tonight at 8", inline: true },
              { name: "Where", value: "<#lobby>", inline: true },
            ],
            footer: { text: "Community events" },
          },
        ],
        room: "lobby",
        user_id: state.demoProfiles[1].id,
        text: "Okay, important question: what’s everyone listening to today? 🎧",
        created_at: time(6),
      },
    ];
    state.demoRules = [
      {
        id: "demo-rule",
        name: "Keep the conversation friendly",
        enabled: true,
        words: ["demo-blocked-word"],
        patterns: [],
        allowed_words: [],
        block_message:
          "Let’s keep this community welcoming. Try rephrasing your message.",
        exempt_channels: [],
        exempt_roles: [],
        created_at: time(0),
      },
    ];
    state.demoAnnouncements = [];
    state.demoHistory = [];
    state.demoMembers = [];
    state.demoBots = [];
    state.demoOverwrites = [];
    state.mentions = { announcements: 3, "dev-talk": 1 };
  }
  function demoQuery(table, options) {
    const names = {
      cb_announcements: "demoAnnouncements",
      cb_profiles: "demoProfiles",
      cb_channels: "demoChannels",
      cb_categories: "demoCategories",
      cb_automod: "demoRules",
      cb_moderation: "demoHistory",
      cb_channel_members: "demoMembers",
      cb_bots: "demoBots",
      cb_overwrites: "demoOverwrites",
    };
    let rows = state[names[table]] || [];
    if (options.eq)
      rows = rows.filter((r) =>
        Object.entries(options.eq).every(([k, v]) => r[k] === v),
      );
    return structuredClone(rows);
  }
  function demoAction(action, p) {
    if (action === "announcement") {
      const old = state.demoAnnouncements.find((a) => a.id === p.id);
      if (old) Object.assign(old, p);
      else
        state.demoAnnouncements.push({
          ...p,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        });
      return {};
    }
    if (action === "nickname") {
      Object.assign(
        state.demoProfiles.find((x) => x.id === p.user_id),
        { nickname: p.nickname || null },
      );
      return {};
    }
    if (action === "delete_category") {
      state.demoCategories = state.demoCategories.filter((x) => x.id !== p.id);
      state.demoChannels.forEach((x) => {
        if (x.category_id === p.id) x.category_id = null;
      });
      return {};
    }
    if (action === "bot_scopes") {
      Object.assign(
        state.demoBots.find((x) => x.id === p.id),
        { scopes: p.scopes },
      );
      return {};
    }
    if (action === "channel_status")
      return {
        seconds:
          state.demoChannels.find((c) => c.id === p.channel_id)
            ?.slowmode_seconds || 0,
        bypass: true,
        retry_after: 0,
      };
    if (action === "bootstrap")
      return { profile: state.demoProfiles[0], root: true };
    if (action === "profile") {
      Object.assign(state.demoProfiles[0], p);
      return {};
    }
    if (action === "role") {
      const u = state.demoProfiles.find((x) => x.id === p.user_id);
      u.roles = p.remove
        ? u.roles.filter((r) => r !== p.role)
        : [...new Set([...u.roles, p.role])];
      return {};
    }
    if (action === "send" || action === "edit") {
      const hit = state.demoRules.find(
        (r) =>
          r.enabled &&
          C.matchesWords(p.text, r.words, {
            allowedWords: r.allowed_words,
            patterns: r.patterns,
          }),
      );
      if (hit) return { blocked: true, message: hit.block_message };
      if (action === "edit") {
        const m = state.demoMessages.find((x) => x.id === p.id);
        m.text = p.text;
        m.edited_at = new Date().toISOString();
        return m;
      }
      const m = {
        ...p,
        id: crypto.randomUUID(),
        room: p.channel_id,
        user_id: demoId,
        created_at: new Date().toISOString(),
      };
      state.demoMessages.push(m);
      return m;
    }
    if (action === "delete_message") {
      Object.assign(
        state.demoMessages.find((m) => m.id === p.id),
        { deleted: true, text: "", image_url: null },
      );
      return {};
    }
    if (action === "automod") {
      const old = state.demoRules.find((x) => x.id === p.id);
      if (old) Object.assign(old, p);
      else state.demoRules.push({ ...p, id: crypto.randomUUID() });
      return {};
    }
    if (action === "delete_rule") {
      state.demoRules = state.demoRules.filter((x) => x.id !== p.id);
      return {};
    }
    if (action === "channel") {
      const old = state.demoChannels.find((x) => x.id === p.channel_id);
      if (old) {
        Object.assign(old, p);
        return { id: old.id };
      }
      const c = { ...p, id: crypto.randomUUID(), created_by: demoId };
      state.demoChannels.push(c);
      return c;
    }
    if (action === "category") {
      state.demoCategories.push({ ...p, id: crypto.randomUUID() });
      return {};
    }
    if (action === "archive_channel") {
      state.demoChannels = state.demoChannels.filter(
        (c) => c.id !== p.channel_id,
      );
      return {};
    }
    if (action === "permission") {
      state.demoOverwrites = state.demoOverwrites.filter(
        (x) =>
          !(
            x.channel_id === p.channel_id &&
            x.subject === p.subject &&
            x.permission === p.permission
          ),
      );
      if (p.value !== null) state.demoOverwrites.push(p);
      return {};
    }
    if (action === "moderate") {
      state.demoHistory.push({
        ...p,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      });
      return {};
    }
    if (action === "dm") {
      const id = "dm-" + p.user_id;
      if (!state.demoChannels.some((c) => c.id === id)) {
        state.demoChannels.push({ id, kind: "dm", name: "Direct message" });
        state.demoMembers.push(
          { channel_id: id, user_id: demoId },
          { channel_id: id, user_id: p.user_id },
        );
      }
      return { id };
    }
    if (["read", "acknowledge"].includes(action)) return {};
    throw new Error("This action needs a live Supabase account.");
  }
  async function init() {
    document.body.classList.toggle(
      "reduce-motion",
      localStorage.getItem("chatbox-reduce-motion") === "true",
    );
    authSetup();
    wire();
    if (preview) {
      demoInit();
      await start({ id: demoId, email: "alvin@example.com" });
      setConnected(
        "LOCAL PREVIEW · Sample conversations. Changes stay in this tab.",
      );
      return;
    }
    if (!window.supabase) {
      $("authError").textContent =
        "Unable to load the connection library. Check your connection and refresh.";
      return;
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setAuth();
      if (event === "PASSWORD_RECOVERY") {
        passwordRecovery = true;
        if (state.me) setTimeout(setInitialPassword, 0);
      }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session && !register) await start(data.session.user);
  }
  safe(init);
})();
