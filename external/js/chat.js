const SUPABASE_URL = "https://lflkpziiwnoamvtrbcil.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tFvlhmTEDV3SOSVp0JvVzg_KHXFiDNb";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

let me = null, myProfile = null, room = "lobby", channel = null, currentChannel = null;
let profileMap = new Map(), filters = [];

function toast(msg, type = "ok", ms = 3200) {
  const d = document.createElement("div");
  d.className = `toast ${type}`;
  d.textContent = msg;
  $("toastWrap").appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function debugValue(obj) {
  if (typeof obj === "string") return obj;
  if (obj instanceof Error) {
    return JSON.stringify({
      name: obj.name,
      message: obj.message,
      stack: obj.stack
    });
  }
  const json = JSON.stringify(obj);
  return json === undefined ? String(obj) : json;
}

function debugLog(label, obj) {
  $("debug").textContent = `[${new Date().toLocaleTimeString()}] ${label}: ${debugValue(obj)}\n` + $("debug").textContent;
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function isChannelPolicyRecursionError(e) {
  const msg = String(e?.message || e?.details || e?.hint || "").toLowerCase();
  return msg.includes("infinite recursion") && msg.includes("channel_members");
}

function isRlsPolicyError(e) {
  const msg = String(e?.message || e?.details || e?.hint || "").toLowerCase();
  return e?.code === "42501" || msg.includes("row-level security policy");
}

function channelPolicyFixMessage(ctx) {
  return `${ctx}: Supabase RLS is blocking channel access. Paste the channel RLS SQL from the deployment message into the Supabase SQL editor, then retry.`;
}

function errText(ctx, e) {
  if (isChannelPolicyRecursionError(e)) {
    return `${ctx}: Supabase RLS is recursively reading channel_members. Paste the non-recursive channel RLS SQL from the deployment message into the Supabase SQL editor to replace the channel policies.`;
  }
  if (isRlsPolicyError(e) && ["channel.create", "join channel", "send"].includes(ctx)) {
    return channelPolicyFixMessage(ctx);
  }
  return `${ctx}: ${e?.message || JSON.stringify(e)}`;
}

function setAuthMsg(msg, err = false) {
  $("authMsg").textContent = msg;
  $("authMsg").style.color = err ? "var(--danger)" : "var(--muted)";
}

function setAdminMsg(msg, err = false) {
  $("adminMsg").textContent = msg;
  $("adminMsg").style.color = err ? "var(--danger)" : "var(--muted)";
}

function setInviteMsg(msg, err = false) {
  $("inviteMsg").textContent = msg;
  $("inviteMsg").style.color = err ? "var(--danger)" : "var(--muted)";
}

function fmt(ts) {
  try { return new Date(ts).toLocaleString(); }
  catch { return ts; }
}

function iframeEmbedHTML(rawAttrs = "") {
  const attrs = {};
  rawAttrs.replace(/(src|width|height)="([^"]*)"/gi, (_, key, value) => {
    attrs[key.toLowerCase()] = value.trim();
    return "";
  });

  let src = attrs.src || "https://www.youtube.com/embed/dQw4w9WgXcQ";
  try {
    const url = new URL(src, location.href);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
    src = url.href;
  } catch {
    src = "https://www.youtube.com/embed/dQw4w9WgXcQ";
  }

  const width = Math.min(Math.max(parseInt(attrs.width || "560", 10) || 560, 200), 640);
  const height = Math.min(Math.max(parseInt(attrs.height || "315", 10) || 315, 120), 360);
  return `<iframe class="iframe-msg" src="${esc(src)}" width="${width}" height="${height}" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
}

function parseRich(text = "") {
  const withIframes = String(text).replace(/!iframe\s*([^!]*)!/gi, (_, attrs) => iframeEmbedHTML(attrs));
  const md = marked.parse(withIframes, { breaks: true, gfm: true });
  return DOMPurify.sanitize(md, {
    ADD_TAGS: ["u", "iframe"],
    ADD_ATTR: ["src", "width", "height", "loading", "allowfullscreen", "referrerpolicy", "class"]
  });
}

function renderMathIn(el) {
  if (!window.renderMathInElement || !el) return;
  renderMathInElement(el, {
    delimiters: [
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false
  });
}

function showAuth() {
  $("authCard").classList.remove("hidden");
  $("appCard").classList.add("hidden");
  $("status").textContent = "Not logged in";
  currentChannel = null;
  $("channelSettings").classList.add("hidden");
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
}

function showApp() {
  $("authCard").classList.add("hidden");
  $("appCard").classList.remove("hidden");
  $("status").textContent = `Logged in: ${myProfile?.display_name || me?.email || "user"}`;
  $("meInfo").innerHTML = `You: <b>${esc(myProfile?.display_name || "")}</b> @${esc(myProfile?.username || "")} (${esc(myProfile?.role || "user")})`;

  const rc = $("roleChip");
  rc.textContent = myProfile?.role || "user";
  rc.className = "chip" + (myProfile?.role === "admin" ? " admin" : "");

  const isAdmin = myProfile?.role === "admin";
  $("adminOnly").classList.toggle("hidden", !isAdmin);
  $("adminNotAllowed").classList.toggle("hidden", isAdmin);
  $("annComposer").classList.toggle("hidden", !isAdmin);
  $("rootAdminTools").classList.toggle("hidden", !isRootOwner());
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

window.sendInviteEmail = async function sendInviteEmail(email) {
  await requireAuthedUser();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!validEmail(normalizedEmail)) throw new Error("Enter a valid email address");

  const { data, error } = await sb.functions.invoke("invite-user", {
    body: {
      email: normalizedEmail,
      invited_by: me?.id || null,
      redirect_to: `${location.origin}${location.pathname}`
    }
  });

  if (error) {
    throw new Error(error.message || "Supabase invite function failed");
  }

  return data;
};

async function requireAuthedUser() {
  const gu = await sb.auth.getUser();
  if (!gu.data.user) throw new Error("Session expired");
  return gu.data.user;
}

async function ensureProfileAfterLogin(user, uh = "", dh = "") {
  const one = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (one.error) throw one.error;
  if (one.data) return one.data;

  const username = (uh || user.email.split("@")[0] || ("u" + Date.now())).slice(0, 24);
  const display_name = (dh || username).slice(0, 48);

  const ins = await sb.from("profiles")
    .insert({ id: user.id, username, display_name, role: "user" })
    .select("*")
    .single();

  if (ins.error) throw ins.error;
  return ins.data;
}

async function uploadFile(file, allowedKinds = ["image", "audio", "video"]) {
  const authUser = await requireAuthedUser();
  const kind = (file.type || "").split("/")[0];
  const ext = (file.name.split(".").pop() || kind || "file").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "file";
  const extKind = mediaKindFromExtension(ext);
  if (!allowedKinds.includes(kind) && !allowedKinds.includes(extKind)) {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
  }
  const path = `${authUser.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const up = await sb.storage.from("chat-media").upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream"
  });
  if (up.error) throw up.error;
  return sb.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
}

