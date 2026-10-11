// Append-only. Never edit a shipped migration; add a new one.
export const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
CREATE TABLE groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#8b8981', sort REAL NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#8b8981'
);
CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  serial INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  color TEXT NOT NULL DEFAULT '#0b0b0a',
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  sort REAL NOT NULL DEFAULT 0,
  cdp_port INTEGER,
  pid INTEGER,
  chrome_path TEXT,
  startup_urls TEXT NOT NULL DEFAULT '[]',
  window TEXT NOT NULL DEFAULT '{"width":1280,"height":900}',
  downloads_dir TEXT,
  approval_required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'closed',
  status_error TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  age_tier TEXT NOT NULL DEFAULT 'new',
  login_state TEXT NOT NULL DEFAULT 'unknown',
  cookie_expires_at TEXT,
  last_checked_at TEXT,
  secret BLOB,
  has_username INTEGER NOT NULL DEFAULT 0,
  has_password INTEGER NOT NULL DEFAULT 0,
  has_totp INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX accounts_brand ON accounts(brand_id);
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  hash TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER, width INTEGER, height INTEGER, fps REAL, codec TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  thumb TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  platform_fit TEXT NOT NULL DEFAULT '{}',
  fit_notes TEXT NOT NULL DEFAULT '{}',
  added_at TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE watch_folders (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, tags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  account_ids TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL,
  asset_ids TEXT NOT NULL DEFAULT '[]',
  caption TEXT NOT NULL DEFAULT '',
  per_platform TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  approval TEXT,
  screens TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX posts_due ON posts(status, scheduled_at);
CREATE INDEX posts_brand ON posts(brand_id);
CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  weekdays TEXT NOT NULL,
  time TEXT NOT NULL
);
CREATE TABLE flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand_scope TEXT NOT NULL DEFAULT 'one',
  brand_ids TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  schedule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT REFERENCES flows(id) ON DELETE SET NULL,
  recipe TEXT,
  brand_id TEXT NOT NULL,
  post_id TEXT,
  actor TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  screens TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
CREATE INDEX runs_started ON runs(started_at DESC);
CREATE TABLE pacing_rules (
  platform TEXT NOT NULL, age_tier TEXT NOT NULL,
  min_gap_min REAL NOT NULL, daily_max INTEGER NOT NULL, jitter_min REAL NOT NULL,
  PRIMARY KEY (platform, age_tier)
);
CREATE TABLE post_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  post_id TEXT,
  posted_at TEXT NOT NULL
);
CREATE INDEX ledger_account ON post_ledger(account_id, posted_at);
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  brand_ids TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  brand_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  screen TEXT
);
CREATE INDEX activity_at ON activity(at DESC);
CREATE INDEX activity_brand ON activity(brand_id, id DESC);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`
]
