/**
 * TinyFish Live Research & Web Agent Integration Adapter
 * Official Endpoints (Verified from https://docs.tinyfish.ai/):
 * - Search API: GET https://api.search.tinyfish.ai
 * - Fetch API:  POST https://api.fetch.tinyfish.ai
 * - Fetch Usage: GET https://api.fetch.tinyfish.ai/usage
 * - Agent SSE:  POST https://agent.tinyfish.ai/v1/automation/run-sse
 * - Agent Sync: POST https://agent.tinyfish.ai/v1/automation/run
 * All endpoints authenticate via the `X-API-Key` HTTP header.
 */

import {
  type TinyFishSearchParams,
  type TinyFishSearchResponse,
  type TinyFishFetchParams,
  type TinyFishFetchResponse,
  type TinyFishAgentRunParams,
  type CandidateProduct,
  type ProcurementRequirement,
  validateSafeExternalUrl,
  sanitizeAgainstPromptInjection,
} from '../../../packages/shared/src/index.js';

export interface TinyFishConfig {
  apiKey: string;
  mode: 'live' | 'mock';
  searchBaseUrl?: string;
  fetchBaseUrl?: string;
  agentBaseUrl?: string;
  rateLimitPerMinute?: number;
  searchTimeoutMs?: number;
  fetchTimeoutMs?: number;
  agentTimeoutMs?: number;
}

