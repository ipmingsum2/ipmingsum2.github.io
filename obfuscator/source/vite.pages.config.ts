import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { defineConfig } from "vite"
export default defineConfig({
  base: "/obfuscator/", publicDir: false,
  define: { __PAGES__: "true", __API_ORIGIN__: JSON.stringify("https://obfuscator-backend.ipmingsum5.workers.dev") },
  resolve: { alias: [
    { find: "@/lib/engine-local", replacement: fileURLToPath(new URL("./src/lib/engine-pages.ts", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
  ] },
  plugins: [{ name: "pages-html", transformIndexHtml(html, context) {
    const js = context.bundle?.["js/index.js"], css = context.bundle?.["css/index.css"]
    if (js?.type === "chunk") html = html.replace("/obfuscator/js/index.js", `/obfuscator/js/index.js?v=${createHash("sha256").update(js.code).digest("hex").slice(0, 12)}`)
    if (css?.type === "asset") html = html.replace("/obfuscator/css/index.css", `/obfuscator/css/index.css?v=${createHash("sha256").update(css.source).digest("hex").slice(0, 12)}`)
    return html.replace('href="/favicon.svg"', 'href="/obfuscator/favicon.svg"').replace('class="brand" href="/"', 'class="brand" href="/obfuscator/"').replace('href="/auth/discord"', 'href="https://obfuscator-backend.ipmingsum5.workers.dev/auth/discord"').replace('href="/source.zip">Source</a>', 'href="/source.zip">Engine source</a> · <a href="/obfuscator/source/README.md">UI source</a>').replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" /><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src blob:; connect-src 'self' https://obfuscator-backend.ipmingsum5.workers.dev data:; img-src 'self' data:; base-uri 'self'; form-action 'none'">`)
  } }],
  build: { outDir: "pages-dist", sourcemap: false, rolldownOptions: { output: { entryFileNames: "js/index.js", chunkFileNames: "js/[name].js", assetFileNames: asset => asset.names.some(name => name.endsWith(".css")) ? "css/index.css" : "assets/[name][extname]" } } },
})
