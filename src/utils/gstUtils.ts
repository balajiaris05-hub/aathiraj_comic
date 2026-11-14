import {
  CreditNoteRecord,
  GstBusinessSettings,
  GstTaxType,
  Purchase,
  SellerGstSnapshot,
} from '../types/comic';

export interface IndianStateInfo {
  code: string;
  name: string;
  alphaCode: string;
  isUnionTerritory?: boolean;
}

export const INDIAN_STATES_AND_UTS: IndianStateInfo[] = [
  { code: '01', name: 'Jammu and Kashmir', alphaCode: 'JK', isUnionTerritory: true },
  { code: '02', name: 'Himachal Pradesh', alphaCode: 'HP' },
  { code: '03', name: 'Punjab', alphaCode: 'PB' },
  { code: '04', name: 'Chandigarh', alphaCode: 'CH', isUnionTerritory: true },
  { code: '05', name: 'Uttarakhand', alphaCode: 'UK' },
  { code: '06', name: 'Haryana', alphaCode: 'HR' },
  { code: '07', name: 'Delhi', alphaCode: 'DL', isUnionTerritory: true },
  { code: '08', name: 'Rajasthan', alphaCode: 'RJ' },
  { code: '09', name: 'Uttar Pradesh', alphaCode: 'UP' },
  { code: '10', name: 'Bihar', alphaCode: 'BR' },
  { code: '11', name: 'Sikkim', alphaCode: 'SK' },
  { code: '12', name: 'Arunachal Pradesh', alphaCode: 'AR' },
  { code: '13', name: 'Nagaland', alphaCode: 'NL' },
  { code: '14', name: 'Manipur', alphaCode: 'MN' },
  { code: '15', name: 'Mizoram', alphaCode: 'MZ' },
  { code: '16', name: 'Tripura', alphaCode: 'TR' },
  { code: '17', name: 'Meghalaya', alphaCode: 'ML' },
  { code: '18', name: 'Assam', alphaCode: 'AS' },
  { code: '19', name: 'West Bengal', alphaCode: 'WB' },
  { code: '20', name: 'Jharkhand', alphaCode: 'JH' },
  { code: '21', name: 'Odisha', alphaCode: 'OD' },
  { code: '22', name: 'Chhattisgarh', alphaCode: 'CG' },
  { code: '23', name: 'Madhya Pradesh', alphaCode: 'MP' },
  { code: '24', name: 'Gujarat', alphaCode: 'GJ' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', alphaCode: 'DD', isUnionTerritory: true },
  { code: '27', name: 'Maharashtra', alphaCode: 'MH' },
  { code: '29', name: 'Karnataka', alphaCode: 'KA' },
  { code: '30', name: 'Goa', alphaCode: 'GA' },
  { code: '31', name: 'Lakshadweep', alphaCode: 'LD', isUnionTerritory: true },
  { code: '32', name: 'Kerala', alphaCode: 'KL' },
  { code: '33', name: 'Tamil Nadu', alphaCode: 'TN' },
  { code: '34', name: 'Puducherry', alphaCode: 'PY', isUnionTerritory: true },
  { code: '35', name: 'Andaman and Nicobar Islands', alphaCode: 'AN', isUnionTerritory: true },
  { code: '36', name: 'Telangana', alphaCode: 'TS' },
  { code: '37', name: 'Andhra Pradesh', alphaCode: 'AP' },
  { code: '38', name: 'Ladakh', alphaCode: 'LA', isUnionTerritory: true },
  { code: '96', name: 'Foreign Country (International / Export)', alphaCode: 'FC' },
  { code: '97', name: 'Other Territory', alphaCode: 'OT', isUnionTerritory: true },
];

export function getStateByCode(stateCode?: string): IndianStateInfo {
  const clean = (stateCode || '33').trim().padStart(2, '0');
  return (
    INDIAN_STATES_AND_UTS.find((s) => s.code === clean) || {
      code: '33',
      name: 'Tamil Nadu',
      alphaCode: 'TN',
    }
  );
}

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Computes the official 15th Modulo-36 check character for the first 14 characters of an Indian GSTIN.
 */
export function computeGstinCheckDigit(first14: string): string {
  const clean = first14.trim().toUpperCase();
  if (clean.length !== 14) return '';
  let factor = 2;
  let sum = 0;
  const mod = GSTIN_CHARSET.length; // 36

  for (let i = clean.length - 1; i >= 0; i--) {
    const codePoint = GSTIN_CHARSET.indexOf(clean[i]);
    if (codePoint === -1) return '';
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / mod) + (addend % mod);
    sum += addend;
  }

  const remainder = sum % mod;
  const checkCodePoint = (mod - remainder) % mod;
  return GSTIN_CHARSET[checkCodePoint];
}

export interface GstinValidationResult {
  valid: boolean;
  isValid: boolean;
  isBlank: boolean;
  normalizedGstin: string;
  normalized: string;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  checksumValid?: boolean;
  expectedCheckDigit?: string;
  error?: string;
}

/**
 * Validates an Indian 15-character GSTIN format, state code prefix, PAN structure, and Modulo-36 check digit.
 * Allows blank GSTIN for unregistered businesses without fabricating any fake GSTIN.
 */
export function validateIndianGstin(rawGstin?: string | null): GstinValidationResult {
  const normalized = (rawGstin || '').trim().toUpperCase();
  if (!normalized) {
    return {
      valid: true,
      isValid: true,
      isBlank: true,
      normalizedGstin: '',
      normalized: '',
    };
  }

  if (normalized.length !== 15) {
    return {
      valid: false,
      isValid: false,
      isBlank: false,
      normalizedGstin: normalized,
      normalized,
      error: `GSTIN must be exactly 15 characters (received ${normalized.length}). Leave blank if unregistered.`,
    };
  }

  const formatRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!formatRegex.test(normalized)) {
    return {
      valid: false,
      isValid: false,
      isBlank: false,
      normalizedGstin: normalized,
      normalized,
      error:
        'Invalid GSTIN structure. Expected: 2-digit State Code + 10-char PAN + Entity Code + Z + Checksum digit.',
    };
  }

  const statePrefix = normalized.slice(0, 2);
  const matchedState = INDIAN_STATES_AND_UTS.find(
    (s) => s.code === statePrefix && s.code !== '96'
  );
  if (!matchedState) {
    return {
      valid: false,
      isValid: false,
      isBlank: false,
      normalizedGstin: normalized,
      normalized,
      error: `Invalid state code "${statePrefix}" in GSTIN prefix.`,
    };
  }

  const expectedCheckDigit = computeGstinCheckDigit(normalized.slice(0, 14));
  const actualCheckDigit = normalized[14];
  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      valid: false,
      isValid: false,
      isBlank: false,
      normalizedGstin: normalized,
      normalized,
      stateCode: matchedState.code,
      stateName: matchedState.name,
      pan: normalized.slice(2, 12),
      checksumValid: false,
      expectedCheckDigit,
      error: `GSTIN Modulo-36 checksum mismatch at character 15 (found '${actualCheckDigit}', expected '${expectedCheckDigit}').`,
    };
  }

  return {
    valid: true,
    isValid: true,
    isBlank: false,
    normalizedGstin: normalized,
    normalized,
    stateCode: matchedState.code,
    stateName: matchedState.name,
    pan: normalized.slice(2, 12),
    checksumValid: true,
    expectedCheckDigit,
  };
}

export function getDefaultGstBusinessSettings(): GstBusinessSettings {
  return {
    legalBusinessName: 'Aathirai Media & Publishing Pvt Ltd',
    tradeName: 'Aathirai_Comic',
    gstin: '', // Blank by default until the administrator enters their actual registered GSTIN
    isGstRegistered: false,
    gstinVerificationStatus: 'unregistered',
    stateCode: '33',
    stateName: 'Tamil Nadu',
    registeredAddress: 'Chennai, Tamil Nadu, India - 600001',
    invoicePrefix: 'AAC/2627/',
    creditNotePrefix: 'CN/2627/',
    nextInvoiceSequence: 43,
    nextCreditNoteSequence: 1,
    defaultSacCode: '998431',
    defaultSacDescription:
      'Online text based information such as online books, newspapers, periodicals, directories and digital comics',
    applicableGstRate: 18,
    applyGstToDomesticSales: true,
    updatedAt: '2026-11-01T00:00:00Z',
    updatedByEmail: 'balajiaris05@gmail.com',
    auditHistory: [
      {
        id: 'gst_aud_init',
        timestamp: '2026-11-01T00:00:00Z',
        adminId: 'usr_admin',
        adminEmail: 'balajiaris05@gmail.com',
        action: 'GST_PROFILE_INITIALIZED',
        summary:
          'Initialized GST & Billing settings (SAC 998431, 18% GST-inclusive formula, State 33 - Tamil Nadu).',
      },
    ],
  };
}

export const DEFAULT_GST_SETTINGS: GstBusinessSettings = getDefaultGstBusinessSettings();

export function buildSellerSnapshot(settings?: GstBusinessSettings | null): SellerGstSnapshot {
  const s = settings || getDefaultGstBusinessSettings();
  const stateInfo = getStateByCode(s.stateCode);
  return {
    legalBusinessName: s.legalBusinessName || 'Aathirai Media & Publishing Pvt Ltd',
    tradeName: s.tradeName || 'Aathirai_Comic',
    gstin: (s.gstin || '').trim().toUpperCase(),
    isGstRegistered: Boolean(s.gstin && s.gstin.trim().length === 15),
    stateCode: stateInfo.code,
    stateName: stateInfo.name,
    registeredAddress: s.registeredAddress || 'Chennai, Tamil Nadu, India',
    hsnSacCode: s.defaultSacCode || '998431',
    hsnSacDescription:
      s.defaultSacDescription ||
      'Online digital comics and electronic publishing subscription services',
  };
}

export interface GstInclusiveCalculationResult {
  grossAmountInr: number;
  totalAmount: number;
  taxableValue: number;
  taxAmount: number;
  taxRate: number;
  taxType: GstTaxType;
  supplyType: 'INTRA' | 'INTER' | 'EXPORT';
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyStateName: string;
  hsnSacCode: string;
  hsnSacDescription: string;
}

export interface GstCalculationParams {
  totalAmountInr: number;
  sellerStateCode?: string;
  placeOfSupplyStateCode?: string;
  applicableRatePercent?: number;
  applyGst?: boolean;
  isInternational?: boolean;
  hsnSacCode?: string;
  hsnSacDescription?: string;
}

/**
 * Calculates GST-inclusive pricing breakdown:
 *   GST = Total Amount * (Rate / (100 + Rate))
 *   Taxable Value = Total Amount - GST
 * Splits into CGST + SGST (Intra-state) or IGST (Inter-state) based on Place of Supply rules.
 * Accepts either a params object OR positional `(totalAmountInr, placeOfSupplyStateCode, settings)`.
 */