export class TinyFishError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly retryable: boolean;

  constructor(message: string, statusCode: number, errorCode: string, retryable = false) {
    super(message);
    this.name = 'TinyFishError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}

export class TinyFishAdapter {
  private readonly apiKey: string;
  private readonly mode: 'live' | 'mock';
  private readonly searchBaseUrl: string;
  private readonly fetchBaseUrl: string;
  private readonly agentBaseUrl: string;
  private readonly rateLimitPerMinute: number;
  private readonly searchTimeoutMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly agentTimeoutMs: number;
  private requestTimestamps: number[] = [];

  constructor(config: TinyFishConfig) {
    this.apiKey = (config.apiKey || '').trim();
    this.mode = config.mode;
    this.searchBaseUrl = config.searchBaseUrl || 'https://api.search.tinyfish.ai';
    this.fetchBaseUrl = config.fetchBaseUrl || 'https://api.fetch.tinyfish.ai';
    this.agentBaseUrl = config.agentBaseUrl || 'https://agent.tinyfish.ai/v1/automation';
    this.rateLimitPerMinute = config.rateLimitPerMinute ?? 30;
    this.searchTimeoutMs = config.searchTimeoutMs ?? 10000;
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 150000; // Per official docs: >= 150s for 120s CDN ceiling
    this.agentTimeoutMs = config.agentTimeoutMs ?? 120000;
  }

  public getExecutionModeLabel(): 'TINYFISH_LIVE' | 'LOCAL_MOCK_SANDBOX' {
    return this.mode === 'live' ? 'TINYFISH_LIVE' : 'LOCAL_MOCK_SANDBOX';
  }

  private checkCredentialsAndRateLimit(): void {
    if (this.mode === 'live') {
      if (!this.apiKey || !this.apiKey.startsWith('sk-tinyfish-')) {
        throw new TinyFishError(
          'Missing or invalid TinyFish API key (must start with sk-tinyfish-).',
          401,
          'INVALID_API_KEY',
          false
        );
      }
    }
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60000);
    if (this.requestTimestamps.length >= this.rateLimitPerMinute) {
      throw new TinyFishError(
        `Client-side rate limit reached (${this.rateLimitPerMinute} req/min).`,
        429,
        'RATE_LIMIT_EXCEEDED',
        true
      );
    }
    this.requestTimestamps.push(now);
  }

  /**
   * Build validated Search API request URL & headers per https://docs.tinyfish.ai/search-api/reference
   */
  public buildSearchRequest(params: TinyFishSearchParams): {
    url: string;
    method: 'GET';
    headers: Record<string, string>;
  } {
    if (!params.query || !params.query.trim()) {
      throw new TinyFishError('Missing required query parameter.', 400, 'INVALID_SEARCH_PARAMS', false);
    }
    if (params.recency_minutes !== undefined && (params.after_date || params.before_date)) {
      throw new TinyFishError(
        'recency_minutes cannot be combined with after_date or before_date.',
        400,
        'INVALID_DATE_FILTERS',
        false
      );
    }
    if (params.domain_type === 'research_paper' && (params.recency_minutes || params.after_date || params.before_date)) {
      throw new TinyFishError(
        'after_date, before_date, and recency_minutes are not supported for domain_type=research_paper. Use pub_year_min/pub_year_max.',
        400,
        'INVALID_RESEARCH_PAPER_FILTERS',
        false
      );
    }
    if (params.page !== undefined && (params.page < 0 || params.page > 10)) {
      throw new TinyFishError('page parameter must be between 0 and 10.', 400, 'INVALID_PAGE_NUMBER', false);
    }

    const searchParams = new URLSearchParams();
    searchParams.set('query', params.query.trim());
    if (params.purpose) searchParams.set('purpose', params.purpose.slice(0, 2000));
    if (params.location) searchParams.set('location', params.location);
    if (params.language) searchParams.set('language', params.language);
    if (params.include_domains) searchParams.set('include_domains', params.include_domains);
    if (params.exclude_domains) searchParams.set('exclude_domains', params.exclude_domains);
    if (params.recency_minutes !== undefined) searchParams.set('recency_minutes', String(params.recency_minutes));
    if (params.after_date) searchParams.set('after_date', params.after_date);
    if (params.before_date) searchParams.set('before_date', params.before_date);
    if (params.domain_type) searchParams.set('domain_type', params.domain_type);
    if (params.pub_year_min !== undefined) searchParams.set('pub_year_min', String(params.pub_year_min));
    if (params.pub_year_max !== undefined) searchParams.set('pub_year_max', String(params.pub_year_max));
    if (params.page !== undefined) searchParams.set('page', String(params.page));

    return {
      url: `${this.searchBaseUrl}?${searchParams.toString()}`,
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey,
        Accept: 'application/json',
      },
    };
  }

  /**
   * Build validated Fetch API request per https://docs.tinyfish.ai/fetch-api/reference
   */
  public buildFetchRequest(params: TinyFishFetchParams): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  } {
    if (!Array.isArray(params.urls) || params.urls.length === 0 || params.urls.length > 10) {
      throw new TinyFishError(
        'Fetch API requires between 1 and 10 URLs per request.',
        400,
        'INVALID_URLS_BATCH',
        false
      );
    }

    for (const u of params.urls) {
      const check = validateSafeExternalUrl(u);
      if (!check.valid) {
        throw new TinyFishError(`Unsafe URL rejected: ${check.reason}`, 400, 'INVALID_URL_SSRF', false);
      }
    }

    if ((params.if_none_match || params.if_modified_since) && params.urls.length > 1) {
      throw new TinyFishError(
        'Conditional headers (if_none_match / if_modified_since) are supported for single-URL requests only.',
        400,
        'CONDITIONAL_BATCH_NOT_ALLOWED',
        false
      );
    }

    const payload: Record<string, unknown> = {
      urls: params.urls,
      format: params.format || 'markdown',
    };
    if (params.purpose && params.purpose.trim()) payload.purpose = params.purpose.trim().slice(0, 2000);
    if (params.links !== undefined) payload.links = params.links;
    if (params.image_links !== undefined) payload.image_links = params.image_links;
    if (params.iframe_links !== undefined) payload.iframe_links = params.iframe_links;
    if (params.ttl !== undefined) payload.ttl = params.ttl;
    if (params.per_url_timeout_ms !== undefined) payload.per_url_timeout_ms = params.per_url_timeout_ms;
    if (params.include_etag_and_last_modified !== undefined) {
      payload.include_etag_and_last_modified = params.include_etag_and_last_modified;
    }
    if (params.if_none_match) payload.if_none_match = params.if_none_match;
    if (params.if_modified_since) payload.if_modified_since = params.if_modified_since;
    if (params.include_selectors) payload.include_selectors = params.include_selectors;
    if (params.exclude_selectors) payload.exclude_selectors = params.exclude_selectors;

    return {
      url: this.fetchBaseUrl,
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    };
  }

  /**
   * Build validated Agent API request per https://docs.tinyfish.ai/for-coding-agents
   */
  public buildAgentRequest(
    params: TinyFishAgentRunParams,
    streaming = true
  ): {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  } {
    const check = validateSafeExternalUrl(params.url);
    if (!check.valid) {
      throw new TinyFishError(`Unsafe Agent target URL rejected: ${check.reason}`, 400, 'INVALID_URL_SSRF', false);
    }
    if (!params.goal || params.goal.trim().length < 10) {
      throw new TinyFishError(
        'Agent goal must be an explicit, structured extraction instruction.',
        400,
        'INVALID_AGENT_GOAL',
        false
      );
    }
    if (params.profile_id && !params.use_profile) {
      throw new TinyFishError('profile_id requires use_profile: true.', 400, 'INVALID_PROFILE_CONFIG', false);
    }

    return {
      url: `${this.agentBaseUrl}/${streaming ? 'run-sse' : 'run'}`,
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: streaming ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(params),
    };
  }

  /**
   * Execute TinyFish Search API call (or return clearly labeled mock results when mode === 'mock')
   */
  public async search(params: TinyFishSearchParams): Promise<TinyFishSearchResponse> {
    this.checkCredentialsAndRateLimit();
    const reqSpec = this.buildSearchRequest(params);

    if (this.mode === 'mock') {
      return {
        query: params.query,
        page: params.page ?? 0,
        total_results: 4,
        results: [
          {
            position: 1,
            site_name: 'robu.in',
            title: 'Orange 12V 300RPM Johnson Geared DC Motor (High Torque 6 kg-cm, All-Metal Gearbox)',
            snippet: 'In Stock. ₹445.00 incl. 18% GST. Rated Voltage: 12V DC. Gearbox: Full Metal Spur. Rated Torque: 6.2 kg-cm. Delivery in 3-5 business days across India.',
            url: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
          },
          {
            position: 2,
            site_name: 'robocraze.com',
            title: '12V DC Geared Motor 6 kg-cm Torque (Plastic Composite Gearbox)',
            snippet: 'In Stock. ₹380.00 incl. GST. 12V DC motor with high-density plastic composite gears, 5.5 kg-cm torque.',
            url: 'https://robocraze.com/products/12v-dc-plastic-geared-motor',
          },
          {
            position: 3,
            site_name: 'electronicscomp.com',
            title: 'ProDrive 12V Heavy Duty Metal Gearbox Motor 8 kg-cm Torque',
            snippet: 'In Stock. ₹595.00 incl. GST. 12V DC, all-metal planetary gearbox, 8.0 kg-cm rated torque.',
            url: 'https://electronicscomp.com/prodrive-12v-metal-gear-motor-8kgcm',
          },
          {
            position: 4,
            site_name: 'quartzcomponents.com',
            title: '12V Center Shaft Geared DC Motor 5.8 kg-cm',
            snippet: 'In Stock. ₹430.00. 12V DC motor, 5.8 kg-cm torque. Gearbox material not listed on summary.',
            url: 'https://quartzcomponents.com/products/12v-center-shaft-motor',
          },
        ],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.searchTimeoutMs);
    try {
      const response = await fetch(reqSpec.url, {
        method: reqSpec.method,
        headers: reqSpec.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleHttpError(response.status, 'Search API');
      }

      const data = (await response.json()) as TinyFishSearchResponse;
      if (!data || !Array.isArray(data.results)) {
        throw new TinyFishError('Malformed Search API response schema.', 502, 'MALFORMED_RESPONSE', false);
      }
      return data;
    } catch (err: unknown) {
      if (err instanceof TinyFishError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TinyFishError('TinyFish Search API timed out.', 504, 'TIMEOUT', true);
      }
      throw new TinyFishError(
        `TinyFish Search network error: ${err instanceof Error ? err.message : String(err)}`,
        503,
        'NETWORK_ERROR',
        true
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute TinyFish Fetch API call (POST https://api.fetch.tinyfish.ai)
   */
  public async fetchUrls(params: TinyFishFetchParams): Promise<TinyFishFetchResponse> {
    this.checkCredentialsAndRateLimit();
    const reqSpec = this.buildFetchRequest(params);

    if (this.mode === 'mock') {
      return {
        results: params.urls.map((u) => ({
          url: u,
          final_url: u,
          title: `Product Specification Page — ${new URL(u).hostname}`,
          description: 'Fetched product details and specification sheet',
          language: 'en',
          author: null,
          published_date: new Date().toISOString().slice(0, 10),
          text: sanitizeAgainstPromptInjection(
            `# Product Specification\nSource: ${u}\nRetrieved for deterministic verification.`
          ).sanitizedText,
          latency_ms: 420,
          format: params.format || 'markdown',
        })),
        errors: [],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await fetch(reqSpec.url, {
        method: reqSpec.method,
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.handleHttpError(response.status, 'Fetch API');
      }

      const data = (await response.json()) as TinyFishFetchResponse;
      if (!data || !Array.isArray(data.results) || !Array.isArray(data.errors)) {
        throw new TinyFishError('Malformed Fetch API response schema.', 502, 'MALFORMED_RESPONSE', false);
      }

      // Sanitize extracted text against prompt injection
      for (const item of data.results) {
        if (typeof item.text === 'string') {
          item.text = sanitizeAgainstPromptInjection(item.text).sanitizedText;
        }
      }

      return data;
    } catch (err: unknown) {
      if (err instanceof TinyFishError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TinyFishError('TinyFish Fetch API timed out.', 504, 'TIMEOUT', true);
      }
      throw new TinyFishError(
        `TinyFish Fetch network error: ${err instanceof Error ? err.message : String(err)}`,
        503,
        'NETWORK_ERROR',
        true
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private handleHttpError(status: number, apiName: string): never {
    if (status === 400) throw new TinyFishError(`${apiName}: Bad request parameter (400).`, 400, 'BAD_REQUEST', false);
    if (status === 401) throw new TinyFishError(`${apiName}: Missing or invalid API key (401).`, 401, 'UNAUTHORIZED', false);
    if (status === 402) {
      throw new TinyFishError(
        `${apiName}: Daily free allowance exhausted or wallet balance insufficient (402 INSUFFICIENT_CREDITS / FREE_ALLOWANCE_EXHAUSTED).`,
        402,
        'INSUFFICIENT_CREDITS',
        false
      );
    }
    if (status === 403) throw new TinyFishError(`${apiName}: Forbidden by upstream service (403).`, 403, 'FORBIDDEN', false);
    if (status === 422) throw new TinyFishError(`${apiName}: Invalid CSS selector syntax (422).`, 422, 'INVALID_SELECTOR', false);
    if (status === 429) throw new TinyFishError(`${apiName}: Rate limit exceeded (429).`, 429, 'RATE_LIMIT_EXCEEDED', true);
    if (status === 503) throw new TinyFishError(`${apiName}: Service temporarily unavailable (503).`, 503, 'SERVICE_UNAVAILABLE', true);
    throw new TinyFishError(`${apiName}: Upstream HTTP error (${status}).`, status, 'HTTP_ERROR', status >= 500);
  }

  /**
   * Deterministic Candidate Fixture Generator for Local Mock Sandbox Mode
   * Explicitly sets `dataOrigin: 'LOCAL_MOCK_SANDBOX'` so mock data is NEVER confused with live research.
   */
  public getSandboxCandidatesForRequirement(req: ProcurementRequirement): CandidateProduct[] {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(); // 72h old

    return [
      {
        id: 'cand_robu_metal_12v',
        name: 'Orange 12V 300RPM Johnson Geared DC Motor (Full Metal Gearbox, 6.2 kg-cm)',
        category: req.category,
        description: 'High-torque 12V DC brushed motor with precision all-metal spur gearbox and hardened D-shaft.',
        brand: 'Orange Motors',
        model: 'ORG-JG12-300M',
        supplierName: 'Robu.in (MACFOS Ltd.)',
        supplierUrl: 'https://robu.in',
        productUrl: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
        listedUnitPrice: 445,
        currency: 'INR',
        unitBasis: 'per unit',
        packQuantity: 1,
        shippingCost: 0,
        shippingStatus: 'FREE_CONFIRMED',
        taxRatePercent: 18,
        taxIncludedInListedPrice: true,
        taxInvoiceSupported: true,
        availabilityState: 'EXPLICITLY_CONFIRMED_IN_STOCK',
        stockQuantityText: '48 units in stock (Pune Warehouse)',
        deliveryDaysMin: 3,
        deliveryDaysMax: 5,
        deliveryPincodeVerified: req.deliveryPincode || '124001',
        warrantyMonths: 6,
        returnPolicyDays: 7,
        moq: 1,
        sellerRating: 4.8,
        sellerReviewCount: 312,
        specifications: {
          voltage_v: 12,
          gearbox_material: 'All-Metal Spur Gearbox',
          torque_kg_cm: 6.2,
          rpm: 300,
          shaft_diameter_mm: 6,
        },
        fieldEvidence: {
          listedUnitPrice: {
            field: 'listedUnitPrice',
            rawValue: '₹445.00 (incl. GST)',
            normalizedValue: 445,
            unit: 'INR',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Product Page',
            citationLocator: 'Section: Pricing & GST Badge',
            verbatimQuote: '₹445.00 (Inclusive of 18% GST) — Free Shipping on orders above ₹2,000',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.99,
          },
          availabilityState: {
            field: 'availabilityState',
            rawValue: '48 in stock',
            normalizedValue: 'EXPLICITLY_CONFIRMED_IN_STOCK',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Inventory Widget',
            citationLocator: 'Selector: p.stock.in-stock',
            verbatimQuote: '48 in stock — Dispatches same day before 4 PM IST',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.99,
          },
          voltage_v: {
            field: 'voltage_v',
            rawValue: '12V DC',
            normalizedValue: 12,
            unit: 'V',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Specifications Table',
            citationLocator: 'Table Row: Operating Voltage',
            verbatimQuote: 'Operating Voltage (VDC): 12V',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.99,
          },
          gearbox_material: {
            field: 'gearbox_material',
            rawValue: 'All-Metal Spur Gearbox',
            normalizedValue: 'metal',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Specifications Table',
            citationLocator: 'Table Row: Gear Material',
            verbatimQuote: 'Gear Material: Full Metal (Hardened Steel Spur Gears)',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.98,
          },
          torque_kg_cm: {
            field: 'torque_kg_cm',
            rawValue: '6.2 kg-cm',
            normalizedValue: 6.2,
            unit: 'kg-cm',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Specifications Table',
            citationLocator: 'Table Row: Rated Torque',
            verbatimQuote: 'Rated Torque: 6.2 kg-cm (Stall Torque: 18 kg-cm)',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.98,
          },
          deliveryDaysMax: {
            field: 'deliveryDaysMax',
            rawValue: '3-5 days',
            normalizedValue: 5,
            unit: 'days',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robu.in/product/orange-12v-300rpm-metal-geared-dc-motor/',
            sourceName: 'Robu.in Pincode Checker',
            citationLocator: 'Selector: #pincode-delivery-estimate',
            verbatimQuote: 'Standard Air Courier: Estimated delivery in 3 to 5 business days.',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.95,
          },
        },
        retrievedAt: nowIso,
        dataOrigin: 'LOCAL_MOCK_SANDBOX',
      },
      {
        id: 'cand_quartz_unverified_gearbox',
        name: 'Quartz 12V Center-Shaft High-Torque DC Motor (5.8 kg-cm)',
        category: req.category,
        description: '12V DC geared motor rated at 5.8 kg-cm torque; page does not specify internal gear material.',
        brand: 'Quartz Generic',
        model: 'QC-CS12-58',
        supplierName: 'Quartz Components',
        supplierUrl: 'https://quartzcomponents.com',
        productUrl: 'https://quartzcomponents.com/products/12v-center-shaft-motor',
        listedUnitPrice: 450,
        currency: 'INR',
        unitBasis: 'per unit',
        packQuantity: 1,
        shippingCost: 60,
        shippingStatus: 'CONFIRMED',
        taxRatePercent: 18,
        taxIncludedInListedPrice: true,
        taxInvoiceSupported: true,
        availabilityState: 'EXPLICITLY_CONFIRMED_IN_STOCK',
        stockQuantityText: '19 units in stock',
        deliveryDaysMin: 4,
        deliveryDaysMax: 6,
        warrantyMonths: null,
        returnPolicyDays: 5,
        moq: 1,
        sellerRating: 4.4,
        sellerReviewCount: 84,
        specifications: {
          voltage_v: 12,
          gearbox_material: null, // Unknown -> must be flagged UNVERIFIED, never VERIFIED_MATCH
          torque_kg_cm: 5.8,
        },
        fieldEvidence: {
          listedUnitPrice: {
            field: 'listedUnitPrice',
            rawValue: 'Rs. 450.00',
            normalizedValue: 450,
            unit: 'INR',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://quartzcomponents.com/products/12v-center-shaft-motor',
            sourceName: 'Quartz Components Product Page',
            citationLocator: 'Selector: .price-item--regular',
            verbatimQuote: 'Rs. 450.00 Tax included. Shipping Rs. 60 flat rate.',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.98,
          },
          voltage_v: {
            field: 'voltage_v',
            rawValue: '12V',
            normalizedValue: 12,
            unit: 'V',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://quartzcomponents.com/products/12v-center-shaft-motor',
            sourceName: 'Quartz Spec Bullet List',
            citationLocator: 'Bullet 1',
            verbatimQuote: 'Rated Voltage: 12V DC',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.96,
          },
          torque_kg_cm: {
            field: 'torque_kg_cm',
            rawValue: '5.8 kg-cm',
            normalizedValue: 5.8,
            unit: 'kg-cm',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://quartzcomponents.com/products/12v-center-shaft-motor',
            sourceName: 'Quartz Spec Bullet List',
            citationLocator: 'Bullet 3',
            verbatimQuote: 'Rated Torque: 5.8 kg-cm',
            retrievedAt: nowIso,
            status: 'VERIFIED_MATCH',
            confidence: 0.96,
          },
        },
        retrievedAt: nowIso,
        dataOrigin: 'LOCAL_MOCK_SANDBOX',
      },
      {
        id: 'cand_robocraze_plastic_rejected',
        name: 'Robocraze 12V EcoGear DC Motor (Plastic Gearbox, 5.5 kg-cm)',
        category: req.category,
        description: 'Low-cost 12V DC motor with nylon/plastic composite internal gears.',
        brand: 'EcoGear',
        model: 'EG-12V-PL55',
        supplierName: 'Robocraze',
        supplierUrl: 'https://robocraze.com',
        productUrl: 'https://robocraze.com/products/12v-dc-plastic-geared-motor',
        listedUnitPrice: 420,
        currency: 'INR',
        unitBasis: 'per unit',
        packQuantity: 1,
        shippingCost: 0,
        shippingStatus: 'FREE_CONFIRMED',
        taxRatePercent: 18,
        taxIncludedInListedPrice: true,
        taxInvoiceSupported: true,
        availabilityState: 'EXPLICITLY_CONFIRMED_IN_STOCK',
        stockQuantityText: 'In Stock (110+ units)',
        deliveryDaysMin: 3,
        deliveryDaysMax: 5,
        warrantyMonths: 3,
        returnPolicyDays: 7,
        moq: 1,
        sellerRating: 4.5,
        sellerReviewCount: 145,
        specifications: {
          voltage_v: 12,
          gearbox_material: 'plastic',
          torque_kg_cm: 5.5,
        },
        fieldEvidence: {
          gearbox_material: {
            field: 'gearbox_material',
            rawValue: 'Plastic (POM Nylon)',
            normalizedValue: 'plastic',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://robocraze.com/products/12v-dc-plastic-geared-motor',
            sourceName: 'Robocraze Technical Specifications',
            citationLocator: 'Table Row: Gearbox Construction',
            verbatimQuote: 'Gearbox Construction: High-density POM plastic primary & secondary stages',
            retrievedAt: nowIso,
            status: 'VERIFIED_MISMATCH',
            confidence: 0.99,
          },
        },
        retrievedAt: nowIso,
        dataOrigin: 'LOCAL_MOCK_SANDBOX',
      },
      {
        id: 'cand_electronicscomp_overbudget_rejected',
        name: 'ProDrive 12V Planetary All-Metal Gear Motor (8.0 kg-cm)',
        category: req.category,
        description: 'Industrial planetary metal gearbox 12V DC motor; exceeds ₹500 unit price cap.',
        brand: 'ProDrive',
        model: 'PD-12P-80',
        supplierName: 'ElectronicsComp',
        supplierUrl: 'https://electronicscomp.com',
        productUrl: 'https://electronicscomp.com/prodrive-12v-metal-gear-motor-8kgcm',
        listedUnitPrice: 595,
        currency: 'INR',
        unitBasis: 'per unit',
        packQuantity: 1,
        shippingCost: 50,
        shippingStatus: 'CONFIRMED',
        taxRatePercent: 18,
        taxIncludedInListedPrice: true,
        taxInvoiceSupported: true,
        availabilityState: 'EXPLICITLY_CONFIRMED_IN_STOCK',
        stockQuantityText: '14 units available',
        deliveryDaysMin: 4,
        deliveryDaysMax: 6,
        warrantyMonths: 12,
        returnPolicyDays: 7,
        moq: 1,
        sellerRating: 4.2,
        sellerReviewCount: 67,
        specifications: {
          voltage_v: 12,
          gearbox_material: 'All-Metal Planetary',
          torque_kg_cm: 8.0,
        },
        fieldEvidence: {
          listedUnitPrice: {
            field: 'listedUnitPrice',
            rawValue: '₹595.00',
            normalizedValue: 595,
            unit: 'INR',
            sourceType: 'tinyfish_fetch',
            sourceUrlOrFile: 'https://electronicscomp.com/prodrive-12v-metal-gear-motor-8kgcm',
            sourceName: 'ElectronicsComp Product Listing',
            citationLocator: 'Selector: #product-price',
            verbatimQuote: 'Price: ₹595.00 (incl. all taxes)',
            retrievedAt: nowIso,
            status: 'VERIFIED_MISMATCH',
            confidence: 0.99,
          },
        },
        retrievedAt: staleIso,
        dataOrigin: 'LOCAL_MOCK_SANDBOX',
      },
    ];
  }
}
