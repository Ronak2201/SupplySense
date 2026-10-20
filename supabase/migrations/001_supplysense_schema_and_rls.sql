-- ============================================================================
-- SUPPLYSENSE — COMPLETE POSTGRESQL SCHEMA & ROW LEVEL SECURITY (RLS) MIGRATION
-- File: supabase/migrations/001_supplysense_schema_and_rls.sql
-- Covers all 22 required entities with strict user-level data isolation.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'INR',
  default_country TEXT NOT NULL DEFAULT 'IN',
  memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. PROJECTS
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'engineering_electronics',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'completed')),
  currency TEXT NOT NULL DEFAULT 'INR',
  overall_budget NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_projects_user_id ON public.projects(user_id);

-- 3. CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversations_project_id ON public.conversations(project_id);

-- 4. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);

-- 5. FILES
CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'partial', 'unsupported', 'rejected_security')),
  security_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_files_user_project ON public.files(user_id, project_id);

-- 6. FILE_VERSIONS
CREATE TABLE IF NOT EXISTS public.file_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  extracted_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. EXTRACTED_FACTS
CREATE TABLE IF NOT EXISTS public.extracted_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  locator TEXT NOT NULL, -- e.g. "Page 3", "Sheet 'BOM' Cell C12", "Slide 4"
  fact_type TEXT NOT NULL CHECK (fact_type IN ('requirement', 'bom_item', 'supplier_quote', 'specification', 'term_condition', 'warning')),
  entity_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  unit TEXT,
  verbatim_excerpt TEXT NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_extracted_facts_file_id ON public.extracted_facts(file_id);

-- 8. REQUIREMENTS
CREATE TABLE IF NOT EXISTS public.requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  raw_prompt TEXT NOT NULL,
  category TEXT NOT NULL,
  product_type TEXT NOT NULL,
  search_query TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  max_unit_price NUMERIC(14, 2),
  max_total_budget NUMERIC(14, 2),
  mandatory_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  country TEXT NOT NULL DEFAULT 'IN',
  delivery_pincode TEXT,
  max_delivery_days INT,
  min_warranty_months INT,
  tax_invoice_required BOOLEAN NOT NULL DEFAULT FALSE,
  assumptions_made JSONB NOT NULL DEFAULT '[]'::jsonb,
  clarification_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  contradictions_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_requirements_user_project ON public.requirements(user_id, project_id);

-- 9. RESEARCH_RUNS
CREATE TABLE IF NOT EXISTS public.research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('TINYFISH_LIVE', 'LOCAL_MOCK_SANDBOX')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  current_stage TEXT NOT NULL DEFAULT 'Understanding requirements',
  sources_queried_count INT NOT NULL DEFAULT 0,
  eligible_candidates_count INT NOT NULL DEFAULT 0,
  rejected_candidates_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_research_runs_user_id ON public.research_runs(user_id);

-- 10. SOURCES
CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_run_id UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('tinyfish_search', 'tinyfish_fetch', 'tinyfish_agent', 'uploaded_file')),
  url TEXT NOT NULL,
  final_url TEXT,
  domain_name TEXT,
  title TEXT,
  snippet_or_markdown TEXT,
  http_status INT,
  etag TEXT,
  last_modified TEXT,
  latency_ms INT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sources_run_id ON public.sources(research_run_id);

-- 11. CANDIDATES
CREATE TABLE IF NOT EXISTS public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_run_id UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  model TEXT,
  supplier_name TEXT NOT NULL,
  supplier_url TEXT,
  product_url TEXT NOT NULL,
  listed_unit_price NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'INR',
  unit_basis TEXT NOT NULL DEFAULT 'per unit',
  pack_quantity INT NOT NULL DEFAULT 1,
  shipping_cost NUMERIC(14, 2),
  shipping_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  tax_rate_percent NUMERIC(5, 2),
  tax_included BOOLEAN,
  tax_invoice_supported BOOLEAN,
  availability_state TEXT NOT NULL,
  stock_quantity_text TEXT,
  delivery_days_min INT,
  delivery_days_max INT,
  warranty_months INT,
  moq INT NOT NULL DEFAULT 1,
  seller_rating NUMERIC(3, 2),
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligible BOOLEAN NOT NULL DEFAULT FALSE,
  overall_verification_status TEXT NOT NULL,
  ranking_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ranking_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  grounded_summary TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_candidates_run_id ON public.candidates(research_run_id);