async function uploadImage(file) {
  return uploadFile(file, ["image"]);
}

async function uploadMedia(file) {
  return uploadFile(file, ["image", "audio", "video"]);
}

function mediaKindFromExtension(ext = "") {
  if (["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "m4v", "avi", "mkv", "ogv", "3gp", "3g2"].includes(ext)) return "video";
  return "image";
}

function mediaKindFromUrl(url = "") {
  const clean = String(url).split("?")[0].toLowerCase();
  return mediaKindFromExtension(clean.split(".").pop() || "");
}

function attachmentHTML(url) {
  if (!url) return "";
  const safeUrl = esc(url);
  const kind = mediaKindFromUrl(url);
  if (kind === "audio") return `<audio class="audio" controls preload="metadata" src="${safeUrl}"></audio>`;
  if (kind === "video") return `<video class="video" controls preload="metadata" src="${safeUrl}"></video>`;
  return `<img class="img" src="${safeUrl}">`;
}

async function loadProfileMap() {
  const q = await sb.from("profiles").select("id,username,display_name,avatar_url,role");
  if (q.error) throw q.error;
  profileMap = new Map((q.data || []).map(p => [p.id, p]));
}

function channelSlug(name = "lobby") {
  const slug = String(name || "lobby")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "lobby";
}

function canManageChannel(ch = currentChannel) {
  return !!(ch && (myProfile?.role === "admin" || ch.created_by === me?.id));
}

async function getChannelMemberIds(channelId) {
  const q = await sb.from("channel_members").select("user_id").eq("channel_id", channelId);
  if (q.error) throw q.error;
  return new Set((q.data || []).map(row => row.user_id));
}

async function canEnterChannel(ch) {
  if (!ch?.is_private) return true;
  if (myProfile?.role === "admin" || ch.created_by === me?.id) return true;
  const members = await getChannelMemberIds(ch.id);
  return members.has(me?.id);
}

async function ensureChannelByInput(inputName) {
  const requestedName = (inputName || "lobby").trim().slice(0, 64) || "lobby";
  const requestedSlug = channelSlug(requestedName);

  let q = await sb.from("channels")
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .eq("id", requestedSlug)
    .maybeSingle();
  if (q.error) throw q.error;
  if (q.data) return q.data;

  q = await sb.from("channels")
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .ilike("name", requestedName)
    .limit(1)
    .maybeSingle();
  if (q.error) throw q.error;
  if (q.data) return q.data;

  const ins = await sb.from("channels")
    .insert({ id: requestedSlug, name: requestedName, created_by: me.id, is_private: false, is_locked: false, sort_order: Date.now() })
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") throw new Error("This channel is private or already exists.");
    if (isRlsPolicyError(ins.error)) throw new Error(channelPolicyFixMessage("channel.create"));
    throw ins.error;
  }
  return ins.data;
}

function updateChannelSettingsUI() {
  const settings = $("channelSettings");
  if (!currentChannel) {
    settings.classList.add("hidden");
    return;
  }

  const canManage = canManageChannel();
  $("btnShowChannelSettings").classList.toggle("hidden", !canManage);
  settings.classList.toggle("hidden", !canManage);
  $("channelSettingsInfo").textContent = `${currentChannel.is_private ? "Private" : "Public"}${currentChannel.is_locked ? " • Locked" : ""} channel: #${currentChannel.name}`;
  $("channelRenameInput").value = currentChannel.name;
  $("channelPrivateToggle").checked = !!currentChannel.is_private;
  $("channelLockToggle").checked = !!currentChannel.is_locked;
  $("privateMemberControls").classList.toggle("hidden", !currentChannel.is_private);
  $("channelSettingsMsg").textContent = canManage ? "Admins and channel creators can rename, delete, manage privacy, and lock/unlock chat." : "";
}

async function renameCurrentChannel() {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can rename this channel");
  const nextName = $("channelRenameInput").value.trim().slice(0, 64);
  if (!nextName) throw new Error("Channel name required");

  const q = await sb.from("channels")
    .update({ name: nextName })
    .eq("id", currentChannel.id)
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .single();
  if (q.error) throw q.error;
  currentChannel = q.data;
  $("roomInput").value = currentChannel.name;
  updateChannelSettingsUI();
  await loadRooms();
}

async function deleteCurrentChannel() {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can delete this channel");
  if (!confirm(`Delete #${currentChannel.name}? This also deletes messages in the channel.`)) return;

  const channelId = currentChannel.id;
  const msgDelete = await sb.from("messages").delete().eq("room", channelId);
  if (msgDelete.error) throw msgDelete.error;
  const memberDelete = await sb.from("channel_members").delete().eq("channel_id", channelId);
  if (memberDelete.error) throw memberDelete.error;
  const channelDelete = await sb.from("channels").delete().eq("id", channelId);
  if (channelDelete.error) throw channelDelete.error;

  toast("Channel deleted", "ok");
  currentChannel = null;
  $("roomInput").value = "lobby";
  await joinRoom();
  await loadRooms();
}

async function setCurrentChannelPrivate(isPrivate) {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can change privacy");
  const q = await sb.from("channels")
    .update({ is_private: isPrivate })
    .eq("id", currentChannel.id)
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .single();
  if (q.error) throw q.error;
  currentChannel = q.data;
  updateChannelSettingsUI();
  await loadRooms();
}

async function addPrivateMemberToCurrentChannel() {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can add users");
  if (!currentChannel?.is_private) throw new Error("Make the channel private first");
  const username = $("privateMemberUsername").value.trim();
  const userId = await getUserIdByUsername(username);
  const q = await sb.from("channel_members").insert({
    channel_id: currentChannel.id,
    user_id: userId,
    added_by: me.id
  });
  if (q.error && q.error.code !== "23505") throw q.error;
  $("privateMemberUsername").value = "";
  toast(`Added @${username} to #${currentChannel.name}`, "ok");
}

async function getChannelLockBypassIds(channelId) {
  const q = await sb.from("channel_lock_bypass").select("user_id").eq("channel_id", channelId);
  if (q.error) throw q.error;
  return new Set((q.data || []).map(row => row.user_id));
}

async function canTalkInChannel(ch) {
  if (!ch?.is_locked) return true;
  if (myProfile?.role === "admin" || ch.created_by === me?.id) return true;
  const bypassUsers = await getChannelLockBypassIds(ch.id);
  return bypassUsers.has(me?.id);
}

async function setCurrentChannelLocked(isLocked) {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can lock this channel");
  const q = await sb.from("channels")
    .update({ is_locked: isLocked })
    .eq("id", currentChannel.id)
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .single();
  if (q.error) throw q.error;
  currentChannel = q.data;
  updateChannelSettingsUI();
  await loadRooms();
}

async function addLockBypassToCurrentChannel() {
  await requireAuthedUser();
  if (!canManageChannel()) throw new Error("Only admins or the channel creator can add lock bypass users");
  if (!currentChannel?.is_locked) throw new Error("Lock the channel first");
  const username = $("lockBypassUsername").value.trim();
  const userId = await getUserIdByUsername(username);
  const q = await sb.from("channel_lock_bypass").insert({
    channel_id: currentChannel.id,
    user_id: userId,
    added_by: me.id
  });
  if (q.error && q.error.code !== "23505") throw q.error;
  $("lockBypassUsername").value = "";
  toast(`@${username} can talk while #${currentChannel.name} is locked`, "ok");
}

function addAdminMenu(x, y, msg){
  const host = $("menuHost");
  host.innerHTML = "";

  const p = profileMap.get(msg.user_id) || {};
  const username = p.username || "unknown";

  const m = document.createElement("div");
  m.className = "menu";
  m.style.left = x + "px";
  m.style.top = y + "px";

  m.innerHTML = `
    <button data-act="copyuser">Copy username (@${esc(username)})</button>
    <button data-act="mute">Mute user</button>
    <button data-act="unmute">Unmute user</button>
    <button data-act="ban">Ban user</button>
    <button data-act="unban">Unban user</button>
    <button data-act="delete">Delete message</button>
  `;
  host.appendChild(m);

  m.onclick = async (e) => {
    const act = e.target.getAttribute("data-act");
    if(!act) return;

    try{
      if(act === "copyuser"){
        await navigator.clipboard.writeText(username);
        toast("Username copied", "ok");
      }

      if(act === "mute"){
        const sec = Number(prompt("Mute seconds?", "60") || 60);
        const reason = prompt("Mute reason?", "No reason provided") || "No reason provided";
        await adminMuteUser(msg.user_id, sec, reason);
        toast(`Muted @${username} for ${sec}s. Reason: ${reason}`, "ok");
      }

      if(act === "unmute"){
        await adminUnmuteUser(msg.user_id);
        toast(`Unmuted @${username}`, "ok");
      }

      if(act === "ban"){
        const reason = prompt("Ban reason?", "No reason provided") || "No reason provided";
        await adminBanUser(msg.user_id, reason);
        toast(`Banned @${username}. Reason: ${reason}`, "ok");
      }

      if(act === "unban"){
        await adminUnbanUser(msg.user_id);
        toast(`Unbanned @${username}`, "ok");
      }

      if(act === "delete"){
        await softDelete(msg.id);
      }
    }catch(err){
      toast(err.message || String(err), "err", 4500);
      debugLog("admin.menu.error", err);
    }

    host.innerHTML = "";
  };

  setTimeout(() => {
    document.addEventListener("click", () => host.innerHTML = "", { once:true });
  }, 0);
}
function messageHTML(m) {
  const p = profileMap.get(m.user_id) || {};
  const isAdmin = myProfile?.role === "admin";
  const canDelete = (me && m.user_id === me.id) || isAdmin;
  const canEdit = (me && m.user_id === me.id) || isAdmin;
  const avatar = p.avatar_url ? `<img class="avatar" src="${esc(p.avatar_url)}">` : "";
  const rich = parseRich(m.text || "");
  const img = m.image_url ? attachmentHTML(m.image_url) : "";
  const dot = isAdmin ? `<div class="admin-dot" data-dot="${m.id}">\u2026</div>` : "";

  return `<div class="msg" id="m-${m.id}">
    ${dot}
    <div class="meta"><span>${avatar}<b>${esc(p.display_name || "user")}</b> @${esc(p.username || "unknown")}</span><span>${fmt(m.created_at)}</span></div>
    <div class="body">${rich}</div>${img}
    <div class="actions">
      ${canDelete ? `<button class="ghost" data-del="${m.id}">Delete</button>` : ""}
      ${canEdit ? `<button class="ghost" data-edit-msg="${m.id}">Edit</button>` : ""}
    </div>
  </div>`;
}

function wireMessageActions(map) {
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = async () => {
      try {
        await softDelete(btn.getAttribute("data-del"));
      } catch (e) {
        toast(errText("delete", e), "err");
      }
    };
  });

  document.querySelectorAll("[data-dot]").forEach(dot => {
    dot.onclick = (ev) => {
      const msg = map.get(dot.getAttribute("data-dot"));
      addAdminMenu(ev.clientX, ev.clientY, msg);
    };
  });

  document.querySelectorAll("[data-edit-msg]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-edit-msg");
      const m = map.get(id);
      try {
        await editMessage(id, m?.text || "");
        toast("Message edited", "ok");
      } catch (e) {
        toast(errText("edit message", e), "err", 4500);
        debugLog("msg.edit", e);
      }
    };
  });
}

