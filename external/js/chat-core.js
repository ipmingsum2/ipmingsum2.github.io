/* Shared pure helpers. The database, not these helpers, authorizes actions. */
(function (root) {
  "use strict";
  const roles = ["Owner", "Super Administrator", "Administrator", "Moderator"];
  const commands = [
    { name: "/help", description: "Show commands and formatting" },
    { name: "/me", description: "Send an action" },
    { name: "/shrug", description: "Add a shrug" },
    { name: "/clear", description: "Clear your draft" },
    { name: "/settings", description: "Open your account settings" },
    { name: "/admin", description: "Open the moderation panel" },
  ];
  function esc(value = "") {
    return String(value).replace(
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
  }
  function https(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" ? u.href : "";
    } catch {
      return "";
    }
  }
  function language(info) {
    const ext = String(info || "")
      .trim()
      .toLowerCase()
      .split(/\s/)[0]
      .split(".")
      .pop();
    return (
      {
        luau: "lua",
        lua: "lua",
        js: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        "c++": "cpp",
        "c+": "cpp",
        cc: "cpp",
        h: "cpp",
        hpp: "cpp",
        cpp: "cpp",
        cs: "csharp",
        "c#": "csharp",
        py: "python",
        sh: "bash",
        yml: "yaml",
        html: "xml",
        svg: "xml",
        txt: "plaintext",
      }[ext] || ext
    );
  }
  function distance(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0];
      d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const v = d[j];
        d[j] = Math.min(
          d[j] + 1,
          d[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        prev = v;
      }
    }
    return d[b.length];
  }
  function suggest(input, profiles = [], channels = []) {
    const match = String(input).match(/(?:^|\s)([@#\/])([^\s]*)$/);
    if (!match) return [];
    const [all, kind, query] = match,
      q = query.toLowerCase();
    if (kind === "/")
      return commands
        .filter(
          (c) =>
            c.name.startsWith("/" + q) || distance(c.name.slice(1), q) <= 2,
        )
        .map((c) => ({
          ...c,
          value: c.name + " ",
          kind: "command",
          length: all.trimStart().length,
        }));
    return (kind === "@" ? profiles : channels)
      .filter((x) =>
        (kind === "@" ? x.username : x.name).toLowerCase().includes(q),
      )
      .slice(0, 12)
      .map((x) => ({
        name: kind + (kind === "@" ? x.username : x.name),
        description: kind === "@" ? x.display_name : "Go to channel",
        value: kind === "@" ? `<@${x.id}> ` : `<#${x.id}> `,
        kind,
        length: all.trimStart().length,
      }));
  }
  function render(text, profiles = [], channels = []) {
    // Raw HTML is always escaped, including the old !iframe syntax.
    const renderer = new root.marked.Renderer();
    renderer.html = (token) =>
      esc(typeof token === "string" ? token : token.text);
    renderer.code = (token) => {
      const code = token.text || "",
        lang = language(token.lang);
      let value = esc(code);
      if (root.hljs && lang && root.hljs.getLanguage(lang))
        value = root.hljs.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      return `<pre><div class="code-label">${esc(lang || "code")}</div><code class="hljs">${value}</code></pre>`;
    };
    const md = root.marked.parse(
      String(text).replace(/^-# (.+)$/gm, (_, s) => `\nCHATBOXSUBTEXT ${s}\n`),
      { breaks: true, gfm: true, renderer },
    );
    const template = document.createElement("template");
    template.innerHTML = root.DOMPurify.sanitize(md, {
      FORBID_TAGS: ["iframe", "style", "form", "input", "video", "audio"],
      FORBID_ATTR: ["style"],
    });
    template.content.querySelectorAll("p").forEach((p) => {
      if (p.textContent.startsWith("CHATBOXSUBTEXT ")) {
        p.classList.add("subtext");
        p.firstChild.textContent = p.firstChild.textContent.replace(
          /^CHATBOXSUBTEXT /,
          "",
        );
      }
    });
    const walker = document.createTreeWalker(
      template.content,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest("code,pre,a")) continue;
      const re = /<([@#])([^>]+)>/g;
      let m,
        last = 0;
      const frag = document.createDocumentFragment();
      while ((m = re.exec(node.textContent))) {
        frag.append(node.textContent.slice(last, m.index));
        const entity = (m[1] === "@" ? profiles : channels).find(
          (x) => String(x.id) === m[2],
        );
        const b = document.createElement("button");
        b.className = "mention";
        b.type = "button";
        b.dataset[m[1] === "@" ? "profile" : "channel"] = m[2];
        b.textContent =
          (m[1] === "@" ? "@" : "#") +
          (entity ? entity.username || entity.name : "unavailable");
        frag.append(b);
        last = m.index + m[0].length;
      }
      if (last) {
        frag.append(node.textContent.slice(last));
        node.replaceWith(frag);
      }
    }
    template.content.querySelectorAll("a").forEach((a) => {
      if (!https(a.href)) {
        a.replaceWith(document.createTextNode(a.textContent));
        return;
      }
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    template.content.querySelectorAll("img").forEach((img) => {
      if (!https(img.src)) img.remove();
      else {
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
      }
    });
    return template.innerHTML;
  }
  function embeds(items = [], profiles = [], channels = []) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 10)
      .filter((e) => e && typeof e === "object")
      .map((e) => {
        const link = (url, label) =>
          https(url)
            ? `<a href="${esc(https(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`
            : label;
        const img = (url, cls) =>
          https(url)
            ? `<img class="${cls}" src="${esc(https(url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : "";
        const color =
          Number.isInteger(e.color) && e.color >= 0 && e.color <= 0xffffff
            ? "#" + e.color.toString(16).padStart(6, "0")
            : "#5865f2";
        return `<section class="rich-embed" style="--embed-color:${color}">${e.thumbnail ? img(e.thumbnail.url, "embed-thumbnail") : ""}${e.author ? `<div class="embed-author">${img(e.author.icon_url, "embed-icon")}${link(e.author.url, esc(e.author.name || ""))}</div>` : ""}${e.title ? `<h3>${link(e.url, esc(e.title))}</h3>` : ""}${e.description ? `<div class="embed-description">${render(e.description, profiles, channels)}</div>` : ""}${Array.isArray(e.fields) && e.fields.length ? `<div class="embed-fields">${e.fields.map((f) => `<div class="embed-field ${f.inline ? "inline" : ""}"><b>${esc(f.name)}</b><div>${render(f.value, profiles, channels)}</div></div>`).join("")}</div>` : ""}${e.image ? img(e.image.url, "embed-image") : ""}${e.footer || e.timestamp ? `<footer>${img(e.footer?.icon_url, "embed-icon")}${esc(e.footer?.text || "")}${e.timestamp && Number.isFinite(Date.parse(e.timestamp)) ? `<time> · ${esc(new Date(e.timestamp).toLocaleString())}</time>` : ""}</footer>` : ""}</section>`;
      })
      .join("");
  }
  function matchesWords(
    content,
    words,
    { allowedWords = [], patterns = [] } = {},
  ) {
    let text = String(content);
    for (const word of splitKeywords(allowedWords))
      text = text.replace(keywordRegex(word, "giu"), " ");
    return (
      splitKeywords(words).some((word) =>
        keywordRegex(word, "iu").test(text),
      ) ||
      patterns.some((pattern) => {
        const re =
          pattern instanceof RegExp
            ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
            : new RegExp(pattern, "i");
        return re.test(text);
      })
    );
  }
  function splitKeywords(words) {
    return [
      ...new Set(
        (Array.isArray(words) ? words : [words])
          .flatMap((s) => String(s).split(/[,\r\n]+/))
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  }
  function keywordRegex(word, flags) {
    const body = [...word]
      .map((c) =>
        c === "*"
          ? "[^\\s]*"
          : c.replace(/[.*+?^${}()|[\]\\]/g, "\\  root.ChatCore = {"),
      )
      .join("");
    return new RegExp(
      (word.startsWith("*") ? "" : "(^|[^\\p{L}\\p{N}_])") +
        body +
        (word.endsWith("*") ? "" : "($|[^\\p{L}\\p{N}_])"),
      flags,
    );
  }

  root.ChatCore = {
    matchesWords,
    splitKeywords,
    roles,
    commands,
    esc,
    https,
    language,
    distance,
    suggest,
    render,
    embeds,
  };
})(typeof window !== "undefined" ? window : globalThis);
