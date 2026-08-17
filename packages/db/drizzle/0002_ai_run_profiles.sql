-- AI run profiles.
--
-- Records how a run was executed, not just what it was given: which model, at
-- what reasoning depth, and what it cost. Before this, `provider_version` held
-- the command-line tool's version, so "which model produced this proposal"
-- had no answer once a workspace ran more than one.
--
-- Also moves execution settings onto the provider policy, so the argument
-- vector for a local process is decided by the side that already owns context
-- filtering rather than by the desktop client.

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------

ALTER TABLE ai_runs
  ADD COLUMN model text,
  ADD COLUMN effort text,
  ADD COLUMN cost_usd numeric(12, 6),
  ADD COLUMN input_tokens integer,
  ADD COLUMN output_tokens integer;

-- Deliberately not backfilled. A run recorded before profiles existed has an
-- unknown model, and writing today's default into it would put a guess in the
-- audit trail.

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_effort_check
    CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high', 'xhigh', 'max'));

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_cost_check
    CHECK (cost_usd IS NULL OR cost_usd >= 0);

-- ---------------------------------------------------------------------------
-- Provider policy
-- ---------------------------------------------------------------------------

ALTER TABLE ai_provider_policies
  ADD COLUMN allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN allowed_efforts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN default_model text,
  ADD COLUMN setting_sources jsonb NOT NULL DEFAULT '["user"]'::jsonb,
  ADD COLUMN isolated boolean NOT NULL DEFAULT false,
  ADD COLUMN max_budget_usd numeric(8, 4);

ALTER TABLE ai_provider_policies
  ADD CONSTRAINT ai_provider_policies_budget_check
    CHECK (max_budget_usd IS NULL OR max_budget_usd >= 0);

-- The empty default means a provider configured from here on cannot run until
-- an administrator chooses a model. Rows that already exist are different: an
-- administrator already approved this provider, and leaving them empty would
-- silently break a working workspace on upgrade. Backfilling the conservative
-- default continues an approval that was already given rather than granting a
-- new one.
UPDATE ai_provider_policies
SET
  allowed_models = '["claude-opus-5"]'::jsonb,
  default_model = 'claude-opus-5',
  allowed_efforts = '["low", "medium", "high", "xhigh", "max"]'::jsonb
WHERE allowed_models = '[]'::jsonb;
