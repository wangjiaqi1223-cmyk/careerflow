CREATE INDEX jobs_by_user_day ON daily_jobs(user_id, day);
CREATE INDEX profiles_enabled ON search_profiles(enabled, user_id);
CREATE TABLE scheduler_claims (
 user_id TEXT NOT NULL,
 day TEXT NOT NULL,
 state TEXT NOT NULL,
 token TEXT NOT NULL,
 lease_until TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,day)
);
CREATE TABLE search_budget (
 day TEXT PRIMARY KEY,
 requests INTEGER NOT NULL DEFAULT 0
);
