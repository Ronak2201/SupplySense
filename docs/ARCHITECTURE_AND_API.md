# SupplySense Architecture, API Contracts & Security Specification

## 1. Seventeen-Module System Architecture

1. **User Interface & Workspace (`apps/web` + Canvas App)**: 10-view responsive dark/light SaaS workspace.
2. **Authentication & Authorization (`supabase/migrations` + `apps/api/src/db/repository.ts`)**: Forced Row Level Security (RLS) across all 22 PostgreSQL tables plus server-side `authenticatedUserId` checks.
3. **Request & Requirement Parser (`packages/shared/src/engine.ts`)**: Extracts typed `ProcurementRequirement` objects, separates hard constraints from soft preferences, records assumptions, and detects contradictions and ambiguities.
4. **TinyFish Integration Adapter (`apps/api/src/services/tinyfishAdapter.ts`)**: Implements official TinyFish Search (`GET https://api.search.tinyfish.ai`), Fetch (`POST https://api.fetch.tinyfish.ai`), Fetch Usage (`GET https://api.fetch.tinyfish.ai/usage`), and Web Agent (`POST https://agent.tinyfish.ai/v1/automation/run-sse` & `/run`) with `X-API-Key` authentication.
5. **Website Research Orchestration**: Coordinates Search discovery, batch Fetch extraction (up to 10 URLs/request, 150s client timeout), and conditional ETag/Last-Modified re-verification.
6. **Product & Supplier Extraction**: Normalizes raw page markdown/HTML into `CandidateProduct` records while preserving raw vs. normalized values and field-level `FieldEvidence`.
7. **Deterministic Verification Engine (`packages/shared/src/engine.ts`)**: Evaluates every hard constraint in TypeScript (`eq`, `gt`, `gte`, `lt`, `lte`, `contains`, `one_of`, `boolean`), distinguishing `VERIFIED_MATCH`, `VERIFIED_MISMATCH`, `UNVERIFIED`, `CONFLICTING_EVIDENCE`, `ESTIMATED`, and `STALE`.
8. **Ranking & Total-Cost Calculation (`packages/shared/src/engine.ts`)**: Computes unit subtotal, pack rounding, shipping, GST/tax, currency conversion, and budget delta; guarantees incompatible products never outrank compliant products.
9. **File Ingestion & Parsing (`apps/api/src/services/fileIngestionService.ts`)**: Parses BOMs, quotations, and specs with page/sheet/row/cell provenance locators.
10. **Cross-File Knowledge Extraction**: Detects contradictions (e.g. plastic vs. metal gearbox across quote and spec sheet) and hidden fees (unbundled shipping/GST).
11. **Search History & Project Management**: Persists full runs, enables run-to-run comparison, and labels historical snapshots.
12. **User, Project & Task Memory**: Inspectable, editable, toggleable, and deletable memory records with provenance.
13. **Research Evidence & Provenance**: Every field links to source URL/filename, locator, verbatim quote, and timestamp.
14. **Watchlist & Scheduled Jobs**: Tracks target price, stock, delivery deadline, and unverified specs with `node-cron` compatibility and actual historical snapshots.
15. **Report & Export Generation (`apps/api/src/services/reportExportService.ts`)**: Generates CSV, Markdown, JSON, and printable PDF reports with SHA-256 checksums and secret-leakage scrubbing.
16. **Background Tasks & Job Status**: Queued/running/completed/failed/cancelled state machine with idempotency keys and restart recovery.
17. **Logging, Security & Testing**: SSRF private-IP blocking, Zip-Slip & decompression-bomb protection, prompt-injection sanitization, and 26 automated tests.

## 2. REST API Endpoints (`apps/api`)

- `GET /api/health` — Returns service health, active execution mode (`TINYFISH_LIVE` vs `LOCAL_MOCK_SANDBOX`), auth mode, and scheduler status.
- `POST /api/requirements/parse` — Parses natural language + structured overrides into a validated `ProcurementRequirement`.
- `POST /api/research/runs` — Executes the 7-step procurement pipeline and persists the run.
- `GET /api/research/runs` — Lists historical research runs scoped to the authenticated user.
- `POST /api/files/upload` — Safely ingests uploaded files, extracts BOM rows and facts with locators, and runs cross-file contradiction detection.
- `GET /api/files/:id/download` — Verifies user ownership before authorizing file access.
- `GET /api/projects` & `POST /api/projects` — Lists and creates isolated user projects.
- `GET /api/memories`, `POST /api/memories`, `DELETE /api/memories/:id` — Full CRUD for User Preferences, Project Facts, and Task Context.
- `POST /api/reports/export` — Generates and validates downloadable reports (CSV, Markdown, JSON).