async function softDelete(id) {
  const q = await sb.from("messages").delete().eq("id", id);
  if (q.error) throw q.error;
  const old = document.getElementById(`m-${id}`);
  if (old) old.remove();
  toast("Message deleted");
}

function getMatchedFilter(text) {
  const lc = (text || "").toLowerCase();
  return filters.find(f => f.enabled && lc.includes(f.pattern.toLowerCase()));
}

async function loadMessages() {
  await loadProfileMap();

  const q = await sb.from("messages")
    .select("id,room,user_id,text,image_url,deleted,created_at")
    .eq("room", room)
    .eq("deleted", false)
    .order("created_at", { ascending: true })
    .limit(400);

  if (q.error) throw q.error;

  const chat = $("chat");
  chat.innerHTML = "";

  const map = new Map();
  (q.data || []).forEach(m => {
    map.set(m.id, m);
    chat.insertAdjacentHTML("beforeend", messageHTML(m));
  });

  chat.querySelectorAll(".body").forEach(renderMathIn);
  wireMessageActions(map);
  chat.scrollTop = chat.scrollHeight;
}

async function joinRoom() {
  const requestedRoom = ($("roomInput").value.trim() || "lobby").slice(0, 64);
  const ch = await ensureChannelByInput(requestedRoom);
  const allowed = await canEnterChannel(ch);
  if (!allowed) {
    toast("This channel is private.", "err", 4500);
    return;
  }

  currentChannel = ch;
  room = ch.id;
  $("roomInput").value = ch.name;
  updateChannelSettingsUI();
  await loadMessages();
  loadRooms();

  if (channel) await sb.removeChannel(channel);

  channel = sb.channel(`room-${room}-${Date.now()}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `room=eq.${room}`
    }, async (payload) => {
      const m = payload.new;
      if (m.deleted) return;
      if (!profileMap.has(m.user_id)) {
        const p = await sb.from("profiles")
          .select("id,username,display_name,avatar_url,role")
          .eq("id", m.user_id)
          .maybeSingle();
        if (p.data) profileMap.set(m.user_id, p.data);
      }

      const chat = $("chat");
      chat.insertAdjacentHTML("beforeend", messageHTML(m));
      const el = document.getElementById(`m-${m.id}`);
      if (el) renderMathIn(el.querySelector(".body"));

      const single = new Map();
      single.set(m.id, m);
      wireMessageActions(single);

      chat.scrollTop = chat.scrollHeight;
    })
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "messages",
      filter: `room=eq.${room}`
    }, async (payload) => {
      const m = payload.new;
      const old = document.getElementById(`m-${m.id}`);
      if (m.deleted) {
        if (old) old.remove();
        return;
      }
      if (old) {
        old.outerHTML = messageHTML(m);
        const ne = document.getElementById(`m-${m.id}`);
        if (ne) renderMathIn(ne.querySelector(".body"));
      }

      const single = new Map();
      single.set(m.id, m);
      wireMessageActions(single);
    })
    .on("postgres_changes", {
      event: "DELETE",
      schema: "public",
      table: "messages",
      filter: `room=eq.${room}`
    }, async (payload) => {
      const deletedId = payload.old?.id;
      if (!deletedId) return;
      const old = document.getElementById(`m-${deletedId}`);
      if (old) old.remove();
    })
    .subscribe();
}

async function initializeChatAfterAuth() {
  try {
    await loadFilters();
  } catch (e) {
    debugLog("init.loadFilters", e);
    toast("Login worked, but filters failed to load.", "warn", 4500);
  }

  try {
    await loadAnnouncements();
  } catch (e) {
    debugLog("init.loadAnnouncements", e);
    toast("Login worked, but announcements failed to load.", "warn", 4500);
  }

  try {
    await joinRoom();
    await loadRooms();
  } catch (e) {
    debugLog("init.channels", e);
    toast("Login worked, but channels failed. Run the channel SQL or check Supabase policies.", "warn", 7000);
  }
}

async function moveChannelInOrder(channelId, direction, channels) {
  await requireAdmin();
  const index = channels.findIndex(ch => ch.id === channelId);
  const swapIndex = index + direction;
  if (index < 0 || swapIndex < 0 || swapIndex >= channels.length) return;

  const current = channels[index];
  const other = channels[swapIndex];
  const currentOrder = current.sort_order ?? index * 10;
  const otherOrder = other.sort_order ?? swapIndex * 10;

  const first = await sb.from("channels").update({ sort_order: otherOrder }).eq("id", current.id);
  if (first.error) throw first.error;
  const second = await sb.from("channels").update({ sort_order: currentOrder }).eq("id", other.id);
  if (second.error) throw second.error;

  await loadRooms();
  toast(`Moved #${current.name} ${direction < 0 ? "up" : "down"}`, "ok");
}

async function loadRooms() {
  const q = await sb.from("channels")
    .select("id,name,created_by,is_private,is_locked,sort_order,created_at")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (q.error) {
    debugLog("rooms.load", q.error);
    return;
  }

  const channels = q.data || [];
  const isAdmin = myProfile?.role === "admin";
  const box = $("roomList");
  box.innerHTML = channels.length ? channels.map((ch, index) => {
    const manageable = isAdmin || ch.created_by === me?.id;
    return `
      <div class="list-item">
        <div>
          <div><b>${ch.is_private ? '<span class="lock">🔒</span>' : ''}#${esc(ch.name)}</b></div>
          <div class="muted">${ch.is_private ? "Private" : "Public"}${ch.is_locked ? " • Locked" : ""}${manageable ? " • manageable" : ""}</div>
        </div>
        <div class="room-actions">
          ${isAdmin ? `<button class="ghost" data-move-channel="${esc(ch.id)}" data-dir="-1" ${index === 0 ? "disabled" : ""}>↑</button>` : ""}
          ${isAdmin ? `<button class="ghost" data-move-channel="${esc(ch.id)}" data-dir="1" ${index === channels.length - 1 ? "disabled" : ""}>↓</button>` : ""}
          <button class="ghost" data-open-channel="${esc(ch.id)}">Open</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="muted">No rooms yet.</div>`;

  box.querySelectorAll("[data-open-channel]").forEach(btn => {
    btn.onclick = async () => {
      const channelId = btn.getAttribute("data-open-channel");
      const selected = channels.find(ch => ch.id === channelId);
      if (!selected) return;
      $("roomInput").value = selected.name;
      await joinRoom();
      toast(`Joined #${selected.name}`, "ok");
    };
  });

  box.querySelectorAll("[data-move-channel]").forEach(btn => {
    btn.onclick = async () => {
      try {
        await moveChannelInOrder(btn.getAttribute("data-move-channel"), Number(btn.getAttribute("data-dir")), channels);
      } catch (e) {
        toast(errText("move channel", e), "err", 4500);
        debugLog("rooms.move", e);
      }
    };
  });
}

/* announcements */
async function loadAnnouncements() {
  const q = await sb.from("announcements")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (q.error) {
    debugLog("ann.load", q.error);
    return;
  }

  const isAdmin = myProfile?.role === "admin";
  const rows = q.data || [];

  $("annList").innerHTML = rows.map(a => `
    <div class="list-item" style="${a.is_pinned ? "border-left:4px solid #ffd06a;padding-left:8px" : ""}">
      <div style="flex:1">
        <div>
          ${a.is_pinned ? "\u{1F4CC} " : ""}<b>${esc(a.title)}</b>
        </div>
        <div class="muted">${esc(a.body)}</div>
        <div class="muted">
          ${fmt(a.created_at)}
          ${a.pinned_at ? ` \u2022 pinned ${fmt(a.pinned_at)}` : ""}
        </div>
      </div>
      ${isAdmin ? `
        <div class="row">
          <button class="ghost" data-edit-ann="${a.id}">Edit</button>
          <button class="warn" data-pin-ann="${a.id}">${a.is_pinned ? "Unpin" : "Pin"}</button>
          <button class="danger" data-del-ann="${a.id}">Delete</button>
        </div>
      ` : ""}
    </div>
  `).join("") || `<div class="muted">No announcements yet.</div>`;

  if (isAdmin) {
    const map = new Map(rows.map(a => [a.id, a]));

    document.querySelectorAll("[data-edit-ann]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-edit-ann");
        const a = map.get(id);
        try {
          await editAnnouncement(id, a?.title || "", a?.body || "");
          toast("Announcement updated", "ok");
          await loadAnnouncements();
        } catch (e) {
          toast(errText("edit announcement", e), "err", 4500);
          debugLog("ann.edit", e);
        }
      };
    });

    document.querySelectorAll("[data-pin-ann]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-pin-ann");
        const a = map.get(id);
        try {
          await togglePinAnnouncement(a);
          toast(a?.is_pinned ? "Announcement unpinned" : "Announcement pinned", "ok");
          await loadAnnouncements();
        } catch (e) {
          toast(errText("pin announcement", e), "err", 4500);
          debugLog("ann.pin", e);
        }
      };
    });

    document.querySelectorAll("[data-del-ann]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-del-ann");
        try {
          const qd = await sb.from("announcements").delete().eq("id", id);
          if (qd.error) throw qd.error;
          toast("Announcement deleted", "ok");
          await loadAnnouncements();
        } catch (e) {
          toast(errText("delete announcement", e), "err", 4500);
          debugLog("ann.delete", e);
        }
      };
    });
  }
}

