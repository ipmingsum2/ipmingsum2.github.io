/* CHATBOX Developer Portal. Tokens are revealed once and never stored by this page. */
(() => {
  const $ = (id) => document.getElementById(id),
    cfg = window.CHATBOX_CONFIG;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const https = (s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  };
  const preview =
    new URLSearchParams(location.search).has("preview") &&
    ["localhost", "127.0.0.1"].includes(location.hostname);
  let client,
    session,
    root = false,
    accounts,
    selected,
    tab = "overview",
    bots = [],
    loading;
  const toast = (text, error = false) => {
    const el = document.createElement("div");
    el.className = "toast" + (error ? " error" : "");
    el.textContent = text;
    $("toasts").append(el);
    setTimeout(() => el.remove(), 6000);
  };
  const closeModal = () => {
    window.ChatUI?.closeAll();
    $("modal").close();
    $("modalContent").replaceChildren();
  };
  function modal(title, html) {
    window.ChatUI?.closeAll();
    $("modalContent").innerHTML =
      `<button class="modal-close icon-button" aria-label="Close">×</button><h2>${esc(title)}</h2>${html}`;
    $("modalContent").querySelector(".modal-close").onclick = closeModal;
    if (!$("modal").open) $("modal").showModal();
  }
  const checked = async (p) => {
    const { data, error } = await p;
    if (error) throw error;
    return data;
  };
  const safe = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => toast(e.message, true));
  const protectedActions = new Set([
    "create_bot",
    "rotate_bot",
    "revoke_bot",
    "bot_scopes",
  ]);
  async function rpc(action, payload = {}) {
    if (preview)
      throw Error(
        "This preview does not change real bots. Sign in to manage your applications.",
      );
    if (protectedActions.has(action)) {
      const captchaToken = await window.ChatCaptcha.request(
        action === "create_bot"
          ? "Verify to create a bot"
          : action === "rotate_bot"
            ? "Verify to rotate this token"
            : "Verify this bot action",
      );
      const current = await checked(client.auth.getSession());
      if (!current.session) throw Error("Sign in again to continue");
      const response = await fetch(
        `${cfg.supabaseUrl}/functions/v1/${cfg.functionName}`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + current.session.access_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "verified_action",
            operation: action,
            payload,
            captchaToken,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || data.message || "Request failed");
      return data;
    }
    let result = await client.rpc("chat_action", { action, payload });
    if (result.error?.message?.includes("CHATBOX_VERIFICATION_REQUIRED")) {
      await verifySession();
      result = await client.rpc("chat_action", { action, payload });
    }
    return checked(Promise.resolve(result));
  }
  async function verifySession() {
    const captchaToken = await window.ChatCaptcha.request(
        "Verify your developer session",
      ),
      current = await checked(client.auth.getSession());
    const response = await fetch(
      `${cfg.supabaseUrl}/functions/v1/${cfg.functionName}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + current.session.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "verify_session", captchaToken }),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Verification failed");
  }
  async function load(force = false) {
    if (preview) return bots;
    if (force) loading = null;
    if (!loading)
      loading = rpc("developer_bots")
        .then((rows) => {
          bots = rows;
          return rows;
        })
        .catch((e) => {
          loading = null;
          throw e;
        });
    return loading;
  }
  async function hosted(action, payload) {
    let result = await client.rpc("chat_hosted", { action, payload });
    if (result.error?.message?.includes("CHATBOX_VERIFICATION_REQUIRED")) {
      await verifySession();
      result = await client.rpc("chat_hosted", { action, payload });
    }
    return checked(Promise.resolve(result));
  }
  const image = (p, cls = "developer-app-icon") =>
    https(p.avatar_url)
      ? `<img class="${cls}" src="${esc(https(p.avatar_url))}" alt="" referrerpolicy="no-referrer">`
      : `<span class="${cls} developer-monogram">${esc((p.display_name || "App").slice(0, 1).toUpperCase())}</span>`;
  const field = (name, label, value = "", type = "text", extra = "") =>
    `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function grid() {
    selected = null;
    history.replaceState(null, "", location.pathname + location.search);
    $("developerMain").innerHTML =
      `<div class="developer-title"><div><p class="eyebrow">DEVELOPER PORTAL ${preview ? "· LOCAL PREVIEW" : ""}</p><h1>Applications</h1><p class="muted">Create a little personality for your community.</p></div><button class="primary" id="createApplication">＋ New application</button></div><div class="developer-grid">${bots.map((b) => `<button class="developer-app-card" data-open-app="${esc(b.id)}">${image(b.profile)}<h2>${esc(b.profile.display_name)}</h2><p>${esc(b.profile.bio || "Your next great idea starts here.")}</p><span class="status-pill">${b.enabled ? "● Active" : "○ Token revoked"}</span></button>`).join("") || '<div class="developer-empty"><span>✦</span><h2>Good ideas deserve a bot.</h2><p>Build commands, send rich replies, and make your community your own.</p></div>'}</div><p class="small-note">Only applications you own are shown. Root can manage every application.</p>`;
    $("createApplication").onclick = () =>
      modal(
        "New application",
        `<form id="newApplicationForm">${field("name", "Application name", "", "text", 'required maxlength="64"')}<p class="small-note">Creating a bot requires administrator access and hCaptcha verification. New bots start with ordinary messaging permissions.</p><button class="primary" type="submit">Create application</button><p class="error" role="alert"></p></form>`,
      );
    document
      .querySelectorAll("[data-open-app]")
      .forEach((b) => (b.onclick = () => safe(() => open(b.dataset.openApp))));
  }
  async function open(id, nextTab = "overview") {
    selected = bots.find((b) => b.id === id);
    if (!selected) throw Error("Application unavailable");
    tab = nextTab;
    history.replaceState(null, "", "#" + encodeURIComponent(id));
    const p = selected.profile;
    $("developerMain").innerHTML =
      `<button class="text-button" id="backApplications">← All applications</button><div class="developer-title"><div class="developer-app-heading">${image(p)}<div><p class="eyebrow">APPLICATION</p><h1>${esc(p.display_name)}</h1><p class="muted">@${esc(p.username)}</p></div></div><span class="status-pill">${selected.enabled ? "● Active" : "○ Token revoked"}</span></div><nav class="developer-tabs" aria-label="Application settings">${[["overview", "General information"], ["bot", "Bot & token"], ["commands", "Commands"], ["hosting", "Hosting"], ...(root ? [["permissions", "Permissions"]] : [])].map(([key, label]) => `<button class="${tab === key ? "active" : ""}" data-app-tab="${key}">${label}</button>`).join("")}</nav><section id="applicationPanel"></section>`;
    $("backApplications").onclick = grid;
    document
      .querySelectorAll("[data-app-tab]")
      .forEach(
        (b) => (b.onclick = () => safe(() => open(id, b.dataset.appTab))),
      );
    if (tab === "overview") {
      $("applicationPanel").innerHTML =
        `<div class="developer-profile-layout"><form id="applicationIdentity"><h2>Make it yours.</h2><p class="muted">Your bot’s identity appears in chat, profiles, and commands.</p><div class="field-row">${field("display_name", "Display name", p.display_name, "text", 'required maxlength="64"')}${field("username", "Bot username", p.username, "text", 'required minlength="2" maxlength="40" pattern="[a-z0-9_.]{2,40}"')}</div><label>Description<textarea name="bio" maxlength="2000" rows="4">${esc(p.bio)}</textarea></label>${field("status", "Status", p.status, "text", 'maxlength="160"')}<div class="field-row">${field("avatar_url", "Avatar URL", p.avatar_url, "url")}${field("banner_url", "Banner URL", p.banner_url, "url")}</div><div class="field-row"><label>Upload avatar<input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label><label>Upload banner<input name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label></div>${field("banner_color", "Banner color", p.banner_color || "#5865f2", "color")}<div class="developer-save-row"><button class="primary" type="submit">Save changes</button><span class="small-note">Images up to 4 MB. Identity changes keep the token.</span></div><p class="error" role="alert"></p></form><aside><p class="eyebrow">PROFILE PREVIEW</p><div class="developer-profile-preview"><div class="developer-banner" style="background-color:${/^#[0-9a-f]{6}$/i.test(p.banner_color) ? p.banner_color : "#5865f2"}">${https(p.banner_url) ? `<img src="${esc(https(p.banner_url))}" alt="">` : ""}</div>${image(p, "developer-preview-avatar")}<div><h2>${esc(p.display_name)} <span class="bot-label">APP</span></h2><small>@${esc(p.username)}</small><p>${esc(p.bio || "Add a description to tell people what your bot does.")}</p></div></div></aside></div>`;
    } else if (tab === "bot") {
      $("applicationPanel").innerHTML =
        `<div class="developer-panel"><h2>Bot credentials</h2><p class="muted">Keep tokens in your host’s secret store. This portal never displays an existing token.</p><label>Application ID<div class="developer-id">${esc(id)}</div></label><div class="developer-token-placeholder">••••••••••••••••••••••••••••</div><div class="toolbar-row"><button class="primary" id="rotateApplicationToken">Reset token</button><button class="danger" id="revokeApplicationToken">Revoke token</button></div><p class="small-note">Resetting immediately invalidates the old token. Revoking stops API access and hosted execution. Both require hCaptcha.</p></div>`;
      $("rotateApplicationToken").onclick = () =>
        safe(async () => {
          const result = await rpc("rotate_bot", { id });
          selected.enabled = true;
          showToken(result.token);
        });
      $("revokeApplicationToken").onclick = () =>
        modal(
          "Revoke bot token",
          `<p>This stops API access for ${esc(p.display_name)}. You can create a new token later.</p><button class="danger" id="confirmRevokeToken">Verify & revoke</button>`,
        );
    } else if (tab === "commands") {
      $("applicationPanel").innerHTML =
        '<div class="developer-panel"><h2>Application commands</h2><p class="muted">Define commands and arguments through chatbox.js. The chat interface is generated from your API definitions.</p><a class="primary" href="/external/chatbox/index.html#slash-commands">Command API examples ↗</a><div id="registeredCommands"><p class="muted">Loading registered commands…</p></div></div>';
      const rows = preview
        ? [
            {
              name: "purge",
              description: "Remove recent messages",
              options: [{ name: "count", type: 4, required: true }],
            },
          ]
        : await hosted("commands", { bot_id: id });
      if (selected?.id !== id || tab !== "commands") return;
      $("registeredCommands").innerHTML =
        rows
          .map(
            (c) =>
              `<article class="developer-command"><b>/${esc(c.name)}</b><p>${esc(c.description)}</p><div>${(c.options || []).map((o) => `<span class="developer-argument-chip">${esc(o.name)}${o.required ? " *" : ""}</span>`).join("")}</div></article>`,
          )
          .join("") ||
        '<p class="muted">No commands registered yet. Publish a script with client.commands.set() in ClientReady, or register them from your own host.</p>';
    } else if (tab === "hosting") {
      $("applicationPanel").innerHTML =
        '<div class="developer-panel"><p class="eyebrow">PICK YOUR HOME</p><h2>Always around. Your way.</h2><p class="muted">Run on the dashboard 24/7, or use Node.js or Cloudflare on your own host.</p><div class="developer-hosting-grid"><article><h3>Dashboard hosting</h3><p>Upload or write JavaScript. Publish once and keep running when this browser closes.</p><button class="primary" id="openApplicationStudio">Open Bot Studio</button></article><article><h3>Bring your own host</h3><p>Use the same chatbox.js API with Node.js packages, or run on Cloudflare Workers.</p><a class="secondary" href="/external/chatbox/index.html#start">Self-hosting guide ↗</a></article></div></div>';
      $("openApplicationStudio").onclick = () =>
        safe(() =>
          window.ChatBotStudio({
            bot: selected,
            userId: session.user.id,
            request: async (action, payload) => {
              if (preview)
                throw Error("Hosting is unavailable in the local preview");
              return hosted(action, payload);
            },
            modal,
            esc,
            toast,
          }),
        );
    } else if (tab === "permissions" && root) {
      $("applicationPanel").innerHTML =
        `<form class="developer-panel" id="applicationScopes"><h2>Bot API permissions</h2><p class="muted">Only root can grant or remove these permissions. Channel overrides and the owner’s role still apply.</p>${["manage_messages", "moderate", "automod", "manage_channels", "manage_members"].map((scope) => `<label class="check-label"><input type="checkbox" name="scope" value="${scope}" ${selected.scopes?.includes(scope) ? "checked" : ""}>${scope.replaceAll("_", " ")}</label>`).join("")}<button class="primary" type="submit">Verify & save permissions</button><p class="error" role="alert"></p></form>`;
    }
  }
  async function uploadImage(file, botId) {
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/avif",
      ].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    )
      throw Error("Choose a PNG, JPEG, WebP, GIF or AVIF image up to 4 MB");
    const ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
      }[file.type],
      path = `${session.user.id}/${botId}/${crypto.randomUUID()}.${ext}`;
    await checked(
      client.storage.from("chat-media").upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: "3600",
      }),
    );
    return client.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
  }
  function showToken(token) {
    modal(
      "Save your new token",
      `<p>This token is shown once. Copy it into your host’s secret store.</p><input class="developer-token" aria-label="New bot token" type="password" readonly value="${esc(token)}" autocomplete="off"><div class="toolbar-row"><button class="secondary" id="showApplicationToken">Show token</button><button class="primary" id="copyApplicationToken">Copy token</button></div>`,
    );
    $("showApplicationToken").onclick = () => {
      const input = $("modalContent").querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
    };
    $("copyApplicationToken").onclick = () =>
      safe(async () => {
        await navigator.clipboard.writeText(token);
        toast("Token copied. Store it securely.");
      });
  }
  document.addEventListener("submit", (e) => {
    if (
      ![
        "newApplicationForm",
        "applicationIdentity",
        "applicationScopes",
      ].includes(e.target.id)
    )
      return;
    e.preventDefault();
    const form = e.target,
      button = form.querySelector("[type=submit]");
    button.disabled = true;
    safe(async () => {
      try {
        const values = Object.fromEntries(new FormData(form));
        if (form.id === "newApplicationForm") {
          const result = await rpc("create_bot", { name: values.name });
          await load(true);
          await open(result.id);
          showToken(result.token);
        } else if (form.id === "applicationIdentity") {
          const application = selected,
            id = application.id;
          delete values.avatarFile;
          delete values.bannerFile;
          if (preview)
            throw Error("Identity editing is unavailable in the local preview");
          if (
            (form.elements.avatarFile.files[0] ||
              form.elements.bannerFile.files[0]) &&
            !(await checked(client.rpc("chat_human_ready")))
          )
            await verifySession();
          if (form.elements.avatarFile.files[0])
            values.avatar_url = await uploadImage(
              form.elements.avatarFile.files[0],
              id,
            );
          if (form.elements.bannerFile.files[0])
            values.banner_url = await uploadImage(
              form.elements.bannerFile.files[0],
              id,
            );
          application.profile = await rpc("bot_profile", { id, ...values });
          toast("Application updated.");
          if (selected?.id === id) await open(id);
        } else {
          const scopes = new FormData(form).getAll("scope");
          await rpc("bot_scopes", { id: selected.id, scopes });
          selected.scopes = scopes;
          toast("Permissions updated.");
        }
      } catch (error) {
        form.querySelector("[role=alert]").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });
  document.addEventListener("click", (e) => {
    if (e.target.id === "confirmRevokeToken")
      safe(async () => {
        e.target.disabled = true;
        try {
          await rpc("revoke_bot", { id: selected.id });
          selected.enabled = false;
          closeModal();
          await open(selected.id, "bot");
          toast("Token revoked.");
        } finally {
          e.target.disabled = false;
        }
      });
  });
  $("modal").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeModal();
  });
  async function init() {
    if (preview) {
      root = true;
      session = { user: { id: "preview-owner" } };
      bots = [
        {
          id: "preview-orbit",
          enabled: true,
          scopes: ["manage_messages"],
          profile: {
            display_name: "Orbit",
            username: "orbit",
            bio: "A little help for your corner of the internet. Commands, conversations, and a spark of personality.",
            banner_color: "#7867ed",
            status: "Ready when you are",
          },
        },
      ];
      grid();
      return;
    }
    if (!window.supabase)
      throw Error("Could not load Supabase. Refresh to try again.");
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
    session = (await checked(client.auth.getSession())).session;
    if (!session) {
      $("developerMain").innerHTML =
        '<div class="developer-empty"><span>⌘</span><h1>Your next great bot starts here.</h1><p>Sign in to your CHATBOX account to manage applications.</p><a class="primary" href="/external/chat.html?next=/external/developers.html">Sign in to CHATBOX</a></div>';
      return;
    }
    accounts = window.ChatAccounts({
      client,
      config: cfg,
      modal,
      closeModal,
      esc,
      toast,
    });
    try {
      accounts.remember(session);
    } catch (error) {
      toast(error.message, true);
    }
    $("developerAccount").hidden = false;
    $("developerAccount").onclick = () => safe(() => accounts.show());
    root = (await rpc("bootstrap")).root;
    await load();
    const id = decodeURIComponent(location.hash.slice(1));
    if (bots.some((b) => b.id === id)) await open(id);
    else grid();
  }
  init().catch((error) => {
    $("developerMain").innerHTML =
      `<div class="developer-empty"><h1>Could not load applications</h1><p>${esc(error.message)}</p><a class="secondary" href="/external/developers.html">Try again</a></div>`;
  });
})();
