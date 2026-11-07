-- Analytics (#111): how many times each page was opened each day. No cookie, no IP, no user agent: just a count.
CREATE TABLE page_counts (
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
);