async function editAnnouncement(id, currentTitle, currentBody) {
  const title = prompt("Edit title:", currentTitle || "");
  if (title === null) return;

  const body = prompt("Edit body:", currentBody || "");
  if (body === null) return;

  const q = await sb.from("announcements")
    .update({ title: title.trim(), body: body.trim() })
    .eq("id", id);

  if (q.error) throw q.error;
}

async function togglePinAnnouncement(a) {
  const nextPinned = !a.is_pinned;
  const q = await sb.from("announcements")
    .update({
      is_pinned: nextPinned,
      pinned_at: nextPinned ? new Date().toISOString() : null
    })
    .eq("id", a.id);

  if (q.error) throw q.error;
}

async function editMessage(msgId, oldText) {
  const next = prompt("Edit message:", oldText || "");
  if (next === null) return;

  const cleaned = next.trim();
  if (!cleaned) return toast("Message cannot be empty", "warn");

  const q = await sb.from("messages")
    .update({
      text: cleaned,
      edited_at: new Date().toISOString()
    })
    .eq("id", msgId);

  if (q.error) throw q.error;
}

async function publishAnnouncement() {
  const title = $("annTitle").value.trim();
  const body = $("annBody").value.trim();

  if (!title || !body) return toast("Need title and body", "warn");

  const q = await sb.from("announcements").insert({ title, body, created_by: me.id });
  if (q.error) throw q.error;

  $("annTitle").value = "";
  $("annBody").value = "";
  toast("Announcement published");
  await loadAnnouncements();
}

