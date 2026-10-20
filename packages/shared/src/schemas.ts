/**
 * SupplySense Shared Schemas & Domain Types
 * Covers all 17 architectural modules: Requirements, TinyFish API Contracts,
 * Normalized Candidates, Field Provenance, Deterministic Constraint Checks,
 * Total Cost Breakdowns, Multi-File Intelligence, Watchlist, Memory, and Reports.
 */

export type SourcingCategory =
  | 'engineering_electronics'
  | 'consumer_products'
  | 'industrial_b2b'
  | 'software_cloud_apis'
  | 'vendors_services'
  | 'research_education'
  | 'complete_project_bom';

export type VerificationStatus =
  | 'VERIFIED_MATCH'
  | 'VERIFIED_MISMATCH'
  | 'UNVERIFIED'
  | 'CONFLICTING_EVIDENCE'
  | 'ESTIMATED'
  | 'STALE';

export type AvailabilityDistinction =
  | 'ADVERTISED_ONLY'
  | 'APPEARS_AVAILABLE'
  | 'EXPLICITLY_CONFIRMED_IN_STOCK'
  | 'OUT_OF_STOCK_CONFIRMED'
  | 'UNKNOWN_OR_STALE';

export interface MandatorySpecConstraint {
  id: string;
  field: string;
  label: string;
  operator: 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'contains' | 'one_of' | 'boolean';
  expectedValue: string | number | boolean | string[];
  unit?: string;
  isHardConstraint: boolean; // true = mandatory hard constraint, false = soft preference
}

export interface ProcurementRequirement {
  id: string;
  rawPrompt: string;
  category: SourcingCategory;
  productType: string;
  searchQuery: string;
  intendedUse?: string;
  quantity: number;
  currency: string;
  maxUnitPrice?: number;
  maxTotalBudget?: number;
  mandatorySpecs: MandatorySpecConstraint[];
  preferredSpecs: MandatorySpecConstraint[];
  brandInclusions: string[];
  brandExclusions: string[];
  sellerRequirements: string[];
  country: string;
  deliveryPincode?: string;
  maxDeliveryDays?: number;
  minWarrantyMonths?: number;
  returnPolicyRequired?: boolean;
  maxMoq?: number;
  taxInvoiceOrGstRequired?: boolean;
  assumptionsMade: string[];
  clarificationQuestions: string[];
  ambiguityDetected: boolean;
  contradictionsDetected: string[];
  createdAt: string;
}

export interface FieldEvidence {
  field: string;
  rawValue: string | number | boolean | null;
  normalizedValue: string | number | boolean | null;
  unit?: string;
  sourceType: 'tinyfish_fetch' | 'tinyfish_agent' | 'tinyfish_search_snippet' | 'uploaded_file';
  sourceUrlOrFile: string;
  sourceName: string;
  citationLocator?: string; // e.g. "Page 2", "Sheet 'Quotes' Cell D4", "HTML [class*=price]"
  verbatimQuote: string;
  retrievedAt: string;
  status: VerificationStatus;
  confidence: number; // 0.0 to 1.0 (never a substitute for status)
}

export interface CandidateProduct {
  id: string;
  name: string;
  category: SourcingCategory;
  description: string;
  brand?: string;
  model?: string;
  supplierName: string;
  supplierUrl: string;
  productUrl: string;
  listedUnitPrice: number | null;
  currency: string;
  unitBasis: string; // e.g., "per unit", "pack of 5"
  packQuantity: number;
  shippingCost: number | null;
  shippingStatus: 'CONFIRMED' | 'ESTIMATED' | 'FREE_CONFIRMED' | 'UNKNOWN';
  taxRatePercent: number | null;
  taxIncludedInListedPrice: boolean | null;
  taxInvoiceSupported: boolean | null;
  availabilityState: AvailabilityDistinction;
  stockQuantityText?: string;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  deliveryPincodeVerified?: string | null;
  warrantyMonths: number | null;
  returnPolicyDays: number | null;
  moq: number;
  sellerRating?: number | null;
  sellerReviewCount?: number | null;
  specifications: Record<string, string | number | boolean | null>;
  fieldEvidence: Record<string, FieldEvidence>;
  retrievedAt: string;
  dataOrigin: 'TINYFISH_LIVE' | 'UPLOADED_DOCUMENT' | 'LOCAL_MOCK_SANDBOX';
}

