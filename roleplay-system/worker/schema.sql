-- Roleplay system schema (Cloudflare D1 / SQLite). Safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  google_email TEXT UNIQUE,
  google_sub TEXT,
  discord_id TEXT UNIQUE,
  discord_name TEXT,
  roblox_id TEXT UNIQUE,
  roblox_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',        -- 'owner' | 'member'
  permissions TEXT NOT NULL DEFAULT '[]',     -- JSON array
  created_at INTEGER NOT NULL DEFAULT 0,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,                      -- 'login' | 'link' | 'public'
  user_id INTEGER,
  return_to TEXT,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verify_codes (
  code TEXT PRIMARY KEY,
  discord_id TEXT,
  discord_name TEXT,
  user_id INTEGER,
  expires INTEGER NOT NULL
);

-- Discord <-> Roblox links for anyone (staff, applicants), not just dashboard users.
CREATE TABLE IF NOT EXISTS links (
  discord_id TEXT PRIMARY KEY,
  discord_name TEXT,
  roblox_id TEXT NOT NULL UNIQUE,
  roblox_name TEXT,
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,                        -- Roblox group id
  name TEXT NOT NULL,
  api_key_enc TEXT,                           -- Open Cloud key, AES-GCM encrypted
  roles TEXT NOT NULL DEFAULT '[]',           -- cached [{id,name,rank,memberCount}]
  tracked_ranks TEXT NOT NULL DEFAULT '[]',   -- JSON array of rank numbers
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  rank INTEGER NOT NULL DEFAULT 0,            -- -1 = no longer in a tracked rank
  role_name TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, roblox_id)
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  ended INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ps_open ON play_sessions (group_id, job_id, ended);
CREATE INDEX IF NOT EXISTS idx_ps_member ON play_sessions (group_id, roblox_id, start_ts);

CREATE TABLE IF NOT EXISTS activity_daily (
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  day TEXT NOT NULL,                          -- YYYY-MM-DD (UTC)
  seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, roblox_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ad_day ON activity_daily (group_id, day);

CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | denied
  requested_by TEXT,
  reviewed_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_to_group ON time_off (group_id, status);

CREATE TABLE IF NOT EXISTS requirement_runs (
  group_id TEXT NOT NULL,
  period_type TEXT NOT NULL,                  -- daily | weekly
  period_start TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, period_type, period_start)
);

CREATE TABLE IF NOT EXISTS requirement_results (
  group_id TEXT NOT NULL,
  period_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  required INTEGER NOT NULL,
  met INTEGER NOT NULL,
  exempt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, period_type, period_start, roblox_id)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  group_id TEXT,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,                   -- user | api | game | system | public
  actor_id TEXT,
  actor_name TEXT,
  target_id TEXT,
  target_name TEXT,
  summary TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_group ON logs (group_id, id);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs (type, id);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  group_id TEXT,                              -- NULL = all groups
  scopes TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,                        -- public slug
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  roblox_name TEXT,
  discord_id TEXT,
  answers TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | denied
  reviewer TEXT,
  review_note TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sub_app ON submissions (application_id, status);

-- Scheduled sessions (shifts, trainings, events).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'shift',
  host_name TEXT,
  starts_at INTEGER NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | completed | cancelled
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',          -- note | warning
  text TEXT NOT NULL,
  author TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_member ON notes (group_id, roblox_id);
