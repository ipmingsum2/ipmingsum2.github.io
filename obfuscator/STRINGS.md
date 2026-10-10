# Editing interface text

Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus

The source catalog is `web/public/strings.json`. The published file is `/obfuscator/strings.json` in the GitHub Pages repository. Edit its values, commit/publish that file, then refresh the page. Editing the published JSON does not require rebuilding JavaScript.

Useful keys:

```json
{
  "workspace.title": "Your code. A little harder to read.",
  "workspace.description": "Layered protection for Roblox Luau, processed on your device.",
  "ui.obfuscate": "Obfuscate",
  "access.title": "Who can use your workspace.",
  "errors.emptySource": "Paste or import a script first."
}
```

Keep keys and placeholders such as `{version}`, `{count}`, `{size}`, `{seconds}` and `{id}` intact. Values must be JSON strings. Labels, tooltips, accessible names, preset descriptions, status/error messages, default filenames and the starter code are included. SVG icons are separate and stay intact when button text changes. HTML in values is displayed as plain text. Missing/invalid values fall back to bundled defaults; malformed or unavailable JSON uses the default catalog.

`backend.*` changes and shared text used by the standalone Worker login page require a Worker rebuild/deployment because that page renders its copy on the server. Engine diagnostics and API response errors originate outside this catalog. The displayed `product.version` is metadata; the generated script header uses `src/product_version.lua`, which is the release version source.

Keep the required Prometheus attribution visible. The font stylesheet in `css/apple-fonts.css` is an unchanged copy of the [requested stylesheet](https://gist.githubusercontent.com/nonaybay/684d1808c0eb9be67063c3f6fb2785c6/raw/4cff54577968cd1966891c4bdc45819573ad99b0/apple-fonts.css). It is served locally as CSS because the raw gist responds with `text/plain` and `nosniff`. Font files still load from the URLs in that stylesheet. Headings use SF Pro Display; smaller interface text uses SF Pro Text; code editors remain monospace.
