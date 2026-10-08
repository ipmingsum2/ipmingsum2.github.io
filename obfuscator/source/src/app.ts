import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language"
import { lua } from "@codemirror/legacy-modes/mode/lua"
import { tags } from "@lezer/highlight"
import { EditorState, Compartment } from "@codemirror/state"
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view"
import type { PresetName, PrometheusLog, WorkerResponse } from "./lib/prometheusTypes"
import "./index.css"
import { api, request, initializeAuth, startLogin, clearAuth } from "./lib/auth"
import createProcessingWorker from "@/lib/engine-local"

type Identity = { user: { id: string; name: string; isOwner: boolean }; csrfToken: string }
type Entry = { discord_id: string; note: string }
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T
const text = (id: string, value: string) => { element(id).textContent = value }
const hide = (id: string, hidden: boolean) => { element(id).hidden = hidden }
const disable = (id: string, disabled: boolean) => { element<HTMLButtonElement>(id).disabled = disabled }
const bytes = (value: string) => new TextEncoder().encode(value).byteLength
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
const presets: Record<string, { stages: number; detail: string }> = {
  Studio: { stages: 9, detail: "No virtualization · lighter runtime cost" },
  StudioStrong: { stages: 10, detail: "One VM layer · recommended starting point" },
  StudioMax: { stages: 11, detail: "Two VM layers · larger output and runtime cost" },
  StudioLegacyTamper: { stages: 11, detail: "Original anti-tamper · deliberate loop on detection" },
}
const initialSource = `-- Paste your Roblox Luau script here.\n-- Or import a .lua / .luau file.\n\nlocal product = {}\n\nfunction product.greet(name)\n    return "Hello, " .. name\nend\n\nreturn product\n`
let identity: Identity, filename = "product.luau", output = "", exportName = "product.obfuscated.luau"
let worker: Worker | null = null, timer: ReturnType<typeof setTimeout> | null = null, generation = 0, busy = false
let copyTimer: ReturnType<typeof setTimeout> | null = null
const editable = new Compartment()
const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: "#c4b2f7" }, { tag: tags.string, color: "#9cd5b3" },
  { tag: tags.number, color: "#e3b880" }, { tag: tags.comment, color: "#7b8ba3" },
  { tag: tags.function(tags.variableName), color: "#a9c7ff" },
])
function makeEditor(parent: HTMLElement, value: string, readOnly: boolean) {
  return new EditorView({ parent, state: EditorState.create({ doc: value, extensions: [
    lineNumbers(), StreamLanguage.define(lua), syntaxHighlighting(highlighting),
    highlightActiveLine(), highlightActiveLineGutter(),
    readOnly ? EditorView.editable.of(false) : editable.of(EditorView.editable.of(true)),
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ "aria-label": readOnly ? "Output code editor" : "Source code editor" }),
    EditorView.updateListener.of(update => { if (!readOnly && update.docChanged) updateSourceStats() }),
  ] }) })
}
const sourceEditor = makeEditor(element("source-editor"), initialSource, false)
const outputEditor = makeEditor(element("output-editor"), "", true)
function updateSourceStats() {
  text("source-stats", `${sourceEditor.state.doc.lines} lines · ${size(bytes(sourceEditor.state.doc.toString()))}`)
}
function error(message: string) { text("error-text", message); hide("error-banner", !message) }
function pane(name: "source" | "output") {
  element("source-panel").classList.toggle("mobile-visible", name === "source")
  element("output-panel").classList.toggle("mobile-visible", name === "output")
  element("source-pane").classList.toggle("active", name === "source")
  element("output-pane").classList.toggle("active", name === "output")
  requestAnimationFrame(() => { sourceEditor.requestMeasure(); outputEditor.requestMeasure() })
}
function setBusy(value: boolean) {
  busy = value; hide("obfuscate", value); hide("cancel", !value)
  for (const id of ["preset", "pretty", "lolvm", "import"]) disable(id, value)
  for (const id of ["copy", "download"]) disable(id, value || !output)
  sourceEditor.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!value)) })
  if (!output) { text("output-empty-title", value ? "Building your protection…" : "A fresh build starts here."); text("output-empty-message", value ? "The engine is working locally. You can cancel at any time." : "Choose a preset, then obfuscate. Junk code is generated and injected automatically.") }
}
function stop() {
  generation++; worker?.terminate(); worker = null
  if (timer) clearTimeout(timer); timer = null; setBusy(false)
}
function showLogs(logs: PrometheusLog[]) {
  const container = element("logs"); container.replaceChildren()
  for (const log of logs.slice(-200)) {
    const row = document.createElement("p"), level = document.createElement("span")
    row.className = log.level; level.textContent = log.level; row.append(level, document.createTextNode(log.message)); container.append(row)
  }
  text("log-status", busy ? "Processing" : `${logs.length} messages`)
}
async function build() {
  if (busy) return
  const input = sourceEditor.state.doc.toString()
  if (!input.trim()) { error("Paste or import a script first."); return }
  if (bytes(input) > 2 * 1048576) { error("The browser workspace supports scripts up to 2 MB. Use the desktop launcher for larger inputs."); return }
  const id = ++generation, started = performance.now(), seed = (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1
  const preset = element<HTMLSelectElement>("preset").value as PresetName, prettyPrint = element<HTMLInputElement>("pretty").checked
  const logs: PrometheusLog[] = []
  setBusy(true); error(""); showLogs(logs)
  try {
    identity = await api<Identity>("/api/me")
    if (id !== generation) return
    const processingWorker = await createProcessingWorker()
    if (id !== generation) { processingWorker.terminate(); return }
    worker = processingWorker
    const fail = (message: string) => { if (id === generation) { stop(); error(message); showLogs(logs) } }
    timer = setTimeout(() => fail("Build timed out after 180 seconds. Try a lighter preset or the desktop launcher."), 180000)
    worker.onerror = () => fail("The browser engine could not start. Refresh your login and try again.")
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data
      if (id !== generation || data.id !== id) return
      if (data.type === "log") { logs.push(data.log); if (logs.length > 200) logs.shift(); showLogs(logs); return }
      stop(); showLogs(data.result.logs)
      if (!data.result.ok) { error(data.result.error); return }
      output = data.result.output; exportName = filename.replace(/\.(?:lua|luau)$/i, "") + ".obfuscated.luau"
      const preview = output.length > 64000 ? output.slice(0, 64000) + "\n-- Preview truncated. Copy / Download includes the full output." : output
      outputEditor.dispatch({ changes: { from: 0, to: outputEditor.state.doc.length, insert: preview } })
      hide("output-empty", true); hide("output-editor", false); disable("copy", false); disable("download", false)
      text("output-filename", exportName); text("build-time", `Last build · ${((performance.now() - started) / 1000).toFixed(2)}s`)
      text("output-stats", `${size(bytes(output))}${output.length > 64000 ? " · preview limited" : ""}`)
      text("build-summary", `${size(bytes(input))} → ${size(bytes(output))} · seed ${seed}`); pane("output")
    }
    worker.postMessage({ id, action: "obfuscate", options: { source: input, filename, preset, luaVersion: "LuaU", prettyPrint, seed, lolvm: element<HTMLInputElement>("lolvm").checked } })
  } catch (failure) { if (id === generation) { stop(); error((failure as Error).message) } }
}
async function refreshAccess() {
  const { entries } = await api<{ entries: Entry[] }>("/api/whitelist")
  const list = element("access-list"); list.replaceChildren()
  function row(name: string, id: string, owner: boolean) {
    const row = document.createElement("div"), detail = document.createElement("div"), strong = document.createElement("strong"), code = document.createElement("code")
    row.className = "access-row"; strong.textContent = name; code.textContent = id; detail.append(strong, code); row.append(detail)
    if (owner) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Permanent access"; row.append(badge) }
    else {
      const button = document.createElement("button"); button.className = "ghost danger"; button.textContent = "Remove"; button.setAttribute("aria-label", `Remove ${id}`)
      button.onclick = () => { button.disabled = true; void api(`/api/whitelist/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": identity.csrfToken } }).then(refreshAccess).then(() => text("access-notice", "Access removed. Active sessions were revoked.")).catch(failure => { error(failure.message); button.disabled = false }) }; row.append(button)
    }
    list.append(row)
  }
  row("Workspace owner", identity.user.id, true)
  for (const entry of entries) row(entry.note || "Approved account", entry.discord_id, false)
  if (!entries.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "Only you have access. Add a Discord user ID above to invite someone."; list.append(empty) }
}
function showTab(access: boolean) {
  if (access && !identity.user.isOwner) return
  hide("editor-section", access); hide("access-section", !access)
  element("editor-tab").classList.toggle("active", !access); element("access-tab").classList.toggle("active", access)
  if (access) void refreshAccess().catch(failure => error(failure.message))
  else pane("source")
}
element("obfuscate").onclick = () => void build()
element("cancel").onclick = () => { stop(); error("Build cancelled. Your last successful output is still available."); text("log-status", "Cancelled") }
element("dismiss-error").onclick = () => error("")
element("source-pane").onclick = () => pane("source")
element("output-pane").onclick = () => pane("output")
element("editor-tab").onclick = () => showTab(false)
element("access-tab").onclick = () => showTab(true)
const updatePreset = () => { const preset = presets[element<HTMLSelectElement>("preset").value], lolvm = element<HTMLInputElement>("lolvm").checked; text("stage-count", `${preset.stages + (lolvm ? 1 : 0)} stages`); text("preset-detail", preset.detail + (lolvm ? " · Uncalled LOLvm decoy" : "")) }
element("preset").onchange = updatePreset
element("lolvm").onchange = updatePreset
element("import").onclick = () => element<HTMLInputElement>("file-upload").click()
element("file-upload").onchange = async () => {
  const upload = element<HTMLInputElement>("file-upload"), file = upload.files?.[0]; upload.value = ""
  if (!file) return
  if (!/\.(lua|luau)$/i.test(file.name)) { error("Choose a .lua or .luau file."); return }
  if (file.size > 2 * 1048576) { error("Choose a script smaller than 2 MB, or use the desktop launcher."); return }
  try { const source = await file.text(); sourceEditor.dispatch({ changes: { from: 0, to: sourceEditor.state.doc.length, insert: source } }); filename = file.name; text("filename", filename); element("filename").title = filename; error(""); pane("source") }
  catch { error("The file could not be read.") }
}
element("copy").onclick = () => { void navigator.clipboard.writeText(output).then(() => { text("copy", "✓"); if (copyTimer) clearTimeout(copyTimer); copyTimer = setTimeout(() => text("copy", "⧉"), 2000) }).catch(() => error("Clipboard access was denied. Use Download to save your output.")) }
element("download").onclick = () => { const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = exportName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
element("logout").onclick = () => { void api("/auth/logout", { method: "POST", headers: { "X-CSRF-Token": identity.csrfToken } }).then(() => { stop(); clearAuth(); location.assign(__PAGES__ ? "/obfuscator/" : "/") }).catch(failure => error(failure.message)) }
element("login-link").onclick = event => { event.preventDefault(); void startLogin().catch(failure => text("auth-message", failure.message)) }
element("source-link").onclick = event => { event.preventDefault(); void request("/source.zip").then(async response => {
  if (!response.ok) throw new Error("Source download failed.")
  const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = "productguard-source.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}).catch(failure => error(failure.message)) }
element("access-form").onsubmit = event => {
  event.preventDefault(); const id = element<HTMLInputElement>("discord-id"), note = element<HTMLInputElement>("access-note")
  disable("grant-access", true); text("access-notice", "")
  void api("/api/whitelist", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": identity.csrfToken }, body: JSON.stringify({ id: id.value.trim(), note: note.value }) })
    .then(() => { id.value = ""; note.value = ""; return refreshAccess() }).then(() => text("access-notice", "Access granted."))
    .catch(failure => error(failure.message)).finally(() => disable("grant-access", false))
}
window.addEventListener("pagehide", () => { worker?.terminate(); if (timer) clearTimeout(timer); if (copyTimer) clearTimeout(copyTimer) })
updateSourceStats()
void initializeAuth().then(() => api<Identity>("/api/me")).then(data => {
  identity = data; text("account-name", identity.user.name); text("account-role", identity.user.isOwner ? "Owner" : "Member"); text("avatar", identity.user.name.slice(0, 1).toUpperCase())
  hide("access-tab", !identity.user.isOwner); hide("auth-state", true); hide("workspace", false); pane("source")
}).catch(failure => { text("auth-title", "Sign in to continue."); text("auth-message", failure.message); hide("login-link", false) })
