-- For databases created before registration deadlines were added.
ALTER TABLE events ADD COLUMN reg_deadline TEXT;
ALTER TABLE events ADD COLUMN deadline_checked INTEGER NOT NULL DEFAULT 0;
