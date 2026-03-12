-- ============================================================
-- FORGE AI — Migration: agent_logs table
-- Run in Supabase SQL Editor
-- ============================================================

-- Brief 4: Store full agent conversation logs for debugging
CREATE TABLE IF NOT EXISTS agent_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workstream_id text NOT NULL,
  agent_role text NOT NULL,       -- 'builder', 'qa_manager', 'office_manager'
  model text NOT NULL,
  system_prompt text,
  user_message text,
  response_text text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,8) NOT NULL DEFAULT 0,
  iteration integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_logs_project_id_idx ON agent_logs(project_id);
CREATE INDEX IF NOT EXISTS agent_logs_workstream_id_idx ON agent_logs(workstream_id);
CREATE INDEX IF NOT EXISTS agent_logs_created_at_idx ON agent_logs(created_at DESC);

ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to agent_logs"
    ON agent_logs FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Optional: execute_read_query RPC for the admin query panel
-- This allows the Supabase inspector to run SELECT queries
-- ============================================================

CREATE OR REPLACE FUNCTION execute_read_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Safety: only allow SELECT and WITH
  IF NOT (
    upper(trim(query_text)) LIKE 'SELECT%' OR
    upper(trim(query_text)) LIKE 'WITH%'
  ) THEN
    RAISE EXCEPTION 'Only SELECT and WITH queries are permitted';
  END IF;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query_text || ') t'
    INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION execute_read_query TO service_role;
