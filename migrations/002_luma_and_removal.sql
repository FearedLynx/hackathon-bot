-- For databases created before Luma registration status and manual removal were added.
ALTER TABLE events ADD COLUMN reg_status TEXT;
ALTER TABLE events ADD COLUMN removed_at TEXT;
ALTER TABLE events ADD COLUMN removed_by TEXT;
ALTER TABLE events ADD COLUMN removed_reason TEXT;
