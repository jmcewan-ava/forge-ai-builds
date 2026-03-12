-- ═══════════════════════════════════════════════════════════════════
-- FORGE AI — Complete Migration
-- Run this entire file in Supabase SQL Editor once.
-- Idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ── api_costs table (persistent cost tracking across cold starts) ──

CREATE TABLE IF NOT EXISTS api_costs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_role    text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd      numeric(10, 8) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_costs_project_id_idx ON api_costs (project_id);
CREATE INDEX IF NOT EXISTS api_costs_created_at_idx ON api_costs (created_at DESC);

ALTER TABLE api_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to api_costs"
    ON api_costs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── file_locks table (cross-lambda file locking for parallel agents) ──

CREATE TABLE IF NOT EXISTS file_locks (
  filepath        text PRIMARY KEY,
  workstream_id   text NOT NULL,
  acquired_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS file_locks_workstream_id_idx ON file_locks (workstream_id);
CREATE INDEX IF NOT EXISTS file_locks_expires_at_idx    ON file_locks (expires_at);

ALTER TABLE file_locks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to file_locks"
    ON file_locks FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Additional workstream columns ──

ALTER TABLE workstreams ADD COLUMN IF NOT EXISTS github_merge_sha   text;
ALTER TABLE workstreams ADD COLUMN IF NOT EXISTS github_merged_at   timestamptz;

-- ── Cleanup job: auto-delete expired locks (optional but nice) ──
-- This prevents the file_locks table from growing forever.
-- Uncomment if you have pg_cron enabled on your Supabase plan:
--
-- SELECT cron.schedule('cleanup-expired-locks', '*/5 * * * *',
--   $$DELETE FROM file_locks WHERE expires_at < now()$$
-- );
