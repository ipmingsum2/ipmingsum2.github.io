// Forwards Roblox game requests to the rp-system Worker over the `API` service binding.
// Exposes the public API (/v1/*), the public application-form endpoints (/public/*) and /health —
// everything in the API docs. Sign-in (/auth/*) and the dashboard API (/api/*) stay on the Worker's own address.
const ALLOWED = /^\/(v1\/|public\/|health$)/;

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/index.html') return env.ASSETS.fetch(request); // short explainer page
  if (request.method !== 'OPTIONS' && !ALLOWED.test(url.pathname)) {
    return new Response(JSON.stringify({ error: 'Not found — this address serves the public API (/v1/…, /public/…)' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  // Same method, headers, body, path and query — the Worker handles auth, CORS and errors as usual.
  return env.API.fetch(new Request(`https://rp-system.internal${url.pathname}${url.search}`, request));
}