export function calculateInclusiveGstBreakdown(
  paramsOrAmount: GstCalculationParams | number,
  placeOfSupplyStateCodeArg?: string,
  settingsArg?: GstBusinessSettings | null
): GstInclusiveCalculationResult {
  const params: GstCalculationParams =
    typeof paramsOrAmount === 'number'
      ? {
          totalAmountInr: paramsOrAmount,
          sellerStateCode: settingsArg?.stateCode || '33',
          placeOfSupplyStateCode: placeOfSupplyStateCodeArg || settingsArg?.stateCode || '33',
          applicableRatePercent: settingsArg?.applicableGstRate ?? 18,
          applyGst: settingsArg ? settingsArg.applyGstToDomesticSales !== false : true,
          isInternational: placeOfSupplyStateCodeArg === '96',
          hsnSacCode: settingsArg?.defaultSacCode || '998431',
          hsnSacDescription: settingsArg?.defaultSacDescription,
        }
      : paramsOrAmount;

  const grossAmountInr = Number((Number(params.totalAmountInr) || 0).toFixed(2));
  const sellerState = getStateByCode(params.sellerStateCode || '33');
  const isExport = Boolean(params.isInternational || params.placeOfSupplyStateCode === '96');
  const posState = isExport
    ? getStateByCode('96')
    : getStateByCode(params.placeOfSupplyStateCode || sellerState.code);

  const rawRate =
    params.applicableRatePercent !== undefined ? Number(params.applicableRatePercent) : 18;
  const shouldApplyGst =
    params.applyGst !== false && !isExport && rawRate > 0 && grossAmountInr > 0;

  const hsnSacCode = (params.hsnSacCode || '998431').trim();
  const hsnSacDescription =
    params.hsnSacDescription ||
    'Online text based information such as online books, periodicals and digital comics';

  if (!shouldApplyGst) {
    const supplyType: 'INTRA' | 'INTER' | 'EXPORT' = isExport
      ? 'EXPORT'
      : posState.code === sellerState.code
        ? 'INTRA'
        : 'INTER';
    return {
      grossAmountInr,
      totalAmount: grossAmountInr,
      taxableValue: grossAmountInr,
      taxAmount: 0,
      taxRate: 0,
      taxType: 'NONE',
      supplyType,
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: 0,
      igstAmount: 0,
      sellerStateCode: sellerState.code,
      placeOfSupplyStateCode: posState.code,
      placeOfSupplyStateName: posState.name,
      hsnSacCode,
      hsnSacDescription,
    };
  }

  // Inclusive GST formula: GST = Total * Rate / (100 + Rate)
  const taxAmount = Number(((grossAmountInr * rawRate) / (100 + rawRate)).toFixed(2));
  const taxableValue = Number((grossAmountInr - taxAmount).toFixed(2));
  const isIntraState = posState.code === sellerState.code;

  if (isIntraState) {
    const halfRate = Number((rawRate / 2).toFixed(2));
    const cgstAmount = Number((taxAmount / 2).toFixed(2));
    const sgstAmount = Number((taxAmount - cgstAmount).toFixed(2));
    return {
      grossAmountInr,
      totalAmount: grossAmountInr,
      taxableValue,
      taxAmount,
      taxRate: rawRate,
      taxType: 'CGST_SGST',
      supplyType: 'INTRA',
      cgstRate: halfRate,
      cgstAmount,
      sgstRate: halfRate,
      sgstAmount,
      igstRate: 0,
      igstAmount: 0,
      sellerStateCode: sellerState.code,
      placeOfSupplyStateCode: posState.code,
      placeOfSupplyStateName: posState.name,
      hsnSacCode,
      hsnSacDescription,
    };
  }

  return {
    grossAmountInr,
    totalAmount: grossAmountInr,
    taxableValue,
    taxAmount,
    taxRate: rawRate,
    taxType: 'IGST',
    supplyType: 'INTER',
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
    igstRate: rawRate,
    igstAmount: taxAmount,
    sellerStateCode: sellerState.code,
    placeOfSupplyStateCode: posState.code,
    placeOfSupplyStateName: posState.name,
    hsnSacCode,
    hsnSacDescription,
  };
}

/**
 * Formats an invoice number to strictly comply with GST portal limits (<= 16 characters, only A-Z, 0-9, /, -).
 */
export function formatGstInvoiceNumber(prefix: string, sequenceNumber: number): string {
  const cleanPrefix = (prefix || 'AAC/2627/')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, '')
    .slice(0, 10);
  const seqStr = String(Math.max(1, sequenceNumber)).padStart(4, '0');
  return `${cleanPrefix}${seqStr}`.slice(0, 16);
}

/**
 * Enriches a Purchase record with GST invoice fields if missing, while strictly preserving any existing
 * historical GST values and sellerSnapshot.
 */
export function ensurePurchaseGstFields(
  purchase: Purchase,
  settings?: GstBusinessSettings | null,
  fallbackSequence: number = 1
): Purchase {
  const s = settings || getDefaultGstBusinessSettings();
  const sellerSnap = purchase.sellerSnapshot || buildSellerSnapshot(s);

  const posCode = purchase.placeOfSupplyStateCode || sellerSnap.stateCode || '33';
  const posInfo = getStateByCode(posCode);

  const calc = calculateInclusiveGstBreakdown({
    totalAmountInr: purchase.amountInr,
    sellerStateCode: sellerSnap.stateCode,
    placeOfSupplyStateCode: posInfo.code,
    applicableRatePercent:
      purchase.taxRate !== undefined ? purchase.taxRate : s.applicableGstRate ?? 18,
    applyGst:
      purchase.taxType === 'NONE'
        ? false
        : s.applyGstToDomesticSales !== false,
    isInternational: purchase.isInternational,
    hsnSacCode: purchase.hsnSacCode || sellerSnap.hsnSacCode,
    hsnSacDescription: purchase.hsnSacDescription || sellerSnap.hsnSacDescription,
  });

  // Preserve historical taxAmount if already stored and non-zero, otherwise use inclusive calculation
  const existingTax =
    typeof purchase.taxAmount === 'number' && purchase.taxAmount > 0
      ? Number(purchase.taxAmount.toFixed(2))
      : calc.taxAmount;
  const resolvedTaxable =
    typeof purchase.taxableValue === 'number' && purchase.taxableValue > 0
      ? Number(purchase.taxableValue.toFixed(2))
      : Number((purchase.amountInr - existingTax).toFixed(2));

  const resolvedTaxType: GstTaxType =
    purchase.taxType ||
    (existingTax === 0
      ? 'NONE'
      : posInfo.code === sellerSnap.stateCode
        ? 'CGST_SGST'
        : 'IGST');

  const resolvedCgst =
    typeof purchase.cgstAmount === 'number'
      ? purchase.cgstAmount
      : resolvedTaxType === 'CGST_SGST'
        ? Number((existingTax / 2).toFixed(2))
        : 0;
  const resolvedSgst =
    typeof purchase.sgstAmount === 'number'
      ? purchase.sgstAmount
      : resolvedTaxType === 'CGST_SGST'
        ? Number((existingTax - resolvedCgst).toFixed(2))
        : 0;
  const resolvedIgst =
    typeof purchase.igstAmount === 'number'
      ? purchase.igstAmount
      : resolvedTaxType === 'IGST'
        ? existingTax
        : 0;

  // Ensure GST portal compliant <=16 char invoiceNumber
  let invoiceNumber = purchase.invoiceNumber;
  if (!invoiceNumber) {
    const tailMatch = (purchase.receiptNumber || '').match(/(\d{3,6})$/);
    const seq = tailMatch ? parseInt(tailMatch[1], 10) : fallbackSequence;
    invoiceNumber = formatGstInvoiceNumber(s.invoicePrefix || 'AAC/2627/', seq);
  }

  return {
    ...purchase,
    invoiceNumber,
    taxableValue: resolvedTaxable,
    taxAmount: existingTax,
    taxRate: purchase.taxRate !== undefined ? purchase.taxRate : existingTax > 0 ? calc.taxRate : 0,
    taxType: resolvedTaxType,
    cgstRate:
      purchase.cgstRate !== undefined
        ? purchase.cgstRate
        : resolvedTaxType === 'CGST_SGST'
          ? 9
          : 0,
    cgstAmount: resolvedCgst,
    sgstRate:
      purchase.sgstRate !== undefined
        ? purchase.sgstRate
        : resolvedTaxType === 'CGST_SGST'
          ? 9
          : 0,
    sgstAmount: resolvedSgst,
    igstRate:
      purchase.igstRate !== undefined ? purchase.igstRate : resolvedTaxType === 'IGST' ? 18 : 0,
    igstAmount: resolvedIgst,
    hsnSacCode: purchase.hsnSacCode || sellerSnap.hsnSacCode || '998431',
    hsnSacDescription:
      purchase.hsnSacDescription ||
      sellerSnap.hsnSacDescription ||
      'Online digital comics and electronic publishing services',
    placeOfSupplyStateCode: posInfo.code,
    placeOfSupplyStateName: posInfo.name,
    supplyType:
      purchase.supplyType ||
      (posInfo.code === '96'
        ? 'EXPORT'
        : posInfo.code === sellerSnap.stateCode
          ? 'INTRA'
          : 'INTER'),
    sellerSnapshot: sellerSnap,
  };
}

export function matchesGstPeriodFilter(isoDate: string, periodFilter: string = 'ALL'): boolean {
  if (!periodFilter || periodFilter === 'ALL') return true;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return true;
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  if (/^\d{6}$/.test(periodFilter)) {
    return `${mm}${yyyy}` === periodFilter;
  }
  const qMatch = periodFilter.match(/^Q([1-4])-(\d{4})$/i);
  if (qMatch) {
    const q = Number(qMatch[1]);
    const qYear = qMatch[2];
    const mNum = Number(mm);
    const inQuarter =
      (q === 1 && mNum >= 1 && mNum <= 3) ||
      (q === 2 && mNum >= 4 && mNum <= 6) ||
      (q === 3 && mNum >= 7 && mNum <= 9) ||
      (q === 4 && mNum >= 10 && mNum <= 12);
    return yyyy === qYear && inQuarter;
  }
  return true;
}

export interface GstPeriodSummary {
  invoiceCount: number;
  totalInvoices: number;
  creditNoteCount: number;
  totalCreditNotes: number;
  b2bInvoiceCount: number;
  b2bCount: number;
  b2csInvoiceCount: number;
  b2csCount: number;
  grossSalesInr: number;
  grossTaxableValue: number;
  grossCgst: number;
  grossSgst: number;
  grossIgst: number;
  grossTotalGst: number;
  creditNoteGrossInr: number;
  creditNoteTaxableValue: number;
  creditNoteCgst: number;
  creditNoteSgst: number;
  creditNoteIgst: number;
  creditNoteTotalGst: number;
  netPayableSalesInr: number;
  netInvoiceValue: number;
  netTaxableValue: number;
  netCgstLiability: number;
  netCgst: number;
  netSgstLiability: number;
  netSgst: number;
  netIgstLiability: number;
  netIgst: number;
  netTotalGstLiability: number;
  netTaxLiability: number;
  filteredInvoices: Purchase[];
  filteredCreditNotes: CreditNoteRecord[];
}

