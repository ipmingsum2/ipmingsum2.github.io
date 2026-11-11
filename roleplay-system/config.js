// Point this at your deployed Worker (no trailing slash).
window.RP_CONFIG = {
  API_URL: 'https://rp-system.ipmingsum5.workers.dev',
  NAME: 'Roleplay System',
};

// Local development: when the dashboard is opened from localhost, talk to `wrangler dev`.
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.RP_CONFIG.API_URL = 'http://localhost:8787';
