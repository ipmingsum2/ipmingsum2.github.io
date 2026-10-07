import { readFile, writeFile, mkdir } from "node:fs/promises";
import { transform } from "esbuild";
import { minify } from "html-minifier-terser";
import { createHash } from "node:crypto";
import { highlightDocs } from "./highlight-docs.mjs";
const root = new URL("../", import.meta.url),
  sources = new URL("sources/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const write = (path, value) => writeFile(new URL(path, root), value);
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const refs = new Map();
let before = 0,
  after = 0;
for (const name of [
  "chat",
  "chat-core",
  "chat-audio",
  "chat-icons",
  "chat-ui",
  "chat-social",
  "chat-interactions",
  "chat-cache",
  "chat-bot-studio",
  "chat-config",
  "chat-guard",
  "chat-captcha",
]) {
  const input = await read(`js/${name}.js`);
  const { code } = await transform(input, {
    loader: "js",
    minify: true,
    target: "es2022",
    legalComments: "eof",
  });
  await write(`js/${name}.min.js`, code);
  refs.set(
    `/external/js/${name}.js`,
    `/external/js/${name}.min.js?v=${hash(code)}`,
  );
  before += Buffer.byteLength(input);
  after += Buffer.byteLength(code);
}
const css = await read("css/chat.css"),
  cssMin = (await transform(css, { loader: "css", minify: true })).code;
await write("css/chat.min.css", cssMin);
refs.set(
  "/external/css/chat.css",
  `/external/css/chat.min.css?v=${hash(cssMin)}`,
);
before += Buffer.byteLength(css);
after += Buffer.byteLength(cssMin);
for (const name of ["chat", "register"]) {
  let html = await readFile(new URL(`${name}.html`, sources), "utf8");
  before += Buffer.byteLength(html);
  for (const [from, to] of refs) html = html.replaceAll(from, to);
  html = await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    collapseBooleanAttributes: true,
  });
  await write(`${name}.html`, html.trim() + "\n");
  after += Buffer.byteLength(html);
}
await import("./sync-variants.mjs");
let docs = highlightDocs(await readFile(new URL("docs.html", sources), "utf8"));
for (const asset of ["docs.css", "docs.js"]) {
  docs = docs.replaceAll(
    `"${asset}"`,
    `"${asset}?v=${hash(await read(`chatbox/${asset}`))}"`,
  );
}
await write(
  "chatbox/index.html",
  await minify(docs, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    collapseBooleanAttributes: true,
  }),
);
await write(
  "chatbox/cloudflare.html",
  await minify(await readFile(new URL("cloudflare.html", sources), "utf8"), {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    collapseBooleanAttributes: true,
  }),
);
console.log(
  `First-party chat HTML/JS/CSS: ${before} → ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller). Editor loads only when Bot Studio opens.`,
);
