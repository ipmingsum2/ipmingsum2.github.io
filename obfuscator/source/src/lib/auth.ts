const pages = __PAGES__
const key = "productguard.session", verifierKey = "productguard.login-verifier"
const token = () => pages ? sessionStorage.getItem(key) ?? "" : ""
export async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (token()) headers.set("Authorization", `Bearer ${token()}`)
  const response = await fetch(__API_ORIGIN__ + path, { ...init, headers, credentials: pages ? "omit" : "same-origin", cache: "no-store" })
  if (response.status === 401) { if (pages) sessionStorage.removeItem(key); throw new Error("Your access expired. Sign in again to continue.") }
  return response
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init), data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Request failed.")
  return data as T
}
export async function initializeAuth() {
  if (!pages) return
  const params = new URLSearchParams(location.hash.slice(1)), code = params.get("login"), reason = params.get("auth")
  if (!code && !reason) return
  history.replaceState(null, "", location.pathname + location.search)
  if (reason) throw new Error(reason === "denied" ? "Your Discord account has not been granted access." : "Login could not finish. Please try again.")
  const verifier = sessionStorage.getItem(verifierKey)
  sessionStorage.removeItem(verifierKey)
  if (!verifier) throw new Error("Start login from this browser tab.")
  const response = await fetch(__API_ORIGIN__ + "/auth/exchange", { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier }) })
  const data = await response.json()
  if (!response.ok || typeof data.token !== "string") throw new Error(data.error ?? "Login expired. Try again.")
  sessionStorage.setItem(key, data.token)
}
export async function startLogin() {
  if (!pages) { location.assign("/auth/discord"); return }
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const challenge = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))), value => value.toString(16).padStart(2, "0")).join("")
  sessionStorage.setItem(verifierKey, verifier)
  location.assign(`${__API_ORIGIN__}/auth/discord?client=pages&challenge=${challenge}`)
}
export function clearAuth() { if (pages) sessionStorage.removeItem(key) }
