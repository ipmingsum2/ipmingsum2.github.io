import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const html = await readFile(new URL("chat.html", root), "utf8");
const js = await readFile(new URL("js/chat.js", root), "utf8");
const css = await readFile(new URL("css/chat.css", root), "utf8");
for (const name of ["backup", "beta"]) {
  await writeFile(new URL(`js/chat-${name}.js`, root), js);
  await writeFile(new URL(`css/chat-${name}.css`, root), css);
  const variant = html
    .replace("/external/css/chat.css", `/external/css/chat-${name}.css`)
    .replace("/external/js/chat.js", `/external/js/chat-${name}.js`);
  await writeFile(new URL(`chat-${name}.html`, root), variant);
  if (name === "beta") await writeFile(new URL("chatbeta.html", root), variant);
}
console.log(
  "Updated chat-backup, chat-beta, and existing chatbeta alias. Legacy was not modified.",
);
