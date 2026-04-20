-- 008_waitlist.sql
-- Lightweight waitlist for the Hosted Relay tier signup.
-- Anon can INSERT (signups from public landing page).
-- Only secret key can SELECT (we read the list privately).

CREATE TABLE IF NOT EXISTS relay_waitlist (
  id          text PRIMARY KEY DEFAULT 'wl_' || replace(gen_random_uuid()::text, '-', ''),
  email       text NOT NULL,
  source      text DEFAULT 'relaymemory.com',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip_hash     text  -- optional, for basic dedup/abuse signal (hashed client-side)
);

-- Prevent duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON relay_waitlist (lower(email));

-- Enable RLS
ALTER TABLE relay_waitlist ENABLE ROW LEVEL SECURITY;

-- Anon can insert their own email (write-only, no read)
DROP POLICY IF EXISTS "anon_insert_waitlist" ON relay_waitlist;
CREATE POLICY "anon_insert_waitlist" ON relay_waitlist
  FOR INSERT TO anon WITH CHECK (true);

-- service_role bypasses RLS automatically (we read the list with secret key)
-- No SELECT policy for anon = anon cannot read the list
