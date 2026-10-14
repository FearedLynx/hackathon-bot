CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,      -- "<source>:<sourceId>"
  source TEXT NOT NULL,                 -- devpost | mlh | dev.events
  title TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,             -- normalized title, for cross-source dedupe
  url TEXT NOT NULL,                    -- event page
  source_url TEXT NOT NULL,             -- where we found it
  start_date TEXT NOT NULL,             -- YYYY-MM-DD
  end_date TEXT NOT NULL,
  location TEXT,
  country TEXT,                         -- ISO 3166-1 alpha-2
  mode TEXT NOT NULL,                   -- online | in-person | hybrid
  category TEXT NOT NULL,               -- denmark | europe | online-short | online-long
  prize TEXT,
  team_size TEXT,
  themes TEXT,
  fingerprint TEXT NOT NULL,
  reg_deadline TEXT,                    -- ISO UTC timestamp, when the source publishes one
  deadline_checked INTEGER NOT NULL DEFAULT 0, -- 1 once the event's own page has been checked
  prize_detail TEXT,                    -- prize as stated on the event page (preferred over the listing)
  eligibility TEXT,                     -- "Students only · Ages 18+ …" from the event page
  verify_note TEXT,                     -- warnings from the page check
  flagship INTEGER NOT NULL DEFAULT 0,  -- matches /config flagship
  reg_status TEXT,                      -- when there is no fixed deadline (Luma)
  removed_at TEXT,                      -- set when someone removes it in Discord; hidden everywhere
  removed_by TEXT,                      -- Discord user id
  removed_reason TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT,
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS events_start ON events(start_date);
CREATE INDEX IF NOT EXISTS events_dedupe ON events(dedupe_key);

CREATE TABLE IF NOT EXISTS interest (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  remind INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                 -- mode | daily_hour | timezone | channel_id | categories | last_digest_date
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- 7d | 1d
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id, kind)
);
