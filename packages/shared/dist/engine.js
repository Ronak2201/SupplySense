/**
 * SupplySense Core Procurement Pipeline Engine
 * Implements:
 * 1. Deterministic Natural Language & Structured Requirement Parser
 * 2. Deterministic Hard-Constraint Verification Engine (Step 4)
 * 3. Deterministic Total Cost & Currency Normalization Calculator (Step 5)
 * 4. Transparent Multi-Factor Candidate Ranking Engine (Step 6)
 * 5. Grounded Evidence-Backed Explanation Builder (Step 7)
 * 6. Cross-File Knowledge & Contradiction Engine + Prompt Injection & SSRF Guards
 */



const STALE_THRESHOLD_MS = 1000 * 60 * 60 * 48; // 48 hours

const STATIC_EXCHANGE_RATES_TO_INR = {
  INR: 1,
  USD: 84.0,
  EUR: 91.5,
  GBP: 108.0,
};

/**
 * Step 1: Parse natural language or structured input into a validated ProcurementRequirement.
 * Detects missing essential information, contradictory constraints, and distinguishes
 * hard constraints from soft preferences.
 */
export function parseProcurementRequest(
  rawPrompt,
  overrides = {},
  userMemories = []
) {
  const trimmed = (rawPrompt || '').trim();
  if (!trimmed && !overrides.productType) {
    throw new Error('INVALID_REQUEST: Procurement request cannot be empty.');
  }

  const lower = trimmed.toLowerCase();
  const assumptionsMade = [];
  const clarificationQuestions = [];
  const contradictionsDetected = [];
  const mandatorySpecs = [];
  const preferredSpecs = [];

  // Category detection
  let category = overrides.category || 'consumer_products';
  if (/(motor|gearbox|sensor|microcontroller|esp32|stm32|ic|mosfet|resistor|capacitor|pcb|oscilloscope|bom)/i.test(lower)) {
    category = 'engineering_electronics';
  } else if (/(moq|wholesale|bulk|manufacturer|distributor|iso 9001|quotation)/i.test(lower)) {
    category = 'industrial_b2b';
  } else if (/(saas|api|cloud|hosting|sdk|database|subscription|license)/i.test(lower)) {
    category = 'software_cloud_apis';
  } else if (/(agency|contractor|consulting|audit|logistics provider|vendor)/i.test(lower)) {
    category = 'vendors_services';
  } else if (/(grant|fellowship|course|curriculum|lab kit|university)/i.test(lower)) {
    category = 'research_education';
  } else if (/(establish a lab|complete project|setup a workshop|office setup)/i.test(lower)) {
    category = 'complete_project_bom';
  }

  // Quantity parsing
  const wordNumbers = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    twelve: 12, fifteen: 15, twenty: 20, fifty: 50, hundred: 100,
  };
  let quantity = overrides.quantity ?? 1;
  const qtyDigitMatch = trimmed.match(/\b(?:find|buy|need|order|source|procure|get)\s+(\d+)\b/i) ||
    trimmed.match(/\b(\d+)\s+(?:units?|pieces?|pcs|nos|motors?|cards?|laptops?|sensors?|modules?)\b/i);
  const qtyWordMatch = trimmed.match(/\b(?:find|buy|need|order|source|procure|get)\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|fifty|hundred)\b/i);
  if (overrides.quantity !== undefined) {
    quantity = overrides.quantity;
  } else if (qtyDigitMatch) {
    quantity = parseInt(qtyDigitMatch[1], 10);
  } else if (qtyWordMatch) {
    quantity = wordNumbers[qtyWordMatch[1].toLowerCase()] || 1;
  } else {
    assumptionsMade.push('Defaulted quantity to 1 unit (not explicitly specified in prompt).');
  }

  // Currency & Price parsing
  let currency = overrides.currency || '';
  if (!currency) {
    if (/₹|\binr\b|\brupees?\b|\brs\.?\b/i.test(trimmed)) currency = 'INR';
    else if (/\$|\busd\b|\bdollars?\b/i.test(trimmed)) currency = 'USD';
    else if (/€|\beur\b|\beuros?\b/i.test(trimmed)) currency = 'EUR';
    else if (/£|\bgbp\b/i.test(trimmed)) currency = 'GBP';
    else {
      const memCurr = userMemories.find((m) => m.enabled && m.key === 'preferred_currency');
      currency = memCurr ? memCurr.value : 'INR';
      assumptionsMade.push(`Applied currency ${currency} from ${memCurr ? 'user memory' : 'regional default'}.`);
    }
  }

  let maxUnitPrice = overrides.maxUnitPrice;
  let maxTotalBudget = overrides.maxTotalBudget;

  const unitPriceMatch =
    trimmed.match(/(?:under|below|max|less than|<=?)\s*(?:₹|\$|€|£|inr|usd|rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(?:each|per\s+unit|apiece|\/unit)/i) ||
    trimmed.match(/(?:unit\s+price)\s*(?:under|below|max|less than|<=?)\s*(?:₹|\$|€|£|inr|usd|rs\.?)?\s*([\d,]+(?:\.\d+)?)/i);
  if (unitPriceMatch && maxUnitPrice === undefined) {
    maxUnitPrice = parseFloat(unitPriceMatch[1].replace(/,/g, ''));
  }

  const totalBudgetMatch =
    trimmed.match(/(?:total\s+budget|overall\s+budget|total\s+under|total\s+below)\s*(?:of\s*)?(?:₹|\$|€|£|inr|usd|rs\.?)?\s*([\d,]+(?:\.\d+)?)/i);
  if (totalBudgetMatch && maxTotalBudget === undefined) {
    maxTotalBudget = parseFloat(totalBudgetMatch[1].replace(/,/g, ''));
  }

  // Fallback generic "under ₹500" when "each" or "total" isn't explicitly separated
  if (maxUnitPrice === undefined && maxTotalBudget === undefined) {
    const genericBudgetMatch = trimmed.match(/(?:under|below|within\s+budget\s+of|max)\s*(?:₹|\$|€|£|inr|usd|rs\.?)\s*([\d,]+(?:\.\d+)?)/i);
    if (genericBudgetMatch) {
      const val = parseFloat(genericBudgetMatch[1].replace(/,/g, ''));
      if (quantity === 1 || /\beach\b/i.test(trimmed)) {
        maxUnitPrice = val;
      } else {
        maxUnitPrice = val;
        assumptionsMade.push(`Interpreted budget limit (${currency} ${val}) as maximum unit price.`);
      }
    }
  }

  // Contradiction check: e.g., maxTotalBudget < maxUnitPrice * quantity or "under 500 and above 800"
  const minPriceMatch = trimmed.match(/(?:above|over|more\s+than|at\s+least)\s*(?:₹|\$|€|£|inr|usd|rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(?:each|per\s+unit)?/i);
  if (minPriceMatch && maxUnitPrice !== undefined) {
    const minVal = parseFloat(minPriceMatch[1].replace(/,/g, ''));
    if (minVal > maxUnitPrice && /price|cost|₹|\$/i.test(minPriceMatch[0])) {
      contradictionsDetected.push(
        `Contradictory price constraints: minimum price (${minVal}) exceeds maximum unit price (${maxUnitPrice}).`
      );
    }
  }
  if (maxUnitPrice !== undefined && maxTotalBudget !== undefined && maxTotalBudget < maxUnitPrice * quantity * 0.5) {
    contradictionsDetected.push(
      `Total budget (${currency} ${maxTotalBudget}) is lower than ${quantity} units at max unit price (${currency} ${maxUnitPrice}).`
    );
  }

  // Delivery deadline parsing
  let maxDeliveryDays = overrides.maxDeliveryDays;
  const deliveryMatch =
    trimmed.match(/(?:within|in|under|by)\s+(\d+|one|two|three|four|five|six|seven|ten|fourteen)\s+(?:business\s+)?days?/i);
  if (deliveryMatch && maxDeliveryDays === undefined) {
    const rawDays = deliveryMatch[1].toLowerCase();
    maxDeliveryDays = wordNumbers[rawDays] ?? parseInt(rawDays, 10);
  }

  // Country & Pincode
  let country = overrides.country || (/\bindia\b|₹|\binr\b|\bpincode\b/i.test(trimmed) ? 'IN' : 'US');
  let deliveryPincode = overrides.deliveryPincode;
  const pinMatch = trimmed.match(/\b(\d{6})\b/);
  if (pinMatch && !deliveryPincode) {
    deliveryPincode = pinMatch[1];
  } else if (/to\s+my\s+pincode/i.test(trimmed) && !deliveryPincode) {
    const memPin = userMemories.find((m) => m.enabled && m.key === 'delivery_pincode');
    if (memPin) {
      deliveryPincode = memPin.value;
      assumptionsMade.push(`Used saved delivery pincode (${deliveryPincode}) from user memory.`);
    } else {
      clarificationQuestions.push('Which 6-digit delivery pincode should we verify shipping availability and delivery timelines against?');
    }
  }

  // Technical specifications extraction (Voltage, Gearbox, Torque, RAM, VRAM, Warranty, GST)
  const voltageMatch = trimmed.match(/\b(\d+(?:\.\d+)?)\s*V(?:DC|AC)?\b/i);
  if (voltageMatch) {
    mandatorySpecs.push({
      id: 'spec_voltage',
      field: 'voltage_v',
      label: 'Rated Voltage (V)',
      operator: 'eq',
      expectedValue: parseFloat(voltageMatch[1]),
      unit: 'V',
      isHardConstraint: true,
    });
  }

  if (/\bmetal\s+gearbox\b|\ball[- ]metal\s+gears?\b/i.test(trimmed)) {
    mandatorySpecs.push({
      id: 'spec_gearbox_material',
      field: 'gearbox_material',
      label: 'Gearbox Material',
      operator: 'contains',
      expectedValue: 'metal',
      isHardConstraint: true,
    });
  } else if (/\bplastic\s+gearbox\b/i.test(trimmed)) {
    mandatorySpecs.push({
      id: 'spec_gearbox_material',
      field: 'gearbox_material',
      label: 'Gearbox Material',
      operator: 'contains',
      expectedValue: 'plastic',
      isHardConstraint: true,
    });
  }

  const torqueMatch = trimmed.match(/torque\s+(?:above|over|at\s+least|>=?|>)\s*(\d+(?:\.\d+)?)\s*(kg[- ]?cm|nm|oz[- ]?in)/i);
  if (torqueMatch) {
    mandatorySpecs.push({
      id: 'spec_torque_min',
      field: 'torque_kg_cm',
      label: 'Rated Torque (kg-cm)',
      operator: 'gt',
      expectedValue: parseFloat(torqueMatch[1]),
      unit: torqueMatch[2].toLowerCase(),
      isHardConstraint: true,
    });
  }

  const vramMatch = trimmed.match(/\b(\d+)\s*GB\s+VRAM\b/i);
  if (vramMatch) {
    mandatorySpecs.push({
      id: 'spec_vram_gb',
      field: 'vram_gb',
      label: 'VRAM Capacity (GB)',
      operator: 'gte',
      expectedValue: parseInt(vramMatch[1], 10),
      unit: 'GB',
      isHardConstraint: true,
    });
  }

  // Warranty & GST
  let minWarrantyMonths = overrides.minWarrantyMonths;
  const warrantyYrMatch = trimmed.match(/(\d+)\s*[- ]?year\s+warranty/i);
  const warrantyMoMatch = trimmed.match(/(\d+)\s*[- ]?month\s+warranty/i);
  if (warrantyYrMatch && minWarrantyMonths === undefined) {
    minWarrantyMonths = parseInt(warrantyYrMatch[1], 10) * 12;
  } else if (warrantyMoMatch && minWarrantyMonths === undefined) {
    minWarrantyMonths = parseInt(warrantyMoMatch[1], 10);
  }

  const taxInvoiceOrGstRequired =
    overrides.taxInvoiceOrGstRequired ?? /\b(gst\s+invoice|tax\s+invoice|b2b\s+invoice|gstin)\b/i.test(trimmed);

  // Soft preferences detection ("prefer", "ideally", "nice to have")
  const preferBrandMatch = trimmed.match(/(?:prefer|ideally)\s+([a-zA-Z0-9_-]+)\s+brand/i);
  if (preferBrandMatch) {
    preferredSpecs.push({
      id: 'pref_brand',
      field: 'brand',
      label: `Preferred Brand (${preferBrandMatch[1]})`,
      operator: 'contains',
      expectedValue: preferBrandMatch[1],
      isHardConstraint: false,
    });
  }

  // Merge any explicit mandatorySpecs from overrides
  if (overrides.mandatorySpecs && overrides.mandatorySpecs.length > 0) {
    for (const spec of overrides.mandatorySpecs) {
      if (!mandatorySpecs.some((s) => s.field === spec.field)) {
        mandatorySpecs.push(spec);
      }
    }
  }

  // Ambiguity detection for overly vague queries
  if (
    trimmed.split(/\s+/).length < 4 &&
    maxUnitPrice === undefined &&
    maxTotalBudget === undefined &&
    mandatorySpecs.length === 0
  ) {
    clarificationQuestions.push(
      'What is your target unit budget or total budget, and are there mandatory technical specifications or delivery deadlines?'
    );
  }

  // Determine clean search query & productType
  let productType = overrides.productType || 'General Procurement Item';
  if (/12v\s+dc\s+motor/i.test(trimmed)) productType = '12V DC Geared Motor';
  else if (/graphics\s+card|rtx|gpu/i.test(trimmed)) productType = 'Graphics Card (GPU)';
  else if (/oscilloscope/i.test(trimmed)) productType = 'Digital Storage Oscilloscope';
  else if (/esp32/i.test(trimmed)) productType = 'ESP32 Wi-Fi/BLE Microcontroller Module';
  else {
    productType = trimmed.slice(0, 60);
  }

  const searchQuery =
    overrides.searchQuery ||
    `${productType} ${mandatorySpecs.map((s) => `${s.expectedValue}${s.unit || ''}`).join(' ')} buy price ${country === 'IN' ? 'India' : ''}`.trim();

  return {
    id: overrides.id || `req_${Date.now()}`,
    rawPrompt: trimmed,
    category,
    productType,
    searchQuery,
    intendedUse: overrides.intendedUse,
    quantity,
    currency,
    maxUnitPrice,
    maxTotalBudget,
    mandatorySpecs,
    preferredSpecs: overrides.preferredSpecs || preferredSpecs,
    brandInclusions: overrides.brandInclusions || [],
    brandExclusions: overrides.brandExclusions || [],
    sellerRequirements: overrides.sellerRequirements || [],
    country,
    deliveryPincode,
    maxDeliveryDays,
    minWarrantyMonths,
    returnPolicyRequired: overrides.returnPolicyRequired,
    maxMoq: overrides.maxMoq ?? quantity,
    taxInvoiceOrGstRequired,
    assumptionsMade,
    clarificationQuestions,
    ambiguityDetected: clarificationQuestions.length > 0,
    contradictionsDetected,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Step 5: Deterministic Total Cost Calculator
 * Never claims a cost is final when taxes, shipping, or exchange rates are unknown.
 */
export function calculateTotalCost(
  candidate,
  requirement
) {
  const quantityRequested = Math.max(1, requirement.quantity);
  const packQty = Math.max(1, candidate.packQuantity || 1);
  const packsNeeded = Math.ceil(quantityRequested / packQty);

  const unconfirmedCostElements = [];
  let exchangeRateUsed = 1;

  if (candidate.currency !== requirement.currency) {
    const fromToInr = STATIC_EXCHANGE_RATES_TO_INR[candidate.currency];
    const reqToInr = STATIC_EXCHANGE_RATES_TO_INR[requirement.currency];
    if (fromToInr && reqToInr) {
      exchangeRateUsed = Number((fromToInr / reqToInr).toFixed(4));
    } else {
      exchangeRateUsed = null;
      unconfirmedCostElements.push(`Unsupported currency conversion (${candidate.currency} -> ${requirement.currency})`);
    }
  }

  if (candidate.listedUnitPrice === null || exchangeRateUsed === null) {
    unconfirmedCostElements.push('Listed unit price unavailable or unconvertible');
    return {
      candidateId: candidate.id,
      quantityRequested,
      packsNeeded,
      unitListedPrice: candidate.listedUnitPrice,
      currency: candidate.currency,
      normalizedCurrency: requirement.currency,
      exchangeRateUsed,
      subtotalConfirmed: null,
      shippingCost: candidate.shippingCost,
      shippingStatus: candidate.shippingStatus,
      taxAmount: null,
      taxStatus: 'UNKNOWN',
      discountAmount: 0,
      totalEstimatedCost: null,
      effectiveCostPerUnit: null,
      isFinalCostConfirmed: false,
      unconfirmedCostElements,
      withinUnitBudget: null,
      withinTotalBudget: null,
      budgetDelta: null,
    };
  }

  const normalizedUnitListedPrice = Number((candidate.listedUnitPrice * exchangeRateUsed).toFixed(2));
  const subtotalConfirmed = Number((normalizedUnitListedPrice * packsNeeded).toFixed(2));

  // Shipping
  let shippingNormalized = null;
  if (candidate.shippingStatus === 'FREE_CONFIRMED') {
    shippingNormalized = 0;
  } else if (candidate.shippingCost !== null) {
    shippingNormalized = Number((candidate.shippingCost * exchangeRateUsed).toFixed(2));
    if (candidate.shippingStatus === 'ESTIMATED') {
      unconfirmedCostElements.push('Shipping charge is an estimate');
    }
  } else {
    unconfirmedCostElements.push('Shipping charge not stated on source page');
  }

  // Taxes / GST
  let taxAmount = null;
  let taxStatus = 'UNKNOWN';
  if (candidate.taxIncludedInListedPrice === true) {
    taxAmount = 0;
    taxStatus = 'INCLUDED';
  } else if (candidate.taxRatePercent !== null && candidate.taxIncludedInListedPrice === false) {
    taxAmount = Number(((subtotalConfirmed * candidate.taxRatePercent) / 100).toFixed(2));
    taxStatus = 'CALCULATED_CONFIRMED';
  } else {
    unconfirmedCostElements.push('Tax/GST inclusion status not confirmed by source');
  }

  const totalEstimatedCost = Number(
    (subtotalConfirmed + (shippingNormalized ?? 0) + (taxAmount ?? 0)).toFixed(2)
  );
  const effectiveCostPerUnit = Number((totalEstimatedCost / quantityRequested).toFixed(2));
  const isFinalCostConfirmed = unconfirmedCostElements.length === 0;

  const withinUnitBudget =
    requirement.maxUnitPrice !== undefined
      ? normalizedUnitListedPrice <= requirement.maxUnitPrice
      : true;

  const totalBudgetCap =
    requirement.maxTotalBudget !== undefined
      ? requirement.maxTotalBudget
      : requirement.maxUnitPrice !== undefined
        ? requirement.maxUnitPrice * quantityRequested
        : undefined;

  const withinTotalBudget =
    totalBudgetCap !== undefined ? totalEstimatedCost <= totalBudgetCap : true;

  const budgetDelta =
    totalBudgetCap !== undefined ? Number((totalBudgetCap - totalEstimatedCost).toFixed(2)) : null;

  return {
    candidateId: candidate.id,
    quantityRequested,
    packsNeeded,
    unitListedPrice: normalizedUnitListedPrice,
    currency: candidate.currency,
    normalizedCurrency: requirement.currency,
    exchangeRateUsed,
    subtotalConfirmed,
    shippingCost: shippingNormalized,
    shippingStatus: candidate.shippingStatus,
    taxAmount,
    taxStatus,
    discountAmount: 0,
    totalEstimatedCost,
    effectiveCostPerUnit,
    isFinalCostConfirmed,
    unconfirmedCostElements,
    withinUnitBudget,
    withinTotalBudget,
    budgetDelta,
  };
}

/**
 * Step 4, 6 & 7: Deterministic Constraint Verification, Ranking & Grounded Explanation Engine
 * Never allows an unknown field to pass as VERIFIED_MATCH.
 * Never allows a cheaper incompatible product to outrank a compliant product.
 */
export function evaluateAndRankCandidates(
  candidates,
  requirement,
  referenceNowMs = Date.now()
) {
  const evaluations = candidates.map((candidate) => {
    const checks = [];
    const rejectionReasons = [];
    const missingEvidenceFields = [];
    const conflictingEvidenceFields = [];

    const costBreakdown = calculateTotalCost(candidate, requirement);

    // Check staleness
    const retrievedMs = Date.parse(candidate.retrievedAt);
    const isStale = !Number.isNaN(retrievedMs) && referenceNowMs - retrievedMs > STALE_THRESHOLD_MS;

    // 1. Availability check (Hard constraint: must not be confirmed out of stock or advertised-only when buying now)
    if (candidate.availabilityState === 'OUT_OF_STOCK_CONFIRMED') {
      checks.push({
        constraintId: 'chk_availability',
        field: 'availabilityState',
        label: 'Stock Availability',
        isHardConstraint: true,
        expectedCondition: 'In Stock',
        observedValue: candidate.stockQuantityText || 'Out of Stock',
        status: 'VERIFIED_MISMATCH',
        passed: false,
        reason: `Explicitly out of stock (${candidate.stockQuantityText || 'Out of Stock'}).`,
        evidence: candidate.fieldEvidence['availabilityState'],
      });
      rejectionReasons.push(`Rejected: Product is explicitly out of stock at ${candidate.supplierName}.`);
    } else if (
      candidate.availabilityState === 'UNKNOWN_OR_STALE' ||
      candidate.availabilityState === 'ADVERTISED_ONLY'
    ) {
      checks.push({
        constraintId: 'chk_availability',
        field: 'availabilityState',
        label: 'Stock Availability',
        isHardConstraint: true,
        expectedCondition: 'Confirmed In Stock',
        observedValue: candidate.availabilityState,
        status: isStale ? 'STALE' : 'UNVERIFIED',
        passed: false,
        reason:
          candidate.availabilityState === 'ADVERTISED_ONLY'
            ? 'Listing is a search snippet/advertisement only; live stock status not confirmed on product page.'
            : 'Stock availability could not be verified from source page.',
        evidence: candidate.fieldEvidence['availabilityState'],
      });
      missingEvidenceFields.push('availabilityState');
    } else {
      checks.push({
        constraintId: 'chk_availability',
        field: 'availabilityState',
        label: 'Stock Availability',
        isHardConstraint: true,
        expectedCondition: 'In Stock',
        observedValue: candidate.stockQuantityText || candidate.availabilityState,
        status: isStale ? 'STALE' : 'VERIFIED_MATCH',
        passed: !isStale,
        reason: isStale
          ? 'Stock was previously confirmed but snapshot is older than 48 hours (Stale).'
          : `Confirmed available (${candidate.stockQuantityText || 'In Stock'}).`,
        evidence: candidate.fieldEvidence['availabilityState'],
      });
      if (isStale) missingEvidenceFields.push('availabilityState (stale)');
    }

    // 2. Unit Price Constraint
    if (requirement.maxUnitPrice !== undefined) {
      const unitEv = candidate.fieldEvidence['listedUnitPrice'];
      if (unitEv?.status === 'CONFLICTING_EVIDENCE') {
        checks.push({
          constraintId: 'chk_unit_price',
          field: 'listedUnitPrice',
          label: `Max Unit Price (<= ${requirement.currency} ${requirement.maxUnitPrice})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxUnitPrice}`,
          observedValue: `Conflicting (${candidate.listedUnitPrice})`,
          status: 'CONFLICTING_EVIDENCE',
          passed: false,
          reason: `Source page contains conflicting prices (${unitEv.verbatimQuote}).`,
          evidence: unitEv,
        });
        conflictingEvidenceFields.push('listedUnitPrice');
      } else if (costBreakdown.unitListedPrice === null) {
        checks.push({
          constraintId: 'chk_unit_price',
          field: 'listedUnitPrice',
          label: `Max Unit Price (<= ${requirement.currency} ${requirement.maxUnitPrice})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxUnitPrice}`,
          observedValue: 'Unknown',
          status: 'UNVERIFIED',
          passed: false,
          reason: 'Unit price is missing or requires quote on request.',
          evidence: unitEv,
        });
        missingEvidenceFields.push('listedUnitPrice');
      } else if (costBreakdown.unitListedPrice > requirement.maxUnitPrice) {
        checks.push({
          constraintId: 'chk_unit_price',
          field: 'listedUnitPrice',
          label: `Max Unit Price (<= ${requirement.currency} ${requirement.maxUnitPrice})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxUnitPrice}`,
          observedValue: `${requirement.currency} ${costBreakdown.unitListedPrice}`,
          status: 'VERIFIED_MISMATCH',
          passed: false,
          reason: `Unit price ${requirement.currency} ${costBreakdown.unitListedPrice} exceeds mandatory limit of ${requirement.currency} ${requirement.maxUnitPrice}.`,
          evidence: unitEv,
        });
        rejectionReasons.push(
          `Rejected: Unit price (${requirement.currency} ${costBreakdown.unitListedPrice}) exceeds maximum unit budget (${requirement.currency} ${requirement.maxUnitPrice}).`
        );
      } else {
        checks.push({
          constraintId: 'chk_unit_price',
          field: 'listedUnitPrice',
          label: `Max Unit Price (<= ${requirement.currency} ${requirement.maxUnitPrice})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxUnitPrice}`,
          observedValue: `${requirement.currency} ${costBreakdown.unitListedPrice}`,
          status: isStale ? 'STALE' : 'VERIFIED_MATCH',
          passed: !isStale,
          reason: `Unit price ${requirement.currency} ${costBreakdown.unitListedPrice} is within the ${requirement.currency} ${requirement.maxUnitPrice} limit.`,
          evidence: unitEv,
        });
      }
    }

    // 3. Total Budget Constraint
    if (requirement.maxTotalBudget !== undefined) {
      if (costBreakdown.totalEstimatedCost === null) {
        checks.push({
          constraintId: 'chk_total_budget',
          field: 'totalEstimatedCost',
          label: `Max Total Budget (<= ${requirement.currency} ${requirement.maxTotalBudget})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxTotalBudget}`,
          observedValue: 'Unknown',
          status: 'UNVERIFIED',
          passed: false,
          reason: 'Total cost cannot be calculated without unit price.',
        });
        missingEvidenceFields.push('totalEstimatedCost');
      } else if (costBreakdown.totalEstimatedCost > requirement.maxTotalBudget) {
        checks.push({
          constraintId: 'chk_total_budget',
          field: 'totalEstimatedCost',
          label: `Max Total Budget (<= ${requirement.currency} ${requirement.maxTotalBudget})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxTotalBudget}`,
          observedValue: `${requirement.currency} ${costBreakdown.totalEstimatedCost}`,
          status: 'VERIFIED_MISMATCH',
          passed: false,
          reason: `Total cost ${requirement.currency} ${costBreakdown.totalEstimatedCost} exceeds total budget ${requirement.currency} ${requirement.maxTotalBudget}.`,
        });
        rejectionReasons.push(
          `Rejected: Total order cost (${requirement.currency} ${costBreakdown.totalEstimatedCost}) exceeds total budget (${requirement.currency} ${requirement.maxTotalBudget}).`
        );
      } else {
        checks.push({
          constraintId: 'chk_total_budget',
          field: 'totalEstimatedCost',
          label: `Max Total Budget (<= ${requirement.currency} ${requirement.maxTotalBudget})`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.currency} ${requirement.maxTotalBudget}`,
          observedValue: `${requirement.currency} ${costBreakdown.totalEstimatedCost}`,
          status: costBreakdown.isFinalCostConfirmed ? 'VERIFIED_MATCH' : 'ESTIMATED',
          passed: true,
          reason: costBreakdown.isFinalCostConfirmed
            ? `Confirmed total cost ${requirement.currency} ${costBreakdown.totalEstimatedCost} fits budget.`
            : `Estimated total cost ${requirement.currency} ${costBreakdown.totalEstimatedCost} fits budget, but ${costBreakdown.unconfirmedCostElements.join('; ')}.`,
        });
      }
    }

    // 4. MOQ Constraint
    if (candidate.moq > requirement.quantity) {
      checks.push({
        constraintId: 'chk_moq',
        field: 'moq',
        label: `Minimum Order Quantity (<= ${requirement.quantity})`,
        isHardConstraint: true,
        expectedCondition: `MOQ <= ${requirement.quantity}`,
        observedValue: `MOQ ${candidate.moq}`,
        status: 'VERIFIED_MISMATCH',
        passed: false,
        reason: `Supplier requires MOQ of ${candidate.moq} units, which exceeds requested quantity of ${requirement.quantity}.`,
        evidence: candidate.fieldEvidence['moq'],
      });
      rejectionReasons.push(
        `Rejected: Supplier MOQ (${candidate.moq} units) exceeds required quantity (${requirement.quantity} units).`
      );
    }

    // 5. Delivery Deadline Constraint
    if (requirement.maxDeliveryDays !== undefined) {
      if (candidate.deliveryDaysMax === null) {
        checks.push({
          constraintId: 'chk_delivery',
          field: 'deliveryDaysMax',
          label: `Delivery Deadline (<= ${requirement.maxDeliveryDays} days)`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.maxDeliveryDays} days`,
          observedValue: 'Unknown',
          status: 'UNVERIFIED',
          passed: false,
          reason: 'Delivery timeline is not stated on the source page.',
          evidence: candidate.fieldEvidence['deliveryDaysMax'],
        });
        missingEvidenceFields.push('deliveryDaysMax');
      } else if (candidate.deliveryDaysMax > requirement.maxDeliveryDays) {
        checks.push({
          constraintId: 'chk_delivery',
          field: 'deliveryDaysMax',
          label: `Delivery Deadline (<= ${requirement.maxDeliveryDays} days)`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.maxDeliveryDays} days`,
          observedValue: `${candidate.deliveryDaysMin ?? candidate.deliveryDaysMax}-${candidate.deliveryDaysMax} days`,
          status: 'VERIFIED_MISMATCH',
          passed: false,
          reason: `Estimated delivery (${candidate.deliveryDaysMax} days) exceeds deadline (${requirement.maxDeliveryDays} days).`,
          evidence: candidate.fieldEvidence['deliveryDaysMax'],
        });
        rejectionReasons.push(
          `Rejected: Delivery estimate (${candidate.deliveryDaysMax} days) exceeds required ${requirement.maxDeliveryDays}-day deadline.`
        );
      } else {
        checks.push({
          constraintId: 'chk_delivery',
          field: 'deliveryDaysMax',
          label: `Delivery Deadline (<= ${requirement.maxDeliveryDays} days)`,
          isHardConstraint: true,
          expectedCondition: `<= ${requirement.maxDeliveryDays} days`,
          observedValue: `${candidate.deliveryDaysMin ?? candidate.deliveryDaysMax}-${candidate.deliveryDaysMax} days`,
          status: 'VERIFIED_MATCH',
          passed: true,
          reason: `Delivers within ${candidate.deliveryDaysMax} days (meets <= ${requirement.maxDeliveryDays} days requirement).`,
          evidence: candidate.fieldEvidence['deliveryDaysMax'],
        });
      }
    }

    // 6. Warranty Constraint
    if (requirement.minWarrantyMonths !== undefined) {
      if (candidate.warrantyMonths === null) {
        checks.push({
          constraintId: 'chk_warranty',
          field: 'warrantyMonths',
          label: `Warranty (>= ${requirement.minWarrantyMonths} months)`,
          isHardConstraint: true,
          expectedCondition: `>= ${requirement.minWarrantyMonths} months`,
          observedValue: 'Unknown',
          status: 'UNVERIFIED',
          passed: false,
          reason: 'Warranty duration is not specified on the source page.',
          evidence: candidate.fieldEvidence['warrantyMonths'],
        });
        missingEvidenceFields.push('warrantyMonths');
      } else if (candidate.warrantyMonths < requirement.minWarrantyMonths) {
        checks.push({
          constraintId: 'chk_warranty',
          field: 'warrantyMonths',
          label: `Warranty (>= ${requirement.minWarrantyMonths} months)`,
          isHardConstraint: true,
          expectedCondition: `>= ${requirement.minWarrantyMonths} months`,
          observedValue: `${candidate.warrantyMonths} months`,
          status: 'VERIFIED_MISMATCH',
          passed: false,
          reason: `Warranty of ${candidate.warrantyMonths} months is below required ${requirement.minWarrantyMonths} months.`,
          evidence: candidate.fieldEvidence['warrantyMonths'],
        });
        rejectionReasons.push(
          `Rejected: Warranty (${candidate.warrantyMonths} months) is shorter than required (${requirement.minWarrantyMonths} months).`
        );
      } else {
        checks.push({
          constraintId: 'chk_warranty',
          field: 'warrantyMonths',
          label: `Warranty (>= ${requirement.minWarrantyMonths} months)`,
          isHardConstraint: true,
          expectedCondition: `>= ${requirement.minWarrantyMonths} months`,
          observedValue: `${candidate.warrantyMonths} months`,
          status: 'VERIFIED_MATCH',
          passed: true,
          reason: `Includes ${candidate.warrantyMonths}-month warranty.`,
          evidence: candidate.fieldEvidence['warrantyMonths'],
        });
      }
    }

    // 7. Tax Invoice / GST Constraint
    if (requirement.taxInvoiceOrGstRequired) {
      if (candidate.taxInvoiceSupported === null) {
        checks.push({
          constraintId: 'chk_gst_invoice',
          field: 'taxInvoiceSupported',
          label: 'GST / Tax Invoice Support',
          isHardConstraint: true,
          expectedCondition: 'GST/Tax Invoice Available',
          observedValue: 'Unknown',
          status: 'UNVERIFIED',
          passed: false,
          reason: 'Source does not explicitly confirm B2B GST/Tax invoice availability.',
        });
        missingEvidenceFields.push('taxInvoiceSupported');
      } else if (candidate.taxInvoiceSupported === false) {
        checks.push({
          constraintId: 'chk_gst_invoice',
          field: 'taxInvoiceSupported',
          label: 'GST / Tax Invoice Support',
          isHardConstraint: true,
          expectedCondition: 'GST/Tax Invoice Available',
          observedValue: 'Not Supported',
          status: 'VERIFIED_MISMATCH',
          passed: false,
          reason: 'Seller explicitly states no GST/Tax invoice is provided.',
        });
        rejectionReasons.push('Rejected: Seller does not provide a mandatory GST/Tax invoice.');
      } else {
        checks.push({
          constraintId: 'chk_gst_invoice',
          field: 'taxInvoiceSupported',
          label: 'GST / Tax Invoice Support',
          isHardConstraint: true,
          expectedCondition: 'GST/Tax Invoice Available',
          observedValue: 'Supported',
          status: 'VERIFIED_MATCH',
          passed: true,
          reason: 'Seller confirms B2B GST/Tax invoice availability.',
        });
      }
    }

    // 8. Evaluate Mandatory & Preferred Technical Specification Constraints
    const allSpecs = [...requirement.mandatorySpecs, ...requirement.preferredSpecs];
    for (const spec of allSpecs) {
      const rawVal = candidate.specifications[spec.field];
      const ev = candidate.fieldEvidence[spec.field];

      if (ev?.status === 'CONFLICTING_EVIDENCE') {
        checks.push({
          constraintId: spec.id,
          field: spec.field,
          label: spec.label,
          isHardConstraint: spec.isHardConstraint,
          expectedCondition: `${spec.operator} ${spec.expectedValue}${spec.unit ? ' ' + spec.unit : ''}`,
          observedValue: String(rawVal ?? 'Conflicting'),
          status: 'CONFLICTING_EVIDENCE',
          passed: false,
          reason: `Conflicting values found in source for ${spec.label}: ${ev.verbatimQuote}`,
          evidence: ev,
        });
        conflictingEvidenceFields.push(spec.field);
        continue;
      }

      if (rawVal === undefined || rawVal === null || rawVal === '') {
        checks.push({
          constraintId: spec.id,
          field: spec.field,
          label: spec.label,
          isHardConstraint: spec.isHardConstraint,
          expectedCondition: `${spec.operator} ${spec.expectedValue}${spec.unit ? ' ' + spec.unit : ''}`,
          observedValue: 'Unknown / Not stated',
          status: 'UNVERIFIED',
          passed: false,
          reason: `${spec.label} is not stated on the source page; cannot verify compliance.`,
          evidence: ev,
        });
        if (spec.isHardConstraint) {
          missingEvidenceFields.push(spec.field);
        }
        continue;
      }

      // Deterministic operator evaluation
      let matched = false;
      if (spec.operator === 'eq') {
        matched =
          typeof rawVal === 'number' && typeof spec.expectedValue === 'number'
            ? Math.abs(rawVal - spec.expectedValue) < 0.001
            : String(rawVal).toLowerCase() === String(spec.expectedValue).toLowerCase();
      } else if (spec.operator === 'gt') {
        matched = Number(rawVal) > Number(spec.expectedValue);
      } else if (spec.operator === 'gte') {
        matched = Number(rawVal) >= Number(spec.expectedValue);
      } else if (spec.operator === 'lt') {
        matched = Number(rawVal) < Number(spec.expectedValue);
      } else if (spec.operator === 'lte') {
        matched = Number(rawVal) <= Number(spec.expectedValue);
      } else if (spec.operator === 'contains') {
        const obsStr = String(rawVal).toLowerCase();
        const expStr = String(spec.expectedValue).toLowerCase();
        // Prevent "plastic with metal shaft" from falsely matching "metal gearbox"
        if (spec.field === 'gearbox_material' && expStr === 'metal' && /plastic|nylon/i.test(obsStr) && !/^all[- ]metal|^full[- ]metal|^metal$/i.test(obsStr)) {
          matched = false;
        } else {
          matched = obsStr.includes(expStr);
        }
      } else if (spec.operator === 'one_of' && Array.isArray(spec.expectedValue)) {
        matched = spec.expectedValue.map((x) => x.toLowerCase()).includes(String(rawVal).toLowerCase());
      } else if (spec.operator === 'boolean') {
        matched = Boolean(rawVal) === Boolean(spec.expectedValue);
      }

      const checkStatus = matched
        ? isStale
          ? 'STALE'
          : 'VERIFIED_MATCH'
        : 'VERIFIED_MISMATCH';

      checks.push({
        constraintId: spec.id,
        field: spec.field,
        label: spec.label,
        isHardConstraint: spec.isHardConstraint,
        expectedCondition: `${spec.operator} ${spec.expectedValue}${spec.unit ? ' ' + spec.unit : ''}`,
        observedValue: `${rawVal}${spec.unit && !String(rawVal).includes(spec.unit) ? ' ' + spec.unit : ''}`,
        status: checkStatus,
        passed: matched && !isStale,
        reason: matched
          ? `${spec.label} verified as ${rawVal}${spec.unit ? ' ' + spec.unit : ''}.`
          : `${spec.label} is ${rawVal} (violates requirement: ${spec.operator} ${spec.expectedValue}${spec.unit ? ' ' + spec.unit : ''}).`,
        evidence: ev,
      });

      if (!matched && spec.isHardConstraint) {
        rejectionReasons.push(
          `Rejected: ${spec.label} is "${rawVal}", violating mandatory constraint (${spec.operator} ${spec.expectedValue}${spec.unit ? ' ' + spec.unit : ''}).`
        );
      }
    }

    // Summarize hard & soft constraint statistics
    const hardChecks = checks.filter((c) => c.isHardConstraint);
    const softChecks = checks.filter((c) => !c.isHardConstraint);

    const hardConstraintsTotal = hardChecks.length;
    const hardConstraintsPassed = hardChecks.filter((c) => c.status === 'VERIFIED_MATCH' || c.status === 'ESTIMATED').length;
    const hardConstraintsFailed = hardChecks.filter((c) => c.status === 'VERIFIED_MISMATCH').length;
    const hardConstraintsUnverified = hardChecks.filter(
      (c) => c.status === 'UNVERIFIED' || c.status === 'CONFLICTING_EVIDENCE' || c.status === 'STALE'
    ).length;

    const softPreferencesTotal = softChecks.length;
    const softPreferencesMatched = softChecks.filter((c) => c.passed).length;

    // A candidate is eligible ONLY if it has ZERO confirmed hard constraint violations (hardConstraintsFailed === 0)
    const eligible = hardConstraintsFailed === 0;

    let overallVerificationStatus = 'VERIFIED_MATCH';
    if (hardConstraintsFailed > 0) {
      overallVerificationStatus = 'VERIFIED_MISMATCH';
    } else if (conflictingEvidenceFields.length > 0) {
      overallVerificationStatus = 'CONFLICTING_EVIDENCE';
    } else if (isStale) {
      overallVerificationStatus = 'STALE';
    } else if (hardConstraintsUnverified > 0) {
      overallVerificationStatus = 'UNVERIFIED';
    } else if (!costBreakdown.isFinalCostConfirmed) {
      overallVerificationStatus = 'ESTIMATED';
    }

    // Transparent Ranking Score Calculation (0 - 100)
    // Hard-rejected candidates are capped below 25 so an incompatible product NEVER outranks an eligible one.
    const complianceScore =
      hardConstraintsTotal > 0 ? Math.round((hardConstraintsPassed / hardConstraintsTotal) * 100) : 100;
    const verificationCompletenessScore =
      hardConstraintsTotal > 0
        ? Math.round(((hardConstraintsTotal - hardConstraintsUnverified) / hardConstraintsTotal) * 100)
        : 100;
    const specFitScore =
      softPreferencesTotal > 0
        ? Math.round((softPreferencesMatched / softPreferencesTotal) * 100)
        : complianceScore;

    // Cost efficiency score relative to budget
    let costEfficiencyScore = 50;
    if (costBreakdown.unitListedPrice !== null && requirement.maxUnitPrice) {
      const ratio = costBreakdown.unitListedPrice / requirement.maxUnitPrice;
      costEfficiencyScore = Math.max(0, Math.min(100, Math.round((1.2 - ratio) * 100)));
    } else if (costBreakdown.totalEstimatedCost !== null && requirement.maxTotalBudget) {
      const ratio = costBreakdown.totalEstimatedCost / requirement.maxTotalBudget;
      costEfficiencyScore = Math.max(0, Math.min(100, Math.round((1.2 - ratio) * 100)));
    }

    const sellerReliabilityScore = candidate.sellerRating
      ? Math.min(100, Math.round((candidate.sellerRating / 5) * 100))
      : 60;

    const deliveryFeasibilityScore =
      candidate.deliveryDaysMax !== null && requirement.maxDeliveryDays
        ? candidate.deliveryDaysMax <= requirement.maxDeliveryDays
          ? Math.min(100, Math.round(100 - (candidate.deliveryDaysMax / requirement.maxDeliveryDays) * 30))
          : 15
        : candidate.deliveryDaysMax !== null
          ? 80
          : 40;

    const evidenceFreshnessScore = isStale ? 25 : 95;

    let rankingScore = Math.round(
      complianceScore * 0.30 +
        verificationCompletenessScore * 0.20 +
        costEfficiencyScore * 0.20 +
        deliveryFeasibilityScore * 0.10 +
        sellerReliabilityScore * 0.10 +
        evidenceFreshnessScore * 0.05 +
        specFitScore * 0.05
    );

    if (!eligible) {
      rankingScore = Math.min(20, Math.max(1, Math.round(rankingScore * 0.2)));
    } else if (overallVerificationStatus === 'UNVERIFIED' || overallVerificationStatus === 'CONFLICTING_EVIDENCE') {
      // Partially unverified candidates always rank below 100% verified candidates
      rankingScore = Math.min(79, rankingScore);
    }

    // Tradeoffs & Grounded Summary
    const pros = [];
    const cons = [];

    for (const c of checks) {
      if (c.status === 'VERIFIED_MATCH') pros.push(`${c.label}: ${c.observedValue}`);
      else if (c.status === 'VERIFIED_MISMATCH') cons.push(`Violates ${c.label} (${c.observedValue})`);
      else if (c.status === 'UNVERIFIED') cons.push(`Unverified: ${c.label}`);
      else if (c.status === 'CONFLICTING_EVIDENCE') cons.push(`Conflicting evidence on ${c.label}`);
    }
    if (costBreakdown.isFinalCostConfirmed && costBreakdown.totalEstimatedCost !== null) {
      pros.push(`Confirmed total cost ${requirement.currency} ${costBreakdown.totalEstimatedCost} (incl. shipping/tax)`);
    } else if (costBreakdown.unconfirmedCostElements.length > 0) {
      cons.push(...costBreakdown.unconfirmedCostElements);
    }

    const groundedSummary = !eligible
      ? `Rejected due to ${hardConstraintsFailed} mandatory constraint violation(s): ${rejectionReasons.join(' ')}`
      : overallVerificationStatus === 'VERIFIED_MATCH'
        ? `Fully verified match across all ${hardConstraintsTotal} mandatory constraints at ${requirement.currency} ${costBreakdown.totalEstimatedCost ?? 'N/A'} total (${requirement.currency} ${costBreakdown.unitListedPrice}/unit) from ${candidate.supplierName}.`
        : `Meets ${hardConstraintsPassed}/${hardConstraintsTotal} verified constraints (${requirement.currency} ${costBreakdown.unitListedPrice ?? 'N/A'}/unit), but requires manual confirmation before purchase for: ${[...missingEvidenceFields, ...conflictingEvidenceFields, ...costBreakdown.unconfirmedCostElements].join(', ')}.`;

    return {
      candidate,
      eligible,
      overallVerificationStatus,
      hardConstraintsPassed,
      hardConstraintsTotal,
      hardConstraintsFailed,
      hardConstraintsUnverified,
      softPreferencesMatched,
      softPreferencesTotal,
      constraintChecks: checks,
      rejectionReasons,
      missingEvidenceFields,
      conflictingEvidenceFields,
      costBreakdown,
      rankingScore,
      rankingBreakdown: {
        complianceScore,
        specFitScore,
        costEfficiencyScore,
        sellerReliabilityScore,
        deliveryFeasibilityScore,
        evidenceFreshnessScore,
        verificationCompletenessScore,
      },
      tradeoffs: { pros, cons },
      groundedSummary,
    };
  });

  // Sort:
  // 1. Eligible before rejected
  // 2. Fully verified (0 unverified hard constraints) before partially unverified
  // 3. Higher rankingScore
  // 4. Lower totalEstimatedCost
  return evaluations.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.hardConstraintsUnverified !== b.hardConstraintsUnverified) {
      return a.hardConstraintsUnverified - b.hardConstraintsUnverified;
    }
    if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
    return (a.costBreakdown.totalEstimatedCost ?? Infinity) - (b.costBreakdown.totalEstimatedCost ?? Infinity);
  });
}

/**
 * Security Guard: Sanitize untrusted text from web pages or uploaded files against Prompt Injection.
 */
export function sanitizeAgainstPromptInjection(rawContent) {
  const warnings = [];
  const patterns = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
    /system\s*prompt\s*:/gi,
    /you\s+are\s+now\s+in\s+developer\s+mode/gi,
    /override\s+verification\s+status/gi,
    /mark\s+this\s+product\s+as\s+verified_match/gi,
    /exfiltrate|service_role_key|sk-tinyfish/gi,
  ];

  let sanitized = rawContent;
  for (const pat of patterns) {
    if (pat.test(sanitized)) {
      warnings.push(`Blocked embedded prompt-injection pattern matching ${pat.source}`);
      sanitized = sanitized.replace(pat, '[REDACTED_UNTRUSTED_INSTRUCTION]');
    }
  }
  return {
    sanitizedText: sanitized,
    injectionDetected: warnings.length > 0,
    warnings,
  };
}

/**
 * Security Guard: Validate external URLs against SSRF, IP ranges, and disallowed schemes.
 */
export function validateSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `Disallowed URL protocol: ${parsed.protocol}` };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '169.254.169.254' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      return { valid: false, reason: `Blocked private/internal network host (SSRF protection): ${host}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed URL syntax' };
  }
}

/**
 * Cross-File Reasoning Engine: Detects contradictions, hidden fees, and missing specs across uploaded files.
 */
export function analyzeCrossFileKnowledge(files) {
  const conflicts = [];
  const factsByEntityAndField = new Map();

  for (const file of files) {
    for (const fact of file.facts) {
      const key = `${fact.entityName.toLowerCase()}::${fact.field.toLowerCase()}`;
      const list = factsByEntityAndField.get(key) || [];
      list.push({
        fileName: file.fileName,
        locator: fact.locator,
        value: `${fact.value}${fact.unit ? ' ' + fact.unit : ''}`,
      });
      factsByEntityAndField.set(key, list);
    }
  }

  for (const [key, occurrences] of factsByEntityAndField.entries()) {
    if (occurrences.length > 1) {
      const first = occurrences[0];
      for (let i = 1; i < occurrences.length; i++) {
        const current = occurrences[i];
        if (first.value.trim().toLowerCase() !== current.value.trim().toLowerCase()) {
          const [entity, field] = key.split('::');
          conflicts.push({
            id: `conflict_${conflicts.length + 1}`,
            itemOrField: `${entity} (${field})`,
            severity: field.includes('price') || field.includes('shipping') || field.includes('gst')
              ? 'HIDDEN_COST'
              : 'HIGH_CONTRADICTION',
            description: `Discrepancy detected for ${entity} [${field}] across uploaded documents.`,
            sourceA: first,
            sourceB: current,
            resolutionRecommendation: `Request written clarification from supplier reconciling ${first.fileName} (${first.locator}: "${first.value}") vs ${current.fileName} (${current.locator}: "${current.value}").`,
          });
        }
      }
    }
  }

  const consolidatedBomCount = files.reduce((acc, f) => acc + f.bomItems.length, 0);
  return { conflicts, consolidatedBomCount };
}