/* filters */
async function loadFilters() {
  const q = await sb.from("message_filters").select("*").order("created_at", { ascending: false });
  if (q.error) throw q.error;
  filters = q.data || [];
  renderFilterList();
}

function renderFilterList() {
  const box = $("filterList");
  box.innerHTML = filters.map(f => `
    <div class="list-item">
      <div>
        <b>${esc(f.pattern)}</b> <span class="muted">${f.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div class="row">
        <button class="ghost" data-toggle="${f.id}">${f.enabled ? "Disable" : "Enable"}</button>
        <button class="danger" data-del-filter="${f.id}">Delete</button>
      </div>
    </div>
  `).join("") || `<div class="muted">No filters.</div>`;

  box.querySelectorAll("[data-toggle]").forEach(btn => btn.onclick = async () => {
    const id = btn.getAttribute("data-toggle");
    const f = filters.find(x => x.id === id);
    if (!f) return;
    const q = await sb.from("message_filters").update({ enabled: !f.enabled }).eq("id", id);
    if (q.error) return toast(errText("toggle filter", q.error), "err");
    await loadFilters();
  });

  box.querySelectorAll("[data-del-filter]").forEach(btn => btn.onclick = async () => {
    const id = btn.getAttribute("data-del-filter");
    const q = await sb.from("message_filters").delete().eq("id", id);
    if (q.error) return toast(errText("delete filter", q.error), "err");
    await loadFilters();
  });
}