export function computeGstPeriodSummary(
  invoices: Purchase[],
  creditNotes: CreditNoteRecord[],
  settings?: GstBusinessSettings | null,
  periodFilter: string = 'ALL'
): GstPeriodSummary {
  const filteredRawInvoices = invoices.filter((inv) => matchesGstPeriodFilter(inv.createdAt, periodFilter));
  const filteredCreditNotes = creditNotes.filter((cn) => matchesGstPeriodFilter(cn.createdAt, periodFilter));
  const enrichedInvoices = filteredRawInvoices.map((rawInv, idx) =>
    ensurePurchaseGstFields(rawInv, settings, idx + 1)
  );

  let b2bInvoiceCount = 0;
  let b2csInvoiceCount = 0;
  let grossSalesInr = 0;
  let grossTaxableValue = 0;
  let grossCgst = 0;
  let grossSgst = 0;
  let grossIgst = 0;

  enrichedInvoices.forEach((inv) => {
    if (inv.customerGstin && inv.customerGstin.trim().length === 15) {
      b2bInvoiceCount++;
    } else {
      b2csInvoiceCount++;
    }
    grossSalesInr += Number(inv.amountInr) || 0;
    grossTaxableValue += Number(inv.taxableValue) || 0;
    grossCgst += Number(inv.cgstAmount) || 0;
    grossSgst += Number(inv.sgstAmount) || 0;
    grossIgst += Number(inv.igstAmount) || 0;
  });

  let creditNoteGrossInr = 0;
  let creditNoteTaxableValue = 0;
  let creditNoteCgst = 0;
  let creditNoteSgst = 0;
  let creditNoteIgst = 0;

  filteredCreditNotes.forEach((cn) => {
    creditNoteGrossInr += Number(cn.grossAmountInr) || 0;
    creditNoteTaxableValue += Number(cn.taxableValue) || 0;
    creditNoteCgst += Number(cn.cgstAmount) || 0;
    creditNoteSgst += Number(cn.sgstAmount) || 0;
    creditNoteIgst += Number(cn.igstAmount) || 0;
  });

  const round2 = (n: number) => Number(n.toFixed(2));
  const grossTotalGst = round2(grossCgst + grossSgst + grossIgst);
  const creditNoteTotalGst = round2(creditNoteCgst + creditNoteSgst + creditNoteIgst);
  const netPayableSalesInr = round2(grossSalesInr - creditNoteGrossInr);
  const netTaxableValue = round2(grossTaxableValue - creditNoteTaxableValue);
  const netCgstLiability = round2(grossCgst - creditNoteCgst);
  const netSgstLiability = round2(grossSgst - creditNoteSgst);
  const netIgstLiability = round2(grossIgst - creditNoteIgst);
  const netTotalGstLiability = round2(grossTotalGst - creditNoteTotalGst);

  return {
    invoiceCount: enrichedInvoices.length,
    totalInvoices: enrichedInvoices.length,
    creditNoteCount: filteredCreditNotes.length,
    totalCreditNotes: filteredCreditNotes.length,
    b2bInvoiceCount,
    b2bCount: b2bInvoiceCount,
    b2csInvoiceCount,
    b2csCount: b2csInvoiceCount,
    grossSalesInr: round2(grossSalesInr),
    grossTaxableValue: round2(grossTaxableValue),
    grossCgst: round2(grossCgst),
    grossSgst: round2(grossSgst),
    grossIgst: round2(grossIgst),
    grossTotalGst,
    creditNoteGrossInr: round2(creditNoteGrossInr),
    creditNoteTaxableValue: round2(creditNoteTaxableValue),
    creditNoteCgst: round2(creditNoteCgst),
    creditNoteSgst: round2(creditNoteSgst),
    creditNoteIgst: round2(creditNoteIgst),
    creditNoteTotalGst,
    netPayableSalesInr,
    netInvoiceValue: netPayableSalesInr,
    netTaxableValue,
    netCgstLiability,
    netCgst: netCgstLiability,
    netSgstLiability,
    netSgst: netSgstLiability,
    netIgstLiability,
    netIgst: netIgstLiability,
    netTotalGstLiability,
    netTaxLiability: netTotalGstLiability,
    filteredInvoices: enrichedInvoices,
    filteredCreditNotes,
  };
}

export interface GstExportValidationReport {
  isValid: boolean;
  isValidForCsv: boolean;
  isValidForGstr1Json: boolean;
  gstinValidation: GstinValidationResult;
  errors: string[];
  warnings: string[];
  summary: GstPeriodSummary;
}

/**
 * Validates business GST settings, invoice numbers, SAC codes, and tax reconciliation math
 * before generating GSTR-1 JSON or CSV exports.
 * Supports either object `{ settings, invoices, creditNotes }` or positional `(invoices, creditNotes, settings, periodFilter, requireGstinForGstr1)`.
 */
export function validateGstExportData(
  paramsOrInvoices:
    | {
        settings: GstBusinessSettings;
        invoices: Purchase[];
        creditNotes: CreditNoteRecord[];
      }
    | Purchase[],
  creditNotesArg?: CreditNoteRecord[],
  settingsArg?: GstBusinessSettings,
  periodFilterArg: string = 'ALL',
  requireGstinForGstr1: boolean = false
): GstExportValidationReport {
  const isArrayCall = Array.isArray(paramsOrInvoices);
  const settings = isArrayCall
    ? settingsArg || getDefaultGstBusinessSettings()
    : paramsOrInvoices.settings;
  const rawInvoices = isArrayCall ? paramsOrInvoices : paramsOrInvoices.invoices;
  const rawCreditNotes = isArrayCall ? creditNotesArg || [] : paramsOrInvoices.creditNotes;
  const invoices = rawInvoices.filter((inv) => matchesGstPeriodFilter(inv.createdAt, periodFilterArg));
  const creditNotes = rawCreditNotes.filter((cn) => matchesGstPeriodFilter(cn.createdAt, periodFilterArg));

  const errors: string[] = [];
  const warnings: string[] = [];

  const gstinValidation = validateIndianGstin(settings.gstin);
  if (!gstinValidation.valid) {
    errors.push(gstinValidation.error || 'Seller GSTIN format or checksum is invalid.');
  } else if (gstinValidation.isBlank) {
    if (requireGstinForGstr1) {
      errors.push(
        'A valid 15-character Seller GSTIN is required in GST & Billing settings before exporting a GSTR-1 JSON file for the GST Portal Offline Utility.'
      );
    } else {
      warnings.push(
        'Seller GSTIN is currently blank (Unregistered Business mode). You can download GST Reconciliation CSVs and Customer Bills of Supply, but GSTR-1 JSON Portal Upload requires a valid 15-character registered GSTIN.'
      );
    }
  }

  const invPattern = /^[A-Z0-9/-]{1,16}$/;
  invoices.forEach((rawInv, idx) => {
    const inv = ensurePurchaseGstFields(rawInv, settings, idx + 1);
    const inum = (inv.invoiceNumber || inv.receiptNumber || '').toUpperCase();
    if (!invPattern.test(inum)) {
      warnings.push(
        `Invoice ${inum} exceeds 16 characters or contains non-standard characters; it will be normalized to ${formatGstInvoiceNumber(settings.invoicePrefix, idx + 1)} for GSTR-1 export.`
      );
    }

    const totalTax = Number(((inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0)).toFixed(2));
    const recomputedGross = Number(((inv.taxableValue || 0) + totalTax).toFixed(2));
    if (Math.abs(recomputedGross - inv.amountInr) > 0.05) {
      errors.push(
        `Tax math mismatch on Invoice ${inum}: Taxable (${inv.taxableValue}) + Tax (${totalTax}) != Gross (${inv.amountInr}).`
      );
    }
  });

  if (invoices.length === 0 && creditNotes.length === 0) {
    warnings.push('No invoices or credit notes found in the selected reporting period (Nil return period).');
  }

  const summary = computeGstPeriodSummary(rawInvoices, rawCreditNotes, settings, periodFilterArg);
  const isValidForCsv = errors.length === 0;
  const isValidForGstr1Json = errors.length === 0 && !gstinValidation.isBlank && gstinValidation.valid;

  return {
    isValid: requireGstinForGstr1 ? isValidForGstr1Json : isValidForCsv,
    isValidForCsv,
    isValidForGstr1Json,
    gstinValidation,
    errors,
    warnings,
    summary,
  };
}

function formatGstr1Date(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date();
  if (isNaN(d.getTime())) return '01-11-2026';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Generates an official Indian GST Portal Offline Utility compatible GSTR-1 JSON payload.
 * Requires a valid 15-character seller GSTIN (never fabricates a GSTIN).
 * Supports either `{ settings, filingPeriodFp, invoices, creditNotes }` or positional `(invoices, creditNotes, settings, periodFilter)`.
 */
export const GST_MONTHS_LIST = [
  { mm: '01', name: 'January', short: 'Jan', days: 31 },
  { mm: '02', name: 'February', short: 'Feb', days: 28 },
  { mm: '03', name: 'March', short: 'Mar', days: 31 },
  { mm: '04', name: 'April', short: 'Apr', days: 30 },
  { mm: '05', name: 'May', short: 'May', days: 31 },
  { mm: '06', name: 'June', short: 'Jun', days: 30 },
  { mm: '07', name: 'July', short: 'Jul', days: 31 },
  { mm: '08', name: 'August', short: 'Aug', days: 31 },
  { mm: '09', name: 'September', short: 'Sep', days: 30 },
  { mm: '10', name: 'October', short: 'Oct', days: 31 },
  { mm: '11', name: 'November', short: 'Nov', days: 30 },
  { mm: '12', name: 'December', short: 'Dec', days: 31 },
];

export interface GstPeriodDetails {
  periodCode: string;
  monthNumber: string;
  monthName: string;
  shortMonthName: string;
  year: string;
  monthYearLabel: string; // e.g. "August 2026"
  humanLabel: string; // e.g. "August 2026 (Return Period 082026)"
  dateRangeLabel: string; // e.g. "01 Aug 2026 to 31 Aug 2026"
  startDateIso: string; // e.g. "2026-08-01"
  endDateIso: string; // e.g. "2026-08-31"
  fileSlug: string; // e.g. "August_2026_082026"
}

export function getGstPeriodDetails(periodFilter: string = 'ALL'): GstPeriodDetails {
  const clean = (periodFilter || 'ALL').trim();
  if (/^\d{6}$/.test(clean)) {
    const mm = clean.slice(0, 2);
    const yyyy = clean.slice(2, 6);
    const yearNum = parseInt(yyyy, 10) || 2026;
    const isLeap = (yearNum % 4 === 0 && yearNum % 100 !== 0) || yearNum % 400 === 0;
    const mObj = GST_MONTHS_LIST.find((m) => m.mm === mm) || GST_MONTHS_LIST[0];
    const lastDay = mm === '02' && isLeap ? 29 : mObj.days;
    const monthYearLabel = `${mObj.name} ${yyyy}`;
    return {
      periodCode: clean,
      monthNumber: mm,
      monthName: mObj.name,
      shortMonthName: mObj.short,
      year: yyyy,
      monthYearLabel,
      humanLabel: `${mObj.name} ${yyyy} (Return Period ${clean})`,
      dateRangeLabel: `01 ${mObj.short} ${yyyy} to ${String(lastDay).padStart(2, '0')} ${mObj.short} ${yyyy}`,
      startDateIso: `${yyyy}-${mm}-01`,
      endDateIso: `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`,
      fileSlug: `${mObj.name}_${yyyy}_${clean}`,
    };
  }

  const qMatch = clean.match(/^Q([1-4])-(\d{4})$/i);
  if (qMatch) {
    const q = qMatch[1];
    const yyyy = qMatch[2];
    const qMeta: Record<string, { label: string; range: string; start: string; end: string }> = {
      '1': { label: `Q1 (January - March) ${yyyy}`, range: `01 Jan ${yyyy} to 31 Mar ${yyyy}`, start: `${yyyy}-01-01`, end: `${yyyy}-03-31` },
      '2': { label: `Q2 (April - June) ${yyyy}`, range: `01 Apr ${yyyy} to 30 Jun ${yyyy}`, start: `${yyyy}-04-01`, end: `${yyyy}-06-30` },
      '3': { label: `Q3 (July - September) ${yyyy}`, range: `01 Jul ${yyyy} to 30 Sep ${yyyy}`, start: `${yyyy}-07-01`, end: `${yyyy}-09-30` },
      '4': { label: `Q4 (October - December) ${yyyy}`, range: `01 Oct ${yyyy} to 31 Dec ${yyyy}`, start: `${yyyy}-10-01`, end: `${yyyy}-12-31` },
    };
    const info = qMeta[q] || qMeta['1'];
    return {
      periodCode: clean,
      monthNumber: `Q${q}`,
      monthName: info.label,
      shortMonthName: `Q${q}`,
      year: yyyy,
      monthYearLabel: info.label,
      humanLabel: `${info.label}`,
      dateRangeLabel: info.range,
      startDateIso: info.start,
      endDateIso: info.end,
      fileSlug: `Q${q}_${yyyy}`,
    };
  }

  return {
    periodCode: 'ALL',
    monthNumber: 'ALL',
    monthName: 'All Months',
    shortMonthName: 'All',
    year: '2026',
    monthYearLabel: 'All Months Consolidated',
    humanLabel: 'All Periods (Complete Consolidated Statement)',
    dateRangeLabel: '01 Jan 2026 to 31 Dec 2026 (All Months)',
    startDateIso: '2026-01-01',
    endDateIso: '2026-12-31',
    fileSlug: 'All_Months_Consolidated',
  };
}

export function formatPeriodHumanLabel(periodFilter: string): string {
  return getGstPeriodDetails(periodFilter).humanLabel;
}

  // Helper to get month label from an ISO date string
function getInvoiceMonthYearFromIso(isoDate: string): { monthYear: string; fpCode: string } {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) {
    return { monthYear: 'May 2026', fpCode: '052026' };
  }
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  const mObj = GST_MONTHS_LIST.find((m) => m.mm === mm);
  return {
    monthYear: mObj ? `${mObj.name} ${yyyy}` : `${mm}/${yyyy}`,
    fpCode: `${mm}${yyyy}`,
  };
}