export interface ConstraintCheckResult {
  constraintId: string;
  field: string;
  label: string;
  isHardConstraint: boolean;
  expectedCondition: string;
  observedValue: string;
  status: VerificationStatus;
  passed: boolean;
  reason: string;
  evidence?: FieldEvidence;
}

export interface TotalCostBreakdown {
  candidateId: string;
  quantityRequested: number;
  packsNeeded: number;
  unitListedPrice: number | null;
  currency: string;
  normalizedCurrency: string;
  exchangeRateUsed: number | null;
  subtotalConfirmed: number | null;
  shippingCost: number | null;
  shippingStatus: 'CONFIRMED' | 'ESTIMATED' | 'FREE_CONFIRMED' | 'UNKNOWN';
  taxAmount: number | null;
  taxStatus: 'INCLUDED' | 'CALCULATED_CONFIRMED' | 'ESTIMATED' | 'UNKNOWN';
  discountAmount: number;
  totalEstimatedCost: number | null;
  effectiveCostPerUnit: number | null;
  isFinalCostConfirmed: boolean;
  unconfirmedCostElements: string[];
  withinUnitBudget: boolean | null;
  withinTotalBudget: boolean | null;
  budgetDelta: number | null; // positive = remaining budget, negative = overrun
}

export interface CandidateEvaluation {
  candidate: CandidateProduct;
  eligible: boolean;
  overallVerificationStatus: VerificationStatus;
  hardConstraintsPassed: number;
  hardConstraintsTotal: number;
  hardConstraintsFailed: number;
  hardConstraintsUnverified: number;
  softPreferencesMatched: number;
  softPreferencesTotal: number;
  constraintChecks: ConstraintCheckResult[];
  rejectionReasons: string[];
  missingEvidenceFields: string[];
  conflictingEvidenceFields: string[];
  costBreakdown: TotalCostBreakdown;
  rankingScore: number;
  rankingBreakdown: {
    complianceScore: number;
    specFitScore: number;
    costEfficiencyScore: number;
    sellerReliabilityScore: number;
    deliveryFeasibilityScore: number;
    evidenceFreshnessScore: number;
    verificationCompletenessScore: number;
  };
  tradeoffs: {
    pros: string[];
    cons: string[];
  };
  groundedSummary: string;
}

// ============================================================================
// TinyFish Official API Contracts (Verified against docs.tinyfish.ai)
// ============================================================================

export interface TinyFishSearchParams {
  query: string;
  purpose?: string;
  location?: string;
  language?: string;
  include_domains?: string;
  exclude_domains?: string;
  recency_minutes?: number;
  after_date?: string;
  before_date?: string;
  domain_type?: 'web' | 'news' | 'research_paper';
  pub_year_min?: number;
  pub_year_max?: number;
  page?: number;
}

export interface TinyFishSearchResultItem {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  date?: string;
  publisher?: string;
  authors?: string[];
  venue?: string;
  year?: number;
  cited_by_count?: number;
  pdf_url?: string;
}

export interface TinyFishSearchResponse {
  query: string;
  results: TinyFishSearchResultItem[];
  total_results: number;
  page: number;
}

export interface TinyFishFetchParams {
  urls: string[];
  purpose?: string;
  format?: 'markdown' | 'html' | 'json';
  links?: boolean;
  image_links?: boolean;
  iframe_links?: boolean;
  ttl?: number;
  per_url_timeout_ms?: number;
  include_etag_and_last_modified?: boolean;
  if_none_match?: string;
  if_modified_since?: string;
  include_selectors?: string[];
  exclude_selectors?: string[];
}

