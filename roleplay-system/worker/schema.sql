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
  duty_seconds INTEGER NOT NULL DEFAULT 0,       -- time spent on duty (ActivityTracker.SetOnDuty / admin plugin duty command)
  PRIMARY KEY (group_id, roblox_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ad_day ON activity_daily (group_id, day);
-- Existing databases: ALTER TABLE activity_daily ADD COLUMN duty_seconds INTEGER NOT NULL DEFAULT 0;

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
  created_at INTEGER NOT NULL,
  reminded_at INTEGER                         -- when the "starting soon" Discord reminder went out
);
-- Existing databases: ALTER TABLE events ADD COLUMN reminded_at INTEGER;

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

-- ===== Added: logbook, session registers, promotion recommendations, knowledgebase, news =====

-- Discipline & record logbook (warnings expire; entries can be revoked, never deleted).
CREATE TABLE IF NOT EXISTS logbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  type TEXT NOT NULL,                         -- warning | strike | suspension | demotion | promotion | commendation | termination
  reason TEXT NOT NULL,
  evidence TEXT,                              -- link to a screenshot / clip
  expires_at INTEGER,                         -- NULL = never
  author TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_logbook_member ON logbook (group_id, roblox_id);
CREATE INDEX IF NOT EXISTS idx_logbook_group ON logbook (group_id, id);

-- Session register: who hosted, co-hosted and attended each session.
CREATE TABLE IF NOT EXISTS event_people (
  event_id INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'attendee',      -- host | cohost | attendee
  added_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, roblox_id)
);
CREATE INDEX IF NOT EXISTS idx_event_people_member ON event_people (group_id, roblox_id);

-- Promotion recommendations with justified upvotes.
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  rank INTEGER,
  role_name TEXT,
  reason TEXT NOT NULL,
  created_by_id INTEGER,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- open | promoted | declined
  decided_by TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_group ON recommendations (group_id, status);
CREATE TABLE IF NOT EXISTS rec_votes (
  rec_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT,
  justification TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rec_id, user_id)
);

-- Knowledgebase: handbooks, guides and policies.
CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  body TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT '',        -- 'public' = anyone, '' = signed-in staff, otherwise a permission key
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_group ON kb_docs (group_id, category);

-- Group news / announcements.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  created_at INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT ''          -- 'public' | '' (signed-in staff) | a permission key
);
-- Existing databases: ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts (group_id, pinned, id);

-- Roster: departments (divisions/units), who is in them, and callsigns / badge numbers.
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5b8def',
  description TEXT,
  head_roblox_id TEXT,
  head_name TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_group ON departments (group_id, sort);
CREATE TABLE IF NOT EXISTS member_departments (
  group_id TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  roblox_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (department_id, roblox_id)
);
CREATE INDEX IF NOT EXISTS idx_member_departments ON member_departments (group_id, roblox_id);
CREATE TABLE IF NOT EXISTS roster (
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  callsign TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, roblox_id)
);

-- Certifications: types per group, and who holds them (expiring, revocable; renewals update the row).
CREATE TABLE IF NOT EXISTS cert_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2fa58a',
  description TEXT,
  valid_days INTEGER NOT NULL DEFAULT 0,      -- 0 = never expires
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  cert_id INTEGER NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  issued_by TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,
  note TEXT,
  revoked_at INTEGER,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_certifications_member ON certifications (group_id, roblox_id);
CREATE INDEX IF NOT EXISTS idx_certifications_type ON certifications (cert_id);

-- Reports: types designed per group (form questions), and the reports filed with them.
CREATE TABLE IF NOT EXISTS report_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#5b8def',
  subject TEXT NOT NULL DEFAULT 'optional',   -- none | optional | required (a member the report is about)
  file_perm TEXT NOT NULL DEFAULT '',         -- '' = any staff may file
  view_perm TEXT NOT NULL DEFAULT '',         -- extra permission whose holders review this type (manage_reports always can)
  webhook_url TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT,
  subject_id TEXT,
  subject_name TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',        -- open | closed
  reviewer TEXT,
  review_note TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_group ON reports (group_id, status, id);
CREATE INDEX IF NOT EXISTS idx_reports_subject ON reports (group_id, subject_id);

-- System-wide settings (key → JSON), e.g. the access request form.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Access requests from accounts that signed in but are not whitelisted.
CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,                     -- google | discord
  google_email TEXT,
  discord_id TEXT,
  name TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | denied
  review_note TEXT,
  reviewer TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_status ON access_requests (status, id);
CREATE INDEX IF NOT EXISTS idx_access_google ON access_requests (google_email);
CREATE INDEX IF NOT EXISTS idx_access_discord ON access_requests (discord_id);

-- Blacklist: kicked by the in-game tracker and blocked from applying. Entries are removed, never deleted.
CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  username TEXT,
  reason TEXT NOT NULL,
  evidence TEXT,
  expires_at INTEGER,                         -- NULL = permanent
  author TEXT,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_blacklist_member ON blacklist (group_id, roblox_id);

-- Game bridge: live servers, dashboard -> game commands, admin-system moderation log, duty time.
CREATE TABLE IF NOT EXISTS game_servers (
  group_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  place_id TEXT,
  players TEXT NOT NULL DEFAULT '[]',          -- [{userId, username, displayName, rank, role, idle, onDuty, dutyLabel}]
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_cmd INTEGER NOT NULL DEFAULT 0,         -- highest game_commands.id delivered to this server
  PRIMARY KEY (group_id, job_id)
);
CREATE TABLE IF NOT EXISTS game_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  job_id TEXT,                                  -- NULL = every server
  type TEXT NOT NULL,                           -- announce | kick | shutdown
  data TEXT NOT NULL DEFAULT '{}',
  author TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gc_group ON game_commands (group_id, id);
CREATE TABLE IF NOT EXISTS moderation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  roblox_id TEXT,
  username TEXT,
  action TEXT NOT NULL,                         -- kick | ban | unban | warn | mute | other
  reason TEXT,
  duration INTEGER,                             -- seconds; -1 = permanent
  moderator_id TEXT,
  moderator TEXT,
  source TEXT,                                  -- Adonis, Basic Admin, HD Admin, Kohl's Admin, Dashboard...
  job_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_group ON moderation (group_id, id);
CREATE INDEX IF NOT EXISTS idx_mod_member ON moderation (group_id, roblox_id);
