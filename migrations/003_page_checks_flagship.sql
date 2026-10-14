-- Details read from each event's own page, and flagship marking.
ALTER TABLE events ADD COLUMN prize_detail TEXT;
ALTER TABLE events ADD COLUMN eligibility TEXT;
ALTER TABLE events ADD COLUMN verify_note TEXT;
ALTER TABLE events ADD COLUMN flagship INTEGER NOT NULL DEFAULT 0;
-- Re-check every Devpost/Luma event with the new page checks.
UPDATE events SET deadline_checked = 0 WHERE source IN ('devpost', 'luma');