export interface TinyFishFetchResultItem {
  url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  language: string | null;
  author: string | null;
  published_date: string | null;
  text: string | Record<string, unknown> | null;
  links?: string[];
  image_links?: string[];
  iframe_links?: string[];
  not_modified?: boolean;
  etag?: string;
  last_modified?: string;
  latency_ms: number | null;
  format: string;
}

export interface TinyFishFetchErrorItem {
  url: string;
  error:
    | 'target_http_error'
    | 'page_not_found'
    | 'target_unreachable'
    | 'timeout'
    | 'bot_blocked'
    | 'empty_content'
    | 'login_required'
    | 'content_too_large'
    | 'invalid_url'
    | 'invalid_redirect_url'
    | 'proxy_error'
    | 'conditional_unsupported'
    | 'selector_not_matched'
    | 'selector_unsupported';
  status?: number;
  unmatched_selectors?: string[];
  candidate_selectors?: string[];
}

export interface TinyFishFetchResponse {
  results: TinyFishFetchResultItem[];
  errors: TinyFishFetchErrorItem[];
}

export interface TinyFishAgentRunParams {
  url: string;
  goal: string;
  browser_profile?: 'lite' | 'stealth';
  proxy_config?: {
    enabled: boolean;
    country_code?: string;
  };
  use_profile?: boolean;
  profile_id?: string;
  use_vault?: boolean;
}

// ============================================================================
// Multi-File Intelligence & Cross-File Reasoning Types
// ============================================================================

export interface ExtractedFileFact {
  id: string;
  fileId: string;
  fileName: string;
  fileFormat: string;
  locator: string; // e.g., "Page 1", "Sheet 'BOM' Row 4", "Slide 2"
  factType: 'requirement' | 'bom_item' | 'supplier_quote' | 'specification' | 'term_condition' | 'warning';
  entityName: string;
  field: string;
  value: string | number | boolean;
  unit?: string;
  verbatimExcerpt: string;
  confidence: number;
}

export interface CrossFileConflict {
  id: string;
  itemOrField: string;
  severity: 'HIGH_CONTRADICTION' | 'HIDDEN_COST' | 'MISSING_SPEC' | 'DUPLICATE_ENTRY';
  description: string;
  sourceA: { fileName: string; locator: string; value: string };
  sourceB: { fileName: string; locator: string; value: string };
  resolutionRecommendation: string;
}

export interface ParsedFileArtifact {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  formatSupported: boolean;
  status: 'PARSED' | 'PARTIAL' | 'UNSUPPORTED' | 'REJECTED_SECURITY';
  securityWarnings: string[];
  extractedTextPreview: string;
  facts: ExtractedFileFact[];
  bomItems: Array<{
    partNumber: string;
    description: string;
    quantity: number;
    targetUnitPrice?: number;
    mandatorySpecSummary: string;
    locator: string;
  }>;
  parsedAt: string;
}

// ============================================================================
// Memory, Watchlist, Projects & Background Job Types
// ============================================================================

export interface MemoryRecord {
  id: string;
  userId: string;
  projectId?: string | null;
  memoryScope: 'USER_PREFERENCE' | 'PROJECT_FACT' | 'TASK_CONTEXT';
  key: string;
  value: string;
  provenance: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  userId: string;
  projectId?: string | null;
  candidateName: string;
  productUrl: string;
  supplierName: string;
  currency: string;
  targetPriceThreshold?: number;
  requireInStock: boolean;
  maxDeliveryDays?: number;
  requiredUnverifiedSpecField?: string;
  checkIntervalMinutes: number;
  lastCheckedAt: string;
  conditionMet: boolean;
  alertMessage?: string;
  snapshots: Array<{
    timestamp: string;
    observedPrice: number | null;
    availabilityState: AvailabilityDistinction;
    sourceUrl: string;
    isStale: boolean;
  }>;
}