-- 12. CANDIDATE_EVIDENCE
CREATE TABLE IF NOT EXISTS public.candidate_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  field_name TEXT NOT NULL,
  raw_value TEXT,
  normalized_value TEXT,
  unit TEXT,
  source_url_or_file TEXT NOT NULL,
  citation_locator TEXT,
  verbatim_quote TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.0,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_candidate_evidence_candidate_id ON public.candidate_evidence(candidate_id);

-- 13. CONSTRAINT_CHECKS
CREATE TABLE IF NOT EXISTS public.constraint_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  constraint_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  label TEXT NOT NULL,
  is_hard_constraint BOOLEAN NOT NULL DEFAULT TRUE,
  expected_condition TEXT NOT NULL,
  observed_value TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_constraint_checks_candidate_id ON public.constraint_checks(candidate_id);

-- 14. REJECTIONS
CREATE TABLE IF NOT EXISTS public.rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_run_id UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  failed_field TEXT NOT NULL,
  expected_condition TEXT NOT NULL,
  observed_value TEXT NOT NULL,
  explicit_reason TEXT NOT NULL,
  supporting_evidence_quote TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. RECOMMENDATIONS
CREATE TABLE IF NOT EXISTS public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_run_id UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  rank_position INT NOT NULL CHECK (rank_position >= 1),
  rationale TEXT NOT NULL,
  tradeoff_pros JSONB NOT NULL DEFAULT '[]'::jsonb,
  tradeoff_cons JSONB NOT NULL DEFAULT '[]'::jsonb,
  unconfirmed_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. DECISIONS
CREATE TABLE IF NOT EXISTS public.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  research_run_id UUID REFERENCES public.research_runs(id) ON DELETE SET NULL,
  selected_candidate_id UUID REFERENCES public.candidates(id) ON DELETE SET NULL,
  decision_status TEXT NOT NULL CHECK (decision_status IN ('shortlisted', 'approved_for_purchase', 'rejected_by_buyer', 'needs_vendor_quote')),
  notes TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. MEMORIES (User Preferences, Project Facts, Task Context)
CREATE TABLE IF NOT EXISTS public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  memory_scope TEXT NOT NULL CHECK (memory_scope IN ('USER_PREFERENCE', 'PROJECT_FACT', 'TASK_CONTEXT')),
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  provenance TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_memories_user_scope ON public.memories(user_id, memory_scope);

-- 18. WATCHLIST
CREATE TABLE IF NOT EXISTS public.watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  candidate_name TEXT NOT NULL,
  product_url TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  target_price_threshold NUMERIC(14, 2),
  require_in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  max_delivery_days INT,
  required_unverified_spec_field TEXT,
  check_interval_minutes INT NOT NULL DEFAULT 360 CHECK (check_interval_minutes >= 15),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  condition_met BOOLEAN NOT NULL DEFAULT FALSE,
  last_alert_message TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_watchlist_user_active ON public.watchlist(user_id, is_active);

-- 19. PRICE_SNAPSHOTS
CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  watchlist_id UUID NOT NULL REFERENCES public.watchlist(id) ON DELETE CASCADE,
  observed_price NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'INR',
  availability_state TEXT NOT NULL,
  source_url TEXT NOT NULL,
  etag TEXT,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_price_snapshots_watchlist_id ON public.price_snapshots(watchlist_id, observed_at DESC);

-- 20. BACKGROUND_JOBS
CREATE TABLE IF NOT EXISTS public.background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('research_run', 'file_ingestion', 'watchlist_recheck', 'report_generation')),
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress_stage TEXT NOT NULL DEFAULT 'Queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 2,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_background_jobs_user_status ON public.background_jobs(user_id, status);

-- 21. REPORTS
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  research_run_id UUID REFERENCES public.research_runs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'pdf', 'xlsx', 'docx', 'pptx', 'json', 'md')),
  storage_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. AUDIT_EVENTS
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_events_user_created ON public.audit_events(user_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — STRICT USER ISOLATION ACROSS ALL 22 TABLES
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'profiles', 'projects', 'conversations', 'messages', 'files', 'file_versions',
    'extracted_facts', 'requirements', 'research_runs', 'sources', 'candidates',
    'candidate_evidence', 'constraint_checks', 'rejections', 'recommendations',
    'decisions', 'memories', 'watchlist', 'price_snapshots', 'background_jobs',
    'reports', 'audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

    IF tbl = 'profiles' THEN
      EXECUTE 'CREATE POLICY profiles_isolation_policy ON public.profiles
               FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);';
    ELSE
      EXECUTE format(
        'CREATE POLICY %I_isolation_policy ON public.%I
         FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;
