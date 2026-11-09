-- Admin console: the day each account last used BetterCad, so the admin page can show who is active. Set at most once
-- a day per account, on the first signed-in request of that day. Older accounts start blank.
ALTER TABLE accounts ADD COLUMN last_seen TEXT;