/**
 * Generates an official Indian GST Portal Offline Utility compatible GSTR-1 JSON payload.
 * Requires a valid 15-character seller GSTIN (never fabricates a GSTIN).
 * Supports either `{ settings, filingPeriodFp, invoices, creditNotes }` or positional `(invoices, creditNotes, settings, periodFilter)`.
 */
export function generateGstr1OfflineJson(
  paramsOrInvoices:
    | {
        settings: GstBusinessSettings;
        filingPeriodFp: string; // MMYYYY e.g. '112026'
        invoices: Purchase[];
        creditNotes: CreditNoteRecord[];
      }
    | Purchase[],
  creditNotesArg?: CreditNoteRecord[],
  settingsArg?: GstBusinessSettings,
  periodFilterArg: string = 'ALL',
  allowUnregisteredFallback: boolean = false
) {
  const isArrayCall = Array.isArray(paramsOrInvoices);
  const settings = isArrayCall
    ? settingsArg || getDefaultGstBusinessSettings()
    : paramsOrInvoices.settings;
  const filingPeriodFp = isArrayCall ? periodFilterArg : paramsOrInvoices.filingPeriodFp;
  const periodDetails = getGstPeriodDetails(filingPeriodFp);
  const invoices = isArrayCall
    ? paramsOrInvoices.filter((inv) => matchesGstPeriodFilter(inv.createdAt, periodFilterArg))
    : paramsOrInvoices.invoices;
  const creditNotes = isArrayCall
    ? (creditNotesArg || []).filter((cn) => matchesGstPeriodFilter(cn.createdAt, periodFilterArg))
    : paramsOrInvoices.creditNotes;
  const gstinCheck = validateIndianGstin(settings.gstin);
  if ((!gstinCheck.valid || gstinCheck.isBlank) && !allowUnregisteredFallback) {
    throw new Error(
      gstinCheck.error ||
        'A valid 15-character registered GSTIN is required in GST & Billing settings before generating a GSTR-1 Portal JSON file.'
    );
  }

  const resolvedGstin =
    !gstinCheck.isBlank && gstinCheck.valid
      ? gstinCheck.normalizedGstin
      : (settings.gstin || '').trim().toUpperCase() || 'UNREGISTERED_SET_GSTIN_IN_PROFILE';

  const cleanFp = /^\d{6}$/.test(filingPeriodFp) ? filingPeriodFp : '052026';
  const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));

  // 1. Separate B2B (with valid 15-char customer GSTIN) and B2CS (unregistered consumer supplies)
  const b2bMap = new Map<string, any[]>();
  const b2csMap = new Map<
    string,
    {
      sply_ty: 'INTRA' | 'INTER';
      pos: string;
      typ: 'OE';
      rt: number;
      txval: number;
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }
  >();

  // HSN/SAC summary map keyed by `${hsnSacCode}_${taxRate}`
  const hsnMap = new Map<
    string,
    {
      num: number;
      hsn_sc: string;
      desc: string;
      uqc: 'NA';
      qty: number;
      val: number;
      txval: number;
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
      rt: number;
    }
  >();

  const enrichedInvoices = invoices.map((inv, idx) =>
    ensurePurchaseGstFields(inv, settings, idx + 1)
  );

  enrichedInvoices.forEach((inv, idx) => {
    const inum =
      inv.invoiceNumber && /^[A-Z0-9/-]{1,16}$/.test(inv.invoiceNumber)
        ? inv.invoiceNumber
        : formatGstInvoiceNumber(settings.invoicePrefix, idx + 1);
    const idt = formatGstr1Date(inv.createdAt);
    const pos = (inv.placeOfSupplyStateCode || settings.stateCode || '33').padStart(2, '0');
    const splyTy: 'INTRA' | 'INTER' =
      pos === (inv.sellerSnapshot?.stateCode || settings.stateCode || '33').padStart(2, '0')
        ? 'INTRA'
        : 'INTER';
    const rt = Number(inv.taxRate ?? settings.applicableGstRate ?? 18);
    const txval = round2(inv.taxableValue || 0);
    const camt = round2(inv.cgstAmount || 0);
    const samt = round2(inv.sgstAmount || 0);
    const iamt = round2(inv.igstAmount || 0);
    const val = round2(inv.amountInr || 0);

    const custGstinCheck = validateIndianGstin(inv.customerGstin);
    if (!custGstinCheck.isBlank && custGstinCheck.valid) {
      const ctin = custGstinCheck.normalizedGstin;
      if (!b2bMap.has(ctin)) b2bMap.set(ctin, []);
      b2bMap.get(ctin)!.push({
        inum,
        idt,
        val,
        pos,
        rchrg: 'N',
        inv_typ: 'R',
        itms: [
          {
            num: 1,
            itm_det: {
              txval,
              rt,
              camt,
              samt,
              iamt,
              csamt: 0,
            },
          },
        ],
      });
    } else {
      const b2csKey = `${pos}_${splyTy}_${rt}`;
      const existing = b2csMap.get(b2csKey);
      if (existing) {
        existing.txval = round2(existing.txval + txval);
        existing.camt = round2(existing.camt + camt);
        existing.samt = round2(existing.samt + samt);
        existing.iamt = round2(existing.iamt + iamt);
      } else {
        b2csMap.set(b2csKey, {
          sply_ty: splyTy,
          pos,
          typ: 'OE',
          rt,
          txval,
          iamt,
          camt,
          samt,
          csamt: 0,
        });
      }
    }

    // Add to HSN/SAC summary
    const sacCode = (inv.hsnSacCode || settings.defaultSacCode || '998431').trim();
    const sacDesc = (inv.hsnSacDescription || settings.defaultSacDescription || 'Online Digital Comics')
      .trim()
      .slice(0, 30);
    const hsnKey = `${sacCode}_${rt}`;
    const existingHsn = hsnMap.get(hsnKey);
    if (existingHsn) {
      existingHsn.val = round2(existingHsn.val + val);
      existingHsn.txval = round2(existingHsn.txval + txval);
      existingHsn.camt = round2(existingHsn.camt + camt);
      existingHsn.samt = round2(existingHsn.samt + samt);
      existingHsn.iamt = round2(existingHsn.iamt + iamt);
    } else {
      hsnMap.set(hsnKey, {
        num: hsnMap.size + 1,
        hsn_sc: sacCode,
        desc: sacDesc,
        uqc: 'NA',
        qty: 0,
        val,
        txval,
        iamt,
        camt,
        samt,
        csamt: 0,
        rt,
      });
    }
  });

  // 2. Process Credit Notes (CDNR for B2B, or net off B2CS / CDNUR)
  const cdnrMap = new Map<string, any[]>();
  const cdnurList: any[] = [];

  creditNotes.forEach((cn) => {
    const custCheck = validateIndianGstin(cn.customerGstin);
    const ntDt = formatGstr1Date(cn.createdAt);
    const pos = (cn.placeOfSupplyStateCode || settings.stateCode || '33').padStart(2, '0');
    const rt = Number(cn.taxRate ?? 18);
    const txval = round2(cn.taxableValue);
    const camt = round2(cn.cgstAmount);
    const samt = round2(cn.sgstAmount);
    const iamt = round2(cn.igstAmount);
    const val = round2(cn.grossAmountInr);

    if (!custCheck.isBlank && custCheck.valid) {
      const ctin = custCheck.normalizedGstin;
      if (!cdnrMap.has(ctin)) cdnrMap.set(ctin, []);
      cdnrMap.get(ctin)!.push({
        ntty: 'C',
        nt_num: cn.creditNoteNumber.slice(0, 16),
        nt_dt: ntDt,
        val,
        pos,
        rchrg: 'N',
        inv_typ: 'R',
        itms: [
          {
            num: 1,
            itm_det: {
              txval,
              rt,
              camt,
              samt,
              iamt,
              csamt: 0,
            },
          },
        ],
      });
    } else {
      // For B2CS credit notes in the same period, GST portal rules adjust B2CS table; also record in cdnur if inter-state
      const splyTy: 'INTRA' | 'INTER' = cn.supplyType === 'INTER' ? 'INTER' : 'INTRA';
      const b2csKey = `${pos}_${splyTy}_${rt}`;
      const existingB2cs = b2csMap.get(b2csKey);
      if (existingB2cs) {
        existingB2cs.txval = round2(existingB2cs.txval - txval);
        existingB2cs.camt = round2(existingB2cs.camt - camt);
        existingB2cs.samt = round2(existingB2cs.samt - samt);
        existingB2cs.iamt = round2(existingB2cs.iamt - iamt);
      } else {
        cdnurList.push({
          typ: 'B2CL',
          ntty: 'C',
          nt_num: cn.creditNoteNumber.slice(0, 16),
          nt_dt: ntDt,
          pos,
          val,
          itms: [
            {
              num: 1,
              itm_det: {
                txval,
                rt,
                iamt,
                csamt: 0,
              },
            },
          ],
        });
      }
    }
  });

  const b2b = Array.from(b2bMap.entries()).map(([ctin, inv]) => ({ ctin, inv }));
  const b2cs = Array.from(b2csMap.values());
  const cdnr = Array.from(cdnrMap.entries()).map(([ctin, nt]) => ({ ctin, nt }));
  const hsnData = Array.from(hsnMap.values());

  // 3. Document Issue Summary (Table 13 of GSTR-1)
  const docDet: any[] = [];
  if (enrichedInvoices.length > 0) {
    const firstInum =
      enrichedInvoices[enrichedInvoices.length - 1].invoiceNumber ||
      formatGstInvoiceNumber(settings.invoicePrefix, 1);
    const lastInum =
      enrichedInvoices[0].invoiceNumber ||
      formatGstInvoiceNumber(settings.invoicePrefix, enrichedInvoices.length);
    docDet.push({
      doc_num: 1,
      doc_typ: 'Invoices for outward supply',
      docs: [
        {
          num: 1,
          from: firstInum,
          to: lastInum,
          totnum: enrichedInvoices.length,
          cancel: 0,
          net_issue: enrichedInvoices.length,
        },
      ],
    });
  }
  if (creditNotes.length > 0) {
    const firstCn = creditNotes[creditNotes.length - 1].creditNoteNumber;
    const lastCn = creditNotes[0].creditNoteNumber;
    docDet.push({
      doc_num: 2,
      doc_typ: 'Credit Note',
      docs: [
        {
          num: 1,
          from: firstCn,
          to: lastCn,
          totnum: creditNotes.length,
          cancel: 0,
          net_issue: creditNotes.length,
        },
      ],
    });
  }

  return {
    gstin: resolvedGstin,
    fp: cleanFp,
    statement_month: periodDetails.monthYearLabel,
    statement_date_range: periodDetails.dateRangeLabel,
    version: 'GST3.1.6',
    hash: 'hash',
    nil_return: enrichedInvoices.length === 0 && creditNotes.length === 0,
    b2b,
    b2cs,
    cdnr,
    cdnur: cdnurList,
    hsn: {
      data: hsnData,
    },
    doc_issue: {
      doc_det: docDet,
    },
  };
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Generates a complete GST Sales & Tax Reconciliation CSV with all invoices, credit notes,
 * taxable values, CGST, SGST, IGST, SAC codes, Place of Supply, and reconciliation totals.
 * Explicitly includes the specific Statement Month & Year (e.g., "August 2026"), Return Period (e.g., "082026"),
 * and exact Statement Date Range (e.g., "01 Aug 2026 to 31 Aug 2026") even when there are 0 bills.
 */