async function addFilter() {
  const pattern = $("filterInput").value.trim();
  if (!pattern) return toast("Filter text required", "warn");

  const q = await sb.from("message_filters").insert({ pattern, enabled: true, created_by: me.id });
  if (q.error) throw q.error;

  $("filterInput").value = "";
  await loadFilters();
  toast("Filter added");
}

/* admin */
async function requireAdmin() {
  if (myProfile?.role !== "admin") throw new Error("Admin only");
}

function isRootOwner() {
  return me?.email === "root@local.chat" && myProfile?.username === "root";
}

async function requireRootOwner() {
  if (!isRootOwner()) throw new Error("Root account only");
}

async function getUserProfileByUsername(username){
  const q = await sb.from("profiles")
    .select("id, username, display_name, role")
    .ilike("username", username.trim())
    .limit(1)
    .maybeSingle();

  if(q.error) throw q.error;
  if(!q.data) throw new Error("User not found");
  return q.data;
}

async function getUserIdByUsername(username){
  const profile = await getUserProfileByUsername(username);
  return profile.id;
}

async function setUserAdminRole(username, makeAdmin) {
  await requireRootOwner();
  const target = await getUserProfileByUsername(username);
  if (target.username === "root" && !makeAdmin) throw new Error("Cannot remove admin from @root");

  const q = await sb.from("profiles")
    .update({ role: makeAdmin ? "admin" : "user" })
    .eq("id", target.id);

  if (q.error) throw q.error;
  return target;
}

async function adminBanUser(userId, reason = "No reason provided"){
  await requireAdmin();
  const q = await sb.from("user_bans").upsert({
    user_id: userId,
    reason: reason || "No reason provided",
    created_at: new Date().toISOString(),
    created_by: me.id
  });
  if(q.error) throw q.error;
}

async function adminMuteUser(userId, seconds=60, reason = "No reason provided"){
  await requireAdmin();
  const muted_until = new Date(Date.now() + Math.max(1, seconds)*1000).toISOString();
  const q = await sb.from("user_mutes").upsert({
    user_id: userId,
    muted_until,
    reason: reason || "No reason provided",
    updated_at: new Date().toISOString(),
    updated_by: me.id
  });
  if(q.error) throw q.error;
}

async function adminUnmuteUser(userId){
  await requireAdmin();
  const q = await sb.from("user_mutes").delete().eq("user_id", userId);
  if(q.error) throw q.error;
}

async function adminUnbanUser(userId){
  await requireAdmin();
  const q = await sb.from("user_bans").delete().eq("user_id", userId);
  if(q.error) throw q.error;
}

/* bans edit: added replication */
async function checkBan(userId){
  if(!userId) return;

  const q = await sb.from("user_bans")
    .select("user_id, reason")
    .eq("user_id", userId)
    .maybeSingle();

  if(q.error){
    debugLog("checkBan.error", q.error);
    return;
  }

  if(q.data){
    toast(`Your account has been banned. Reason: ${q.data.reason || "No reason provided"}`, "err", 6000);
    await sb.auth.signOut();
    me = null;
    myProfile = null;
    showAuth();
  }
}

/* ui wiring */
$("btnPickAvatar").onclick = () => $("avatarFile").click();
$("btnPickMsg").onclick = () => $("msgFile").click();

$("avatarFile").onchange = () => $("avatarFileName").textContent = $("avatarFile").files?.[0]?.name || "No file chosen";
$("msgFile").onchange = () => $("msgFileName").textContent = $("msgFile").files?.[0]?.name || "No file chosen";

document.querySelectorAll("[data-md]").forEach(btn => btn.onclick = () => {
  const s = btn.getAttribute("data-md");
  const ta = $("msgText");
  const a = ta.selectionStart;
  const b = ta.selectionEnd;
  const v = ta.value;
  ta.value = v.slice(0, a) + s + v.slice(b);
  ta.focus();
});

document.querySelectorAll(".tabbtn").forEach(btn => btn.onclick = () => {
  document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $("tab-" + btn.getAttribute("data-tab")).classList.add("active");
});

$("btnClearDebug").onclick = () => $("debug").textContent = "";

$("btnRegister").onclick = async () => {
  setAuthMsg("");
  try {
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) return setAuthMsg("Email/password required", true);

    const r = await sb.auth.signUp({ email, password });
    if (r.error) throw r.error;

    localStorage.setItem("pending_username", $("regUsername").value.trim());
    localStorage.setItem("pending_display", $("regDisplay").value.trim());

    setAuthMsg("Registered. Login now (confirm email if required).");
    toast("Account created");
  } catch (e) {
    setAuthMsg(errText("register", e), true);
    debugLog("register", e);
  }
};

$("btnLogin").onclick = async () => {
  setAuthMsg("");
  try {
    const email = $("email").value.trim();
    const password = $("password").value;
    const r = await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;

    me = r.data.user;

    // check account ban AFTER login (now we have me.id)
    const ban = await sb.from("user_bans")
      .select("user_id, reason")
      .eq("user_id", me.id)
      .maybeSingle();

    if (ban.data) {
      await sb.auth.signOut();
      me = null;
      myProfile = null;
      showAuth();
      toast(`Your account is banned. Reason: ${ban.data.reason || "No reason provided"}`, "err", 6000);
      return;
    }

    myProfile = await ensureProfileAfterLogin(
      me,
      localStorage.getItem("pending_username") || "",
      localStorage.getItem("pending_display") || ""
    );

    localStorage.removeItem("pending_username");
    localStorage.removeItem("pending_display");

    showApp();
    await initializeChatAfterAuth();
    toast("Login success");
  } catch (e) {
    setAuthMsg(errText("login", e), true);
    debugLog("login", e);
  }
};
$("btnLogout").onclick = async () => {
  await sb.auth.signOut();
  me = null;
  myProfile = null;
  showAuth();
  toast("Logged out");
};

$("btnJoin").onclick = async () => {
  try {
    await joinRoom();
  } catch (e) {
    toast(errText("join channel", e), "err", 4500);
    debugLog("channel.join", e);
  }
};

$("btnShowChannelSettings").onclick = () => {
  updateChannelSettingsUI();
  $("channelSettings").scrollIntoView({ behavior: "smooth", block: "nearest" });
};

$("btnRenameChannel").onclick = async () => {
  try {
    await renameCurrentChannel();
    toast("Channel renamed", "ok");
  } catch (e) {
    $("channelSettingsMsg").textContent = errText("rename channel", e);
    debugLog("channel.rename", e);
  }
};

$("btnDeleteChannel").onclick = async () => {
  try {
    await deleteCurrentChannel();
  } catch (e) {
    $("channelSettingsMsg").textContent = errText("delete channel", e);
    debugLog("channel.delete", e);
  }
};

$("channelPrivateToggle").onchange = async () => {
  try {
    await setCurrentChannelPrivate($("channelPrivateToggle").checked);
    toast($("channelPrivateToggle").checked ? "Channel is private" : "Channel is public", "ok");
  } catch (e) {
    $("channelPrivateToggle").checked = !!currentChannel?.is_private;
    $("channelSettingsMsg").textContent = errText("channel privacy", e);
    debugLog("channel.privacy", e);
  }
};

$("channelLockToggle").onchange = async () => {
  try {
    await setCurrentChannelLocked($("channelLockToggle").checked);
    toast($("channelLockToggle").checked ? "Channel is locked" : "Channel is unlocked", "ok");
  } catch (e) {
    $("channelLockToggle").checked = !!currentChannel?.is_locked;
    $("channelSettingsMsg").textContent = errText("channel lock", e);
    debugLog("channel.lock", e);
  }
};

$("btnAddLockBypass").onclick = async () => {
  try {
    await addLockBypassToCurrentChannel();
  } catch (e) {
    $("channelSettingsMsg").textContent = errText("add lock bypass user", e);
    debugLog("channel.lockBypass", e);
  }
};

$("btnAddPrivateMember").onclick = async () => {
  try {
    await addPrivateMemberToCurrentChannel();
  } catch (e) {
    $("channelSettingsMsg").textContent = errText("add private user", e);
    debugLog("channel.member", e);
  }
};

$("btnSaveProfile").onclick = async () => {
  try {
    const authUser = await requireAuthedUser();
    let display_name = ($("newDisplay").value.trim() || myProfile.display_name).slice(0, 48);
    let avatar_url = myProfile.avatar_url || null;

    const f = $("avatarFile").files?.[0];
    if (f) avatar_url = await uploadImage(f);

    const q = await sb.from("profiles").update({ display_name, avatar_url }).eq("id", authUser.id);
    if (q.error) throw q.error;

    myProfile.display_name = display_name;
    myProfile.avatar_url = avatar_url;

    showApp();
    await loadMessages();
    toast("Profile updated");
  } catch (e) {
    toast(errText("profile", e), "err", 4500);
    debugLog("profile", e);
  }
};

$("btnSendInvite").onclick = async () => {
  const email = $("inviteEmail").value.trim();
  setInviteMsg("");
  try {
    await window.sendInviteEmail(email);
    $("inviteEmail").value = "";
    setInviteMsg(`Invite sent to ${email}`);
    toast("Invite sent", "ok");
  } catch (e) {
    const msg = errText("invite", e);
    setInviteMsg(msg, true);
    toast(msg, "err", 6000);
    debugLog("invite", e);
  }
};