export function generateGstReconciliationCsv(
  paramsOrInvoices:
    | {
        settings: GstBusinessSettings;
        periodLabel: string;
        invoices: Purchase[];
        creditNotes: CreditNoteRecord[];
      }
    | Purchase[],
  creditNotesArg?: CreditNoteRecord[],
  settingsArg?: GstBusinessSettings,
  periodLabelArg: string = 'ALL'
): string {
  const isArrayCall = Array.isArray(paramsOrInvoices);
  const settings = isArrayCall
    ? settingsArg || getDefaultGstBusinessSettings()
    : paramsOrInvoices.settings;
  const periodLabel = isArrayCall ? periodLabelArg : paramsOrInvoices.periodLabel;
  const periodDetails = getGstPeriodDetails(periodLabel);
  const invoices = isArrayCall
    ? paramsOrInvoices.filter((inv) => matchesGstPeriodFilter(inv.createdAt, periodLabelArg))
    : paramsOrInvoices.invoices;
  const creditNotes = isArrayCall
    ? (creditNotesArg || []).filter((cn) => matchesGstPeriodFilter(cn.createdAt, periodLabelArg))
    : paramsOrInvoices.creditNotes;

  const isNilMonth = invoices.length === 0 && creditNotes.length === 0;

  // Top Statement Metadata Rows so opening the CSV in Excel/Sheets immediately displays the exact Month & Year at the top
  const metadataRows: string[][] = [
    [
      'AATHIRAI_COMIC - OFFICIAL MONTHLY GST FILING & RECONCILIATION STATEMENT',
      `Statement Month: ${periodDetails.monthYearLabel}`,
      `Return Period (MMYYYY): ${periodDetails.periodCode}`,
      `Statement Date Range: ${periodDetails.dateRangeLabel}`,
      isNilMonth
        ? `Filing Status: NIL RETURN (0 Bills Recorded for ${periodDetails.monthYearLabel})`
        : `Filing Status: ACTIVE RETURN (${invoices.length} Bills Recorded for ${periodDetails.monthYearLabel})`,
    ],
  ];

  const headers = [
    'Statement Month & Year',
    'Return Period (MMYYYY)',
    'Statement Date Range',
    'Document Type',
    'Invoice / Note Number',
    'Receipt Reference',
    'Document Date / Period',
    'Original Invoice Ref',
    'Customer Name',
    'Customer Email',
    'Customer Mobile',
    'Customer GSTIN (B2B)',
    'Place of Supply Code',
    'Place of Supply State',
    'Supply Type',
    'Tax Type',
    'HSN / SAC Code',
    'Service Description',
    'Gross Invoice Value (INR)',
    'Taxable Value (INR)',
    'GST Rate (%)',
    'CGST Rate (%)',
    'CGST Amount (INR)',
    'SGST Rate (%)',
    'SGST Amount (INR)',
    'IGST Rate (%)',
    'IGST Amount (INR)',
    'Total GST Amount (INR)',
    'Payment Gateway Order ID',
    'Payment Transaction ID',
    'Payment Method',
    'Environment',
    'Status',
    'Seller Legal Name Snapshot',
    'Seller GSTIN Snapshot',
  ];

  const rows: string[][] = [];

  if (isNilMonth) {
    rows.push([
      periodDetails.monthYearLabel,
      periodDetails.periodCode,
      periodDetails.dateRangeLabel,
      `NIL_RETURN_STATEMENT (${periodDetails.monthYearLabel})`,
      `NIL-${periodDetails.shortMonthName.toUpperCase()}-${periodDetails.year}`,
      `NO_BILLS_${periodDetails.shortMonthName.toUpperCase()}_${periodDetails.year}`,
      `${periodDetails.startDateIso} to ${periodDetails.endDateIso} (${periodDetails.monthYearLabel})`,
      '',
      `NO BILLS IN ${periodDetails.monthYearLabel.toUpperCase()} (Nil Return)`,
      '',
      '',
      'NIL',
      settings.stateCode || '33',
      settings.stateName || 'Tamil Nadu',
      'INTRA',
      'NONE',
      settings.defaultSacCode || '998431',
      `Monthly GST Nil Statement for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel}) — 0 Bills Recorded`,
      '0.00',
      '0.00',
      '18',
      '9',
      '0.00',
      '9',
      '0.00',
      '18',
      '0.00',
      '0.00',
      '',
      '',
      'NIL_RETURN',
      'NIL',
      `NIL_RETURN_${periodDetails.shortMonthName.toUpperCase()}_${periodDetails.year}`,
      settings.legalBusinessName,
      settings.gstin || 'UNREGISTERED',
    ]);
  }

  invoices.forEach((rawInv, idx) => {
    const inv = ensurePurchaseGstFields(rawInv, settings, idx + 1);
    const snap = inv.sellerSnapshot || buildSellerSnapshot(settings);
    const invMonthInfo = getInvoiceMonthYearFromIso(inv.createdAt);
    const rowMonthLabel =
      periodDetails.periodCode === 'ALL' ? invMonthInfo.monthYear : periodDetails.monthYearLabel;
    const rowFpCode =
      periodDetails.periodCode === 'ALL' ? invMonthInfo.fpCode : periodDetails.periodCode;

    rows.push([
      rowMonthLabel,
      rowFpCode,
      periodDetails.dateRangeLabel,
      snap.isGstRegistered ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
      inv.invoiceNumber || inv.receiptNumber,
      inv.receiptNumber,
      inv.createdAt,
      '',
      inv.customerName || inv.userEmail.split('@')[0],
      inv.userEmail,
      inv.userPhone || '',
      inv.customerGstin || 'UNREGISTERED',
      inv.placeOfSupplyStateCode || snap.stateCode,
      inv.placeOfSupplyStateName || snap.stateName,
      inv.supplyType || 'INTRA',
      inv.taxType || 'CGST_SGST',
      inv.hsnSacCode || '998431',
      `${inv.comicTitle} (${inv.type}) — ${rowMonthLabel}`,
      (inv.amountInr || 0).toFixed(2),
      (inv.taxableValue || 0).toFixed(2),
      String(inv.taxRate ?? 18),
      String(inv.cgstRate ?? 9),
      (inv.cgstAmount || 0).toFixed(2),
      String(inv.sgstRate ?? 9),
      (inv.sgstAmount || 0).toFixed(2),
      String(inv.igstRate ?? 0),
      (inv.igstAmount || 0).toFixed(2),
      (inv.taxAmount || 0).toFixed(2),
      inv.razorpayOrderId || '',
      inv.razorpayPaymentId || '',
      inv.paymentMethod || '',
      (inv.environment || 'test').toUpperCase(),
      inv.creditNoteNumber ? `REFUNDED (${inv.creditNoteNumber})` : inv.status.toUpperCase(),
      snap.legalBusinessName,
      snap.gstin || 'UNREGISTERED',
    ]);
  });

  creditNotes.forEach((cn) => {
    const snap = cn.sellerSnapshot || buildSellerSnapshot(settings);
    const cnMonthInfo = getInvoiceMonthYearFromIso(cn.createdAt);
    const rowMonthLabel =
      periodDetails.periodCode === 'ALL' ? cnMonthInfo.monthYear : periodDetails.monthYearLabel;
    const rowFpCode =
      periodDetails.periodCode === 'ALL' ? cnMonthInfo.fpCode : periodDetails.periodCode;

    rows.push([
      rowMonthLabel,
      rowFpCode,
      periodDetails.dateRangeLabel,
      'CREDIT_NOTE',
      cn.creditNoteNumber,
      cn.originalPurchaseId,
      cn.createdAt,
      cn.originalInvoiceNumber,
      cn.customerName || cn.userEmail.split('@')[0],
      cn.userEmail,
      cn.userPhone || '',
      cn.customerGstin || 'UNREGISTERED',
      cn.placeOfSupplyStateCode,
      cn.placeOfSupplyStateName,
      cn.supplyType,
      cn.taxType,
      cn.hsnSacCode,
      `Credit Note / Refund (${rowMonthLabel}): ${cn.reason}`,
      (-cn.grossAmountInr).toFixed(2),
      (-cn.taxableValue).toFixed(2),
      String(cn.taxRate),
      String(cn.cgstRate),
      (-cn.cgstAmount).toFixed(2),
      String(cn.sgstRate),
      (-cn.sgstAmount).toFixed(2),
      String(cn.igstRate),
      (-cn.igstAmount).toFixed(2),
      (-cn.taxAmount).toFixed(2),
      '',
      '',
      'REFUND / ADJUSTMENT',
      'LIVE/TEST',
      'ISSUED',
      snap.legalBusinessName,
      snap.gstin || 'UNREGISTERED',
    ]);
  });

  const summary = computeGstPeriodSummary(invoices, creditNotes, settings);
  rows.push([
    periodDetails.monthYearLabel,
    periodDetails.periodCode,
    periodDetails.dateRangeLabel,
    `NET RECONCILIATION TOTAL (${periodDetails.monthYearLabel})`,
    `Invoices: ${summary.invoiceCount} | Credit Notes: ${summary.creditNoteCount}`,
    isNilMonth ? `NIL_RETURN_${periodDetails.shortMonthName.toUpperCase()}_${periodDetails.year}` : `ACTIVE_${periodDetails.periodCode}`,
    `${periodDetails.startDateIso} to ${periodDetails.endDateIso}`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    settings.defaultSacCode || '998431',
    `Net Output Tax Liability for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel})`,
    summary.netPayableSalesInr.toFixed(2),
    summary.netTaxableValue.toFixed(2),
    '',
    '',
    summary.netCgstLiability.toFixed(2),
    '',
    summary.netSgstLiability.toFixed(2),
    '',
    summary.netIgstLiability.toFixed(2),
    summary.netTotalGstLiability.toFixed(2),
    '',
    '',
    '',
    '',
    isNilMonth ? `NIL_RETURN_${periodDetails.monthYearLabel.toUpperCase()}` : 'UNFILED_REPORT_ONLY',
    settings.legalBusinessName,
    settings.gstin || 'UNREGISTERED',
  ]);

  return [
    ...metadataRows.map((r) => r.map(escapeCsvCell).join(',')),
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ' ' + ONES[o] : ''}`;
}

export function amountInIndianWords(amount: number): string {
  const clean = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(clean);
  const paise = Math.round((clean - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const parts: string[] = [];
  let rem = rupees;

  const crores = Math.floor(rem / 10000000);
  rem %= 10000000;
  if (crores > 0) parts.push(`${twoDigitsToWords(crores)} Crore`);

  const lakhs = Math.floor(rem / 100000);
  rem %= 100000;
  if (lakhs > 0) parts.push(`${twoDigitsToWords(lakhs)} Lakh`);

  const thousands = Math.floor(rem / 1000);
  rem %= 1000;
  if (thousands > 0) parts.push(`${twoDigitsToWords(thousands)} Thousand`);

  const hundreds = Math.floor(rem / 100);
  rem %= 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);

  if (rem > 0) {
    if (parts.length > 0) parts.push('and');
    parts.push(twoDigitsToWords(rem));
  }

  const rupeeStr = parts.length > 0 ? `Indian Rupees ${parts.join(' ')}` : '';
  const paiseStr = paise > 0 ? `${twoDigitsToWords(paise)} Paise` : '';

  if (rupeeStr && paiseStr) return `${rupeeStr} and ${paiseStr} Only`;
  if (rupeeStr) return `${rupeeStr} Only`;
  return `${paiseStr} Only`;
}

function escapePdfText(raw: string): string {
  return String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a genuine ISO-32000 / PDF 1.4 binary document (`Uint8Array<ArrayBuffer>`) for an individual
 * Customer GST Tax Invoice (or Bill of Supply if unregistered, or Credit Note if refunded).
 * Works identically in Node.js and browser environments with zero external dependencies.
 * Supports either `{ purchase, settings, creditNote }` or positional `(purchase, settings, creditNote)`.
 */
export function generateTaxInvoicePdfBytes(
  paramsOrPurchase:
    | {
        purchase: Purchase;
        settings?: GstBusinessSettings | null;
        creditNote?: CreditNoteRecord | null;
      }
    | Purchase,
  settingsArg?: GstBusinessSettings | null,
  creditNoteArg?: CreditNoteRecord | null
): Uint8Array<ArrayBuffer> {
  const isDirectPurchase = 'amountInr' in paramsOrPurchase && 'receiptNumber' in paramsOrPurchase;
  const rawPurchase = isDirectPurchase ? (paramsOrPurchase as Purchase) : paramsOrPurchase.purchase;
  const s = (isDirectPurchase ? settingsArg : paramsOrPurchase.settings) || getDefaultGstBusinessSettings();
  const inv = ensurePurchaseGstFields(rawPurchase, s, 1);
  const cn = (isDirectPurchase ? creditNoteArg : paramsOrPurchase.creditNote) || null;
  const snap = cn ? cn.sellerSnapshot : inv.sellerSnapshot || buildSellerSnapshot(s);

  const isCreditNote = Boolean(cn);
  const isCustomerGstDisabled = s.applyGstToDomesticSales === false && !isCreditNote;
  const hasGstin = Boolean(snap.gstin && snap.gstin.trim().length === 15);
  const docTitle = isCreditNote
    ? 'GST CREDIT NOTE'
    : isCustomerGstDisabled
      ? 'OFFICIAL PAYMENT RECEIPT'
      : hasGstin && (inv.taxAmount || 0) > 0
        ? 'TAX INVOICE'
        : 'BILL OF SUPPLY / RECEIPT';

  const docNumber = isCreditNote
    ? cn!.creditNoteNumber
    : isCustomerGstDisabled
      ? inv.receiptNumber
      : inv.invoiceNumber || inv.receiptNumber;
  const docDate = new Date(isCreditNote ? cn!.createdAt : inv.createdAt).toLocaleDateString(
    'en-IN',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }
  );

  const taxableVal = isCreditNote
    ? cn!.taxableValue
    : isCustomerGstDisabled
      ? inv.amountInr || 0
      : inv.taxableValue || 0;
  const cgstRate = isCreditNote ? cn!.cgstRate : isCustomerGstDisabled ? 0 : inv.cgstRate || 0;
  const cgstAmt = isCreditNote ? cn!.cgstAmount : isCustomerGstDisabled ? 0 : inv.cgstAmount || 0;
  const sgstRate = isCreditNote ? cn!.sgstRate : isCustomerGstDisabled ? 0 : inv.sgstRate || 0;
  const sgstAmt = isCreditNote ? cn!.sgstAmount : isCustomerGstDisabled ? 0 : inv.sgstAmount || 0;
  const igstRate = isCreditNote ? cn!.igstRate : isCustomerGstDisabled ? 0 : inv.igstRate || 0;
  const igstAmt = isCreditNote ? cn!.igstAmount : isCustomerGstDisabled ? 0 : inv.igstAmount || 0;
  const totalTax = isCreditNote ? cn!.taxAmount : isCustomerGstDisabled ? 0 : inv.taxAmount || 0;
  const grossAmt = isCreditNote ? cn!.grossAmountInr : inv.amountInr || 0;

  const ops: string[] = [];

  // Helper drawing functions on A4 canvas (595 x 842 pt)
  const rectFill = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    ops.push(`${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg ${x} ${y} ${w} ${h} re f`);
  };
  const rectStroke = (x: number, y: number, w: number, h: number, gray: number = 0.75) => {
    ops.push(`${gray.toFixed(2)} G 0.8 w ${x} ${y} ${w} ${h} re S`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, gray: number = 0.8) => {
    ops.push(`${gray.toFixed(2)} G 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const text = (
    x: number,
    y: number,
    str: string,
    font: 'F1' | 'F2' | 'F3' = 'F1',
    size: number = 9,
    r: number = 0.08,
    g: number = 0.1,
    b: number = 0.15
  ) => {
    ops.push(
      `BT /${font} ${size} Tf ${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg ${x} ${y} Td (${escapePdfText(
        str
      )}) Tj ET`
    );
  };

  if (isCustomerGstDisabled) {
    // NON-GST OFFICIAL CUSTOMER PAYMENT RECEIPT LAYOUT (WHEN ADMIN HAS TURNED OFF CUSTOMER GST BILLING)
    rectFill(36, 755, 523, 55, 0.06, 0.09, 0.16);
    text(50, 786, snap.tradeName || 'AATHIRAI_COMIC', 'F2', 16, 1, 1, 1);
    text(50, 769, snap.legalBusinessName, 'F1', 9, 0.8, 0.85, 0.92);
    text(350, 786, 'OFFICIAL PAYMENT RECEIPT', 'F2', 13, 0.98, 0.75, 0.18);
    text(350, 769, 'Verified Digital Purchase Receipt (No GST Applied)', 'F1', 7.5, 0.85, 0.88, 0.94);

    rectFill(36, 708, 523, 42, 0.96, 0.97, 0.99);
    rectStroke(36, 708, 523, 42, 0.82);
    text(48, 733, `Receipt No: ${inv.receiptNumber}`, 'F2', 9.5);
    text(48, 718, `Transaction ID: ${inv.razorpayPaymentId || 'N/A'}`, 'F3', 8.5, 0.3, 0.35, 0.45);
    text(250, 733, `Date of Payment: ${docDate}`, 'F2', 9.5);
    text(250, 718, `Order ID: ${inv.razorpayOrderId || 'N/A'}`, 'F3', 8.5, 0.3, 0.35, 0.45);
    text(425, 733, 'Payment Status: PAID', 'F2', 9, 0.04, 0.5, 0.3);
    text(425, 718, 'Tax Status: No GST', 'F1', 8, 0.3, 0.35, 0.45);

    rectStroke(36, 610, 256, 88, 0.82);
    rectStroke(303, 610, 256, 88, 0.82);

    text(46, 682, 'PUBLISHER DETAILS', 'F2', 8.5, 0.85, 0.12, 0.3);
    text(46, 665, snap.legalBusinessName.slice(0, 44), 'F2', 9.5);
    text(46, 649, (snap.registeredAddress || 'Chennai, Tamil Nadu, India').slice(0, 48), 'F1', 8.5, 0.25, 0.3, 0.4);
    text(46, 633, `Platform: ${snap.tradeName || 'Aathirai_Comic'}`, 'F1', 8.5);
    text(46, 618, 'Digital Comics & E-Publishing Platform', 'F1', 8, 0.3, 0.35, 0.45);

    text(313, 682, 'CUSTOMER DETAILS', 'F2', 8.5, 0.85, 0.12, 0.3);
    text(313, 665, (inv.customerName || inv.userEmail.split('@')[0] || 'Reader').slice(0, 42), 'F2', 9.5);
    text(313, 649, `Email: ${inv.userEmail}`, 'F1', 8.5, 0.25, 0.3, 0.4);
    text(313, 633, `Mobile: ${inv.userPhone || 'N/A'} | UPI: ${inv.userUpiId || 'N/A'}`, 'F1', 8.5, 0.25, 0.3, 0.4);
    text(313, 618, `Payment Method: ${(inv.paymentMethod || 'UPI').slice(0, 38)}`, 'F1', 8, 0.3, 0.35, 0.45);

    // Itemized Non-GST Receipt Table
    rectFill(36, 568, 523, 24, 0.1, 0.14, 0.22);
    text(46, 577, 'Description of Digital Access / Membership', 'F2', 8.5, 1, 1, 1);
    text(350, 577, 'Plan / Access Type', 'F2', 8.5, 1, 1, 1);
    text(485, 577, 'Amount Paid', 'F2', 8.5, 1, 1, 1);

    rectStroke(36, 518, 523, 50, 0.82);
    const itemDesc = `${inv.comicTitle} (${inv.type.toUpperCase()})`;
    text(46, 548, itemDesc.slice(0, 52), 'F2', 9.5);
    text(46, 532, 'Digital Comic Reading Access & Membership Unlock', 'F1', 8, 0.35, 0.4, 0.5);
    text(350, 540, inv.subscriptionPlan ? inv.subscriptionPlan.replace('_', ' ').toUpperCase() : inv.type.toUpperCase(), 'F3', 8.5);
    text(485, 540, `Rs. ${grossAmt.toFixed(2)}`, 'F2', 9.5);

    // Non-GST Payment Summary Box
    rectFill(36, 405, 523, 98, 0.98, 0.98, 0.99);
    rectStroke(36, 405, 523, 98, 0.82);

    text(48, 485, 'PAYMENT SUMMARY (NO GST)', 'F2', 9, 0.08, 0.1, 0.15);
    text(48, 468, `Payment Reference: ${inv.razorpayPaymentId || 'N/A'} (${inv.paymentMethod || 'UPI'})`, 'F1', 8);
    text(48, 452, `Environment: ${(inv.environment || 'test').toUpperCase()} MODE`, 'F2', 8);
    text(48, 434, `Amount in Words: ${amountInIndianWords(grossAmt).slice(0, 68)}`, 'F2', 8.5, 0.1, 0.35, 0.25);
    text(48, 416, 'Note: This receipt is issued without GST (No GST charged on this bill).', 'F1', 8, 0.35, 0.4, 0.45);

    line(340, 412, 340, 496, 0.85);
    text(352, 480, 'Item Price:', 'F1', 8.5);
    text(485, 480, `Rs. ${grossAmt.toFixed(2)}`, 'F3', 8.5);
    text(352, 460, 'Tax / GST:', 'F1', 8.5);
    text(485, 460, 'No GST (Rs. 0.00)', 'F1', 8.5, 0.35, 0.4, 0.45);
    line(352, 444, 548, 444, 0.7);
    text(352, 424, 'Total Amount Paid:', 'F2', 10);
    text(485, 424, `Rs. ${grossAmt.toFixed(2)}`, 'F2', 10.5, 0.04, 0.5, 0.3);

    text(
      36,
      370,
      'Declaration: We confirm receipt of the above payment for digital comic access on Aathirai_Comic. No GST has been charged.',
      'F1',
      7.5,
      0.35,
      0.4,
      0.45
    );
    text(
      36,
      354,
      `Computer Generated Official Payment Receipt - ${snap.legalBusinessName} (${snap.tradeName || 'Aathirai_Comic'})`,
      'F2',
      8,
      0.2,
      0.25,
      0.35
    );
  } else {
    // 1. Top Header Banner (GST TAX INVOICE / CREDIT NOTE MODE)
    rectFill(36, 755, 523, 55, 0.06, 0.09, 0.16);
    text(50, 786, snap.tradeName || 'AATHIRAI_COMIC', 'F2', 16, 1, 1, 1);
    text(50, 769, snap.legalBusinessName, 'F1', 9, 0.8, 0.85, 0.92);
    text(390, 786, docTitle, 'F2', 13, 0.98, 0.75, 0.18);
    text(390, 769, 'Original for Recipient (Rule 46 CGST Rules)', 'F1', 7.5, 0.85, 0.88, 0.94);

    // 2. Invoice Metadata Bar
    rectFill(36, 708, 523, 42, 0.96, 0.97, 0.99);
    rectStroke(36, 708, 523, 42, 0.82);
    text(48, 733, `Document No: ${docNumber}`, 'F2', 9.5);
    text(48, 718, `Receipt Ref: ${inv.receiptNumber}`, 'F3', 8.5, 0.3, 0.35, 0.45);
    text(230, 733, `Date of Issue: ${docDate}`, 'F2', 9.5);
    text(
      230,
      718,
      isCreditNote
        ? `Orig. Invoice: ${cn!.originalInvoiceNumber}`
        : `Order ID: ${inv.razorpayOrderId || 'N/A'}`,
      'F3',
      8.5,
      0.3,
      0.35,
      0.45
    );
    text(415, 733, `Place of Supply: ${inv.placeOfSupplyStateCode}-${inv.placeOfSupplyStateName}`, 'F2', 8.5);
    text(415, 718, `Supply Type: ${inv.supplyType || 'INTRA'} (Reverse Charge: N)`, 'F1', 8, 0.3, 0.35, 0.45);

    // 3. Two-Column Supplier & Recipient Details Box
    rectStroke(36, 598, 256, 100, 0.82);
    rectStroke(303, 598, 256, 100, 0.82);

    text(46, 682, 'SUPPLIER / PUBLISHER DETAILS', 'F2', 8.5, 0.85, 0.12, 0.3);
    text(46, 667, snap.legalBusinessName.slice(0, 44), 'F2', 9.5);
    text(46, 653, (snap.registeredAddress || 'Chennai, Tamil Nadu, India').slice(0, 48), 'F1', 8.5, 0.25, 0.3, 0.4);
    text(46, 639, `State: ${snap.stateName} (State Code: ${snap.stateCode})`, 'F1', 8.5);
    text(
      46,
      623,
      `Seller GSTIN: ${snap.gstin ? snap.gstin : 'UNREGISTERED (No GSTIN Claimed)'}`,
      'F2',
      8.5,
      snap.gstin ? 0.05 : 0.45,
      snap.gstin ? 0.45 : 0.3,
      0.2
    );
    text(46, 608, `SAC Code: ${snap.hsnSacCode || '998431'} (Digital Comics / E-Publishing)`, 'F1', 8, 0.3, 0.35, 0.45);

    text(313, 682, 'BILLED TO (CUSTOMER DETAILS)', 'F2', 8.5, 0.85, 0.12, 0.3);
    text(313, 667, (inv.customerName || inv.userEmail.split('@')[0] || 'Reader').slice(0, 42), 'F2', 9.5);
    text(313, 653, `Email: ${inv.userEmail}`, 'F1', 8.5, 0.25, 0.3, 0.4);
    text(313, 639, `Mobile: ${inv.userPhone || 'N/A'} | UPI: ${inv.userUpiId || 'N/A'}`, 'F1', 8.5, 0.25, 0.3, 0.4);
    text(
      313,
      623,
      `Customer GSTIN: ${inv.customerGstin ? inv.customerGstin : 'Unregistered Consumer (B2CS)'}`,
      'F2',
      8.5
    );
    text(
      313,
      608,
      `Place of Supply: ${inv.placeOfSupplyStateName} (${inv.placeOfSupplyStateCode})`,
      'F1',
      8,
      0.3,
      0.35,
      0.45
    );

    // 4. Itemized Tax Breakdown Table
    rectFill(36, 562, 523, 24, 0.1, 0.14, 0.22);
    text(44, 571, 'Description of Digital Service', 'F2', 8.5, 1, 1, 1);
    text(245, 571, 'SAC', 'F2', 8.5, 1, 1, 1);
    text(290, 571, 'Taxable (INR)', 'F2', 8.5, 1, 1, 1);
    text(365, 571, 'CGST', 'F2', 8.5, 1, 1, 1);
    text(425, 571, 'SGST', 'F2', 8.5, 1, 1, 1);
    text(480, 571, 'IGST', 'F2', 8.5, 1, 1, 1);
    text(520, 571, 'Total', 'F2', 8.5, 1, 1, 1);

    rectStroke(36, 512, 523, 50, 0.82);
    const itemDesc = isCreditNote
      ? `Credit Note (${cn!.reason}): ${inv.comicTitle}`
      : `${inv.comicTitle} (${inv.type.toUpperCase()})`;
    text(44, 542, itemDesc.slice(0, 38), 'F2', 9);
    text(
      44,
      527,
      (inv.hsnSacDescription || 'Online Digital Comics & Subscription').slice(0, 44),
      'F1',
      7.5,
      0.35,
      0.4,
      0.5
    );
    text(245, 536, inv.hsnSacCode || '998431', 'F3', 8.5);
    text(295, 536, `Rs.${taxableVal.toFixed(2)}`, 'F3', 8.5);
    text(362, 542, `Rs.${cgstAmt.toFixed(2)}`, 'F3', 8);
    text(362, 528, `(${cgstRate}%)`, 'F1', 7, 0.4, 0.45, 0.5);
    text(422, 542, `Rs.${sgstAmt.toFixed(2)}`, 'F3', 8);
    text(422, 528, `(${sgstRate}%)`, 'F1', 7, 0.4, 0.45, 0.5);
    text(476, 542, `Rs.${igstAmt.toFixed(2)}`, 'F3', 8);
    text(476, 528, `(${igstRate}%)`, 'F1', 7, 0.4, 0.45, 0.5);
    text(515, 536, `Rs.${grossAmt.toFixed(2)}`, 'F2', 9);

    // 5. Tax Calculation Summary Box (GST-Inclusive Formula Explanation)
    rectFill(36, 380, 523, 120, 0.98, 0.98, 0.99);
    rectStroke(36, 380, 523, 120, 0.82);

    text(48, 482, 'GST-INCLUSIVE TAX SUMMARY', 'F2', 9, 0.08, 0.1, 0.15);
    text(
      48,
      466,
      totalTax > 0
        ? `Formula Applied: Included GST = Gross Amount x ${inv.taxRate || 18} / ${100 + (inv.taxRate || 18)}`
        : 'Tax Status: 0% GST (Exempt / Unregistered / Export Supply)',
      'F1',
      8,
      0.3,
      0.35,
      0.45
    );
    text(48, 448, `Payment Ref: ${inv.razorpayPaymentId || 'N/A'} (${inv.paymentMethod || 'UPI'})`, 'F1', 8);
    text(48, 432, `Environment: ${(inv.environment || 'test').toUpperCase()} MODE`, 'F2', 8);
    text(48, 412, `Amount in Words: ${amountInIndianWords(grossAmt).slice(0, 68)}`, 'F2', 8.5, 0.1, 0.35, 0.25);
    if (isCreditNote) {
      text(48, 394, `Credit Note Reason: ${cn!.reason}`, 'F2', 8, 0.75, 0.15, 0.2);
    }

    // Right-side totals column inside summary box
    line(340, 385, 340, 495, 0.85);
    text(352, 480, 'Base Taxable Value:', 'F1', 8.5);
    text(490, 480, `Rs. ${taxableVal.toFixed(2)}`, 'F3', 8.5);

    text(352, 463, `CGST (${cgstRate}%):`, 'F1', 8.5);
    text(490, 463, `Rs. ${cgstAmt.toFixed(2)}`, 'F3', 8.5);

    text(352, 446, `SGST / UTGST (${sgstRate}%):`, 'F1', 8.5);
    text(490, 446, `Rs. ${sgstAmt.toFixed(2)}`, 'F3', 8.5);

    text(352, 429, `IGST (${igstRate}%):`, 'F1', 8.5);
    text(490, 429, `Rs. ${igstAmt.toFixed(2)}`, 'F3', 8.5);

    line(352, 418, 548, 418, 0.7);
    text(352, 400, isCreditNote ? 'Total Credit Note Value:' : 'Final Amount Paid (Incl. GST):', 'F2', 9.5);
    text(485, 400, `Rs. ${grossAmt.toFixed(2)}`, 'F2', 10, 0.04, 0.5, 0.3);

    // 6. Statutory Compliance Footer
    text(
      36,
      348,
      'Statutory Declaration: We declare that this invoice shows the actual price of the digital services described and that all particulars are true and correct.',
      'F1',
      7.5,
      0.35,
      0.4,
      0.45
    );
    text(
      36,
      334,
      'Note: Downloading this tax invoice or GSTR-1 report does not constitute automatic GST return filing or tax payment on the GST portal.',
      'F1',
      7.5,
      0.35,
      0.4,
      0.45
    );
    text(
      36,
      320,
      `Computer Generated Official Document - ${snap.legalBusinessName} (${snap.tradeName || 'Aathirai_Comic'})`,
      'F2',
      8,
      0.2,
      0.25,
      0.35
    );
  }

  const contentStream = ops.join('\n');

  // Assemble PDF 1.4 objects with exact byte offsets
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /MediaBox [0 0 595 842] /Contents 7 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
    `7 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdfBody = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdfBody.length);
    pdfBody += obj;
  }

  const xrefOffset = pdfBody.length;
  pdfBody += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdfBody += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfBody += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const encoder = new TextEncoder();
  const encoded = encoder.encode(pdfBody);
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  out.set(encoded);
  return out;
}

/**
 * Generates an official Monthly GST Statement Summary PDF (`%PDF-1.4`) for the selected month/period,
 * showing the specific Month & Year (e.g. "August 2026"), Date Range ("01 Aug 2026 to 31 Aug 2026"),
 * business GSTIN, period (`MMYYYY`), B2B vs B2CS summary, CGST, SGST, IGST, Net GST Payable,
 * and itemized list of invoices (or Nil Return declaration if 0 bills).
 */
export function generateMonthlyGstStatementPdfBytes(
  invoices: Purchase[],
  creditNotes: CreditNoteRecord[],
  settings: GstBusinessSettings,
  periodFilter: string = 'ALL'
): Uint8Array<ArrayBuffer> {
  const s = settings || getDefaultGstBusinessSettings();
  const snap = buildSellerSnapshot(s);
  const summary = computeGstPeriodSummary(invoices, creditNotes, s, periodFilter);
  const periodDetails = getGstPeriodDetails(periodFilter);
  const isNilMonth = summary.filteredInvoices.length === 0 && summary.filteredCreditNotes.length === 0;

  const ops: string[] = [];
  const rectFill = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    ops.push(`${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg ${x} ${y} ${w} ${h} re f`);
  };
  const rectStroke = (x: number, y: number, w: number, h: number, gray: number = 0.75) => {
    ops.push(`${gray.toFixed(2)} G 0.8 w ${x} ${y} ${w} ${h} re S`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, gray: number = 0.8) => {
    ops.push(`${gray.toFixed(2)} G 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const text = (
    x: number,
    y: number,
    str: string,
    font: 'F1' | 'F2' | 'F3' = 'F1',
    size: number = 9,
    r: number = 0.08,
    g: number = 0.1,
    b: number = 0.15
  ) => {
    ops.push(
      `BT /${font} ${size} Tf ${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg ${x} ${y} Td (${escapePdfText(
        str
      )}) Tj ET`
    );
  };

  // 1. Header Banner — Explicitly shows the specific Month & Year (e.g., AUGUST 2026)
  rectFill(36, 755, 523, 55, 0.06, 0.09, 0.16);
  text(
    46,
    786,
    `${snap.tradeName || 'AATHIRAI_COMIC'} - MONTHLY GST STATEMENT: ${periodDetails.monthYearLabel.toUpperCase()}`,
    'F2',
    11.5,
    1,
    1,
    1
  );
  text(
    46,
    769,
    `${snap.legalBusinessName} | SAC: ${snap.hsnSacCode || '998431'} | ${isNilMonth ? 'NIL RETURN (0 BILLS)' : `${summary.totalInvoices} BILLS`}`,
    'F1',
    8,
    0.8,
    0.85,
    0.92
  );
  text(
    365,
    786,
    `Month: ${periodDetails.monthYearLabel} (${periodDetails.periodCode})`,
    'F2',
    10,
    0.98,
    0.75,
    0.18
  );
  text(
    365,
    769,
    `Range: ${periodDetails.dateRangeLabel}`,
    'F1',
    8,
    0.85,
    0.88,
    0.94
  );

  // 2. Business & Specific Month Info Box
  rectFill(36, 688, 523, 58, 0.96, 0.97, 0.99);
  rectStroke(36, 688, 523, 58, 0.82);
  text(
    48,
    730,
    `Statement Month & Year: ${periodDetails.monthYearLabel.toUpperCase()} | Return Period: ${periodDetails.periodCode} (${periodDetails.dateRangeLabel})`,
    'F2',
    9
  );
  text(
    48,
    715,
    `Seller GSTIN: ${snap.gstin ? snap.gstin : 'UNREGISTERED (Enter 15-digit GSTIN in Admin Console)'}`,
    'F2',
    9,
    snap.gstin ? 0.04 : 0.65,
    snap.gstin ? 0.45 : 0.25,
    0.2
  );
  text(
    48,
    700,
    `Principal Place of Business: ${snap.stateCode} - ${snap.stateName} | ${snap.registeredAddress.slice(0, 50)}`,
    'F1',
    8,
    0.3,
    0.35,
    0.45
  );

  // 3. Monthly Tax Liability Summary Box
  rectFill(36, 560, 523, 118, 0.99, 0.99, 1);
  rectStroke(36, 560, 523, 118, 0.8);
  text(
    48,
    660,
    `MONTHLY GST OUTPUT TAX SUMMARY FOR ${periodDetails.monthYearLabel.toUpperCase()} (${periodDetails.dateRangeLabel})`,
    'F2',
    9,
    0.85,
    0.12,
    0.3
  );
  line(48, 653, 547, 653, 0.85);

  text(
    48,
    636,
    `Bills in ${periodDetails.monthYearLabel}: ${summary.totalInvoices} (B2B: ${summary.b2bCount}, B2CS: ${summary.b2csCount})`,
    'F2',
    8.5
  );
  text(48, 620, `Credit Notes in ${periodDetails.monthYearLabel}: ${summary.totalCreditNotes}`, 'F1', 8.5);
  text(48, 604, `Gross Sales Value (Incl. GST): Rs. ${summary.grossSalesInr.toFixed(2)}`, 'F1', 8.5);
  text(48, 588, `Credit Note Adjustments: -Rs. ${summary.creditNoteGrossInr.toFixed(2)}`, 'F1', 8.5);
  text(
    48,
    572,
    `Net Sales Value (${periodDetails.monthYearLabel}): Rs. ${summary.netInvoiceValue.toFixed(2)}`,
    'F2',
    9
  );

  line(310, 568, 310, 648, 0.85);
  text(322, 636, `Net Base Taxable Value:`, 'F1', 8.5);
  text(475, 636, `Rs. ${summary.netTaxableValue.toFixed(2)}`, 'F3', 8.5);

  text(322, 620, `Net CGST Liability (9%):`, 'F1', 8.5);
  text(475, 620, `Rs. ${summary.netCgst.toFixed(2)}`, 'F3', 8.5);

  text(322, 604, `Net SGST Liability (9%):`, 'F1', 8.5);
  text(475, 604, `Rs. ${summary.netSgst.toFixed(2)}`, 'F3', 8.5);

  text(322, 588, `Net IGST Liability (18%):`, 'F1', 8.5);
  text(475, 588, `Rs. ${summary.netIgst.toFixed(2)}`, 'F3', 8.5);

  text(322, 571, `NET GST PAYABLE (${periodDetails.shortMonthName.toUpperCase()} ${periodDetails.year}):`, 'F2', 8.5, 0.04, 0.5, 0.3);
  text(475, 571, `Rs. ${summary.netTaxLiability.toFixed(2)}`, 'F2', 9.5, 0.04, 0.5, 0.3);

  // 4. Invoices Table in Statement
  rectFill(36, 526, 523, 22, 0.1, 0.14, 0.22);
  text(42, 534, 'Statement Month', 'F2', 7.5, 1, 1, 1);
  text(118, 534, 'Invoice / Ref', 'F2', 7.5, 1, 1, 1);
  text(192, 534, 'Date / Range', 'F2', 7.5, 1, 1, 1);
  text(275, 534, 'Customer / Status', 'F2', 7.5, 1, 1, 1);
  text(370, 534, 'Taxable', 'F2', 7.5, 1, 1, 1);
  text(422, 534, 'CGST+SGST', 'F2', 7.5, 1, 1, 1);
  text(478, 534, 'IGST', 'F2', 7.5, 1, 1, 1);
  text(518, 534, 'Gross', 'F2', 7.5, 1, 1, 1);

  const maxRows = Math.min(summary.filteredInvoices.length, 16);
  let yPos = 510;
  for (let i = 0; i < maxRows; i++) {
    const inv = summary.filteredInvoices[i];
    const dt = new Date(inv.createdAt).toLocaleDateString('en-IN');
    const invM = getInvoiceMonthYearFromIso(inv.createdAt);
    const cgstSgst = (inv.cgstAmount || 0) + (inv.sgstAmount || 0);
    text(42, yPos, invM.monthYear.slice(0, 14), 'F2', 7.5);
    text(118, yPos, (inv.invoiceNumber || inv.receiptNumber).slice(0, 14), 'F3', 7);
    text(192, yPos, dt, 'F1', 7.5);
    text(275, yPos, `${inv.userEmail.slice(0, 14)} (${inv.placeOfSupplyStateCode})`, 'F1', 7);
    text(370, yPos, (inv.taxableValue || 0).toFixed(2), 'F3', 7.5);
    text(422, yPos, cgstSgst.toFixed(2), 'F3', 7.5);
    text(478, yPos, (inv.igstAmount || 0).toFixed(2), 'F3', 7.5);
    text(518, yPos, inv.amountInr.toFixed(2), 'F3', 7.5);
    line(36, yPos - 4, 559, yPos - 4, 0.9);
    yPos -= 18;
  }

  if (summary.filteredInvoices.length === 0) {
    rectFill(36, 456, 523, 64, 0.98, 0.98, 0.99);
    rectStroke(36, 456, 523, 64, 0.82);
    text(42, 502, `${periodDetails.monthYearLabel}`, 'F2', 8, 0.08, 0.1, 0.15);
    text(118, yPos > 500 ? 502 : yPos, `NIL-${periodDetails.shortMonthName.toUpperCase()}-${periodDetails.year}`, 'F3', 7.5);
    text(192, 502, `${periodDetails.startDateIso}..${periodDetails.endDateIso.slice(8)}`, 'F3', 7.5);
    text(275, 502, `NO BILLS IN ${periodDetails.monthYearLabel.toUpperCase()}`, 'F2', 7.5, 0.85, 0.45, 0.05);
    text(370, 502, '0.00', 'F3', 8);
    text(422, 502, '0.00', 'F3', 8);
    text(478, 502, '0.00', 'F3', 8);
    text(518, 502, '0.00', 'F2', 8);
    line(42, 492, 550, 492, 0.88);
    text(
      42,
      478,
      `OFFICIAL NIL GST STATEMENT FOR ${periodDetails.monthYearLabel.toUpperCase()} (${periodDetails.dateRangeLabel}):`,
      'F2',
      8,
      0.15,
      0.2,
      0.3
    );
    text(
      42,
      465,
      `Zero outward taxable supplies (0 bills) recorded during ${periodDetails.monthYearLabel} (Return Period ${periodDetails.periodCode}). Net GST Payable: Rs. 0.00.`,
      'F1',
      7.5,
      0.3,
      0.35,
      0.45
    );
  }

  text(
    36,
    80,
    `Statutory Notice: Monthly GST Statement for ${periodDetails.monthYearLabel} (${periodDetails.periodCode}). Upload the GSTR-1 JSON on services.gst.gov.in to file your return.`,
    'F1',
    7.5,
    0.35,
    0.4,
    0.45
  );

  const contentStream = ops.join('\n');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /MediaBox [0 0 595 842] /Contents 7 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
    `7 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdfBody = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdfBody.length);
    pdfBody += obj;
  }

  const xrefOffset = pdfBody.length;
  pdfBody += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdfBody += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfBody += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const encoder = new TextEncoder();
  const encoded = encoder.encode(pdfBody);
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  out.set(encoded);
  return out;
}