$("btnSend").onclick = async () => {
  try {
    const authUser = await requireAuthedUser();
    const text = $("msgText").value.trim();
    const file = $("msgFile").files?.[0];
    const mute = await sb.from("user_mutes")
      .select("muted_until, reason")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (mute.data && new Date(mute.data.muted_until).getTime() > Date.now()) {
      const mutedUntil = new Date(mute.data.muted_until).toLocaleString();
      toast(`Your account is muted until ${mutedUntil}. Reason: ${mute.data.reason || "No reason provided"}`, "warn", 6000);
      return;
    }
    if (!text && !file) return toast("Write text or attach image", "warn");

    if (currentChannel && !(await canEnterChannel(currentChannel))) {
      toast("This channel is private.", "err", 4500);
      await loadRooms();
      return;
    }

    if (currentChannel && !(await canTalkInChannel(currentChannel))) {
      toast("This channel is locked. Only admins, the creator, and bypass users can talk.", "warn", 5000);
      await loadRooms();
      return;
    }

    const hit = getMatchedFilter(text);
    if (hit) return toast(`Blocked by filter: "${hit.pattern}"`, "err", 4500);

    let image_url = null;
    if (file) image_url = await uploadMedia(file);

    const ins = await sb.from("messages").insert({ room, user_id: authUser.id, text: text || null, image_url });
    if (ins.error) {
      if (isRlsPolicyError(ins.error)) throw new Error(channelPolicyFixMessage("send"));
      throw ins.error;
    }

    $("msgText").value = "";
    $("msgFile").value = "";
    $("msgFileName").textContent = "No file chosen";
  } catch (e) {
    toast(errText("send", e), "err", 5000);
    debugLog("send", e);
  }
};

$("btnPublishAnn").onclick = async () => {
  try {
    await requireAdmin();
    await publishAnnouncement();
  } catch (e) {
    toast(errText("publish ann", e), "err", 4500);
  }
};

$("btnAddFilter").onclick = async () => {
  try {
    await requireAdmin();
    await addFilter();
  } catch (e) {
    toast(errText("add filter", e), "err", 4500);
  }
};

$("btnMute").onclick = async ()=>{
  try{
    await requireAdmin();
    const uname = $("targetUsername").value.trim();
    const uid = await getUserIdByUsername(uname);
    const sec = Number($("muteSec").value || 60);
    const reason = prompt("Mute reason?", "No reason provided") || "No reason provided";
    await adminMuteUser(uid, sec, reason);
    setAdminMsg(`Muted @${uname} for ${sec}s. Reason: ${reason}`);
    toast(`User muted. Reason: ${reason}`);
  }catch(e){ setAdminMsg(errText("mute user", e), true); }
};

$("btnUnmute").onclick = async ()=>{
  try{
    await requireAdmin();
    const uname = $("targetUsername").value.trim();
    const uid = await getUserIdByUsername(uname);
    await adminUnmuteUser(uid);
    setAdminMsg(`Unmuted @${uname}`);
    toast("User unmuted");
  }catch(e){ setAdminMsg(errText("unmute user", e), true); }
};

$("btnBan").onclick = async ()=>{
  try{
    await requireAdmin();
    const uname = $("targetUsername").value.trim();
    const uid = await getUserIdByUsername(uname);
    const reason = prompt("Ban reason?", "No reason provided") || "No reason provided";
    await adminBanUser(uid, reason);
    setAdminMsg(`Banned @${uname}. Reason: ${reason}`);
    toast(`User banned. Reason: ${reason}`);
  }catch(e){ setAdminMsg(errText("ban user", e), true); }
};

$("btnUnban").onclick = async ()=>{
  try{
    await requireAdmin();
    const uname = $("targetUsername").value.trim();
    const uid = await getUserIdByUsername(uname);
    await adminUnbanUser(uid);
    setAdminMsg(`Unbanned @${uname}`);
    toast("User unbanned");
  }catch(e){ setAdminMsg(errText("unban user", e), true); }
};

$("btnGiveAdmin").onclick = async () => {
  try {
    const uname = $("adminRoleUsername").value.trim();
    const target = await setUserAdminRole(uname, true);
    $("rootAdminMsg").textContent = `Gave admin to @${target.username}`;
    toast(`@${target.username} is now admin`, "ok");
  } catch (e) {
    $("rootAdminMsg").textContent = errText("give admin", e);
    debugLog("root.giveAdmin", e);
  }
};

$("btnRemoveAdmin").onclick = async () => {
  try {
    const uname = $("adminRoleUsername").value.trim();
    const target = await setUserAdminRole(uname, false);
    $("rootAdminMsg").textContent = `Removed admin from @${target.username}`;
    toast(`@${target.username} is no longer admin`, "ok");
  } catch (e) {
    $("rootAdminMsg").textContent = errText("remove admin", e);
    debugLog("root.removeAdmin", e);
  }
};
/* remember to lick and sub */
function subscribeSideChannels() {
  sb.channel("ann-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => loadAnnouncements())
    .subscribe();

  sb.channel("filters-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "message_filters" }, () => loadFilters())
    .subscribe();

  sb.channel("channels-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () => loadRooms())
    .subscribe();

  sb.channel("channel-members-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "channel_members" }, () => loadRooms())
    .subscribe();

  sb.channel("channel-lock-bypass-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "channel_lock_bypass" }, () => loadRooms())
    .subscribe();

  if (me?.id) {
    sb.channel("user-bans-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_bans",
          filter: `user_id=eq.${me.id}`
        },
        () => checkBan(me.id)
      )
      .subscribe();
  }
}

(async () => {
  const s = await sb.auth.getSession();
  if (!s.data.session?.user) {
    showAuth();
    return;
  }

  try {
    me = s.data.session.user;
    myProfile = await ensureProfileAfterLogin(me);
    showApp();
    subscribeSideChannels();
    await initializeChatAfterAuth();
  } catch (e) {
    debugLog("init", e);
    showAuth();
    toast(errText("init", e), "err", 5000);
  }
})();
