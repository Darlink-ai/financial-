/**
 * Parser de billing statement emerchantpay (EMP).
 *
 * EMP envoie un PDF hebdomadaire avec une structure très consistante :
 *   - Summary (Gross Volume, Debit, Fees, Net Reserves, Net Settlement, Payment Amount EUR)
 *   - Transaction Types Breakdown (Sales / Refunds / Chargebacks avec count + amount)
 *   - Sales Breakdown by Discount Type (Interchange++, Interchange Fees, Scheme Fees)
 *   - Transaction Fees (Sale Approved / Declined / Refund / Chargeback : count + rate + amount)
 *   - Reserves (Withheld + Released avec %)
 *
 * Le parser fait du regex sur le texte extrait du PDF. Il est conçu pour
 * échouer gracieusement : un champ qui ne match pas → renvoyé comme null,
 * l'utilisateur peut compléter à la main côté UI.
 */

export type ParsedEmpStatement = {
  // Période
  statementId: string | null;
  processingPeriodStart: string | null; // ISO
  processingPeriodEnd: string | null;   // ISO
  valueDate: string | null;             // ISO

  // Summary
  grossVolume: number | null;          // capturedAmount
  debit: number | null;                // refunds + chargebacks total
  fees: number | null;                 // total fees (summary)
  netReserves: number | null;          // withheld - released
  netSettlement: number | null;
  payoutAmountEur: number | null;      // Payment Amount EUR

  // Transaction types
  salesCount: number | null;           // captured
  refundsCount: number | null;
  refundAmount: number | null;
  chargebacksCount: number | null;
  chargebackAmount: number | null;

  // Discount Type breakdown
  interchangePlusRate: number | null;  // % (IC++ markup) — généralement 3.00
  interchangePlusAmount: number | null;
  interchangeAmount: number | null;    // pass-through
  schemeAmount: number | null;         // pass-through

  // Transaction Fees
  saleApprovedCount: number | null;
  saleApprovedRate: number | null;
  saleApprovedAmount: number | null;
  saleDeclinedCount: number | null;
  saleDeclinedRate: number | null;
  saleDeclinedAmount: number | null;
  refundFeeRate: number | null;
  refundFeeAmount: number | null;
  chargebackFeeAmount: number | null;  // total chargeback fees (rate vide dans EMP)

  // Reserves
  withheldReserveAmount: number | null;
  withheldReservePercent: number | null;
  releasedReserveAmount: number | null;
};

/** Empty result, all null. */
const EMPTY: ParsedEmpStatement = {
  statementId: null,
  processingPeriodStart: null,
  processingPeriodEnd: null,
  valueDate: null,
  grossVolume: null,
  debit: null,
  fees: null,
  netReserves: null,
  netSettlement: null,
  payoutAmountEur: null,
  salesCount: null,
  refundsCount: null,
  refundAmount: null,
  chargebacksCount: null,
  chargebackAmount: null,
  interchangePlusRate: null,
  interchangePlusAmount: null,
  interchangeAmount: null,
  schemeAmount: null,
  saleApprovedCount: null,
  saleApprovedRate: null,
  saleApprovedAmount: null,
  saleDeclinedCount: null,
  saleDeclinedRate: null,
  saleDeclinedAmount: null,
  refundFeeRate: null,
  refundFeeAmount: null,
  chargebackFeeAmount: null,
  withheldReserveAmount: null,
  withheldReservePercent: null,
  releasedReserveAmount: null,
};

/** Parse un nombre éventuellement entre parenthèses (= négatif comptable). */
function parseNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Retire parenthèses, espaces, garde le signe.
  let s = trimmed.replace(/[()\s']/g, "");
  // Format européen "1.234,56" → "1234.56"
  if (/,\d{1,2}$/.test(s) && /\./.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Format US "1,234.56" → "1234.56"
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : null; // toujours positif (le sens est porté par la colonne)
}

/** Parse une date "12 May 2026" → "2026-05-12" (ISO date). */
function parseEmpDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase().slice(0, 3);
  const year = parseInt(m[3], 10);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(monthName);
  if (month < 0) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse le texte d'un billing statement EMP.
 * Tous les champs sont best-effort : si un pattern ne match pas, le champ
 * reste null.
 */
export function parseEmpStatement(text: string): ParsedEmpStatement {
  // Normalise : enlève les retours à la ligne multiples, garde des espaces.
  const t = text.replace(/\r\n?/g, "\n");
  const out: ParsedEmpStatement = { ...EMPTY };

  // --- Statement ID ---
  const idMatch = t.match(/ID:\s*([A-Z0-9]+)/i);
  if (idMatch) out.statementId = idMatch[1];

  // --- Processing Period ---
  // "Processing Period: 12 May 2026 21:00:00 ~ 19 May 2026 20:59:59"
  const periodMatch = t.match(
    /Processing Period:?\s*(\d{1,2}\s+\w+\s+\d{4})[^\n]*?[~–\-]\s*(\d{1,2}\s+\w+\s+\d{4})/i,
  );
  if (periodMatch) {
    out.processingPeriodStart = parseEmpDate(periodMatch[1]);
    out.processingPeriodEnd = parseEmpDate(periodMatch[2]);
  }

  // --- Value Date ---
  const valueMatch = t.match(/Value Date:?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
  if (valueMatch) out.valueDate = parseEmpDate(valueMatch[1]);

  // --- Summary ---
  const summaryPatterns: Array<[keyof ParsedEmpStatement, RegExp]> = [
    ["grossVolume", /Gross Volume\s+([\d,.()]+)/i],
    ["debit", /^Debit\s+([\d,.()]+)/im],
    ["fees", /^Fees\s+([\d,.()]+)/im],
    ["netReserves", /Net Reserves\s+([\d,.()]+)/i],
    ["netSettlement", /Net Settlement\s+([\d,.()]+)/i],
  ];
  for (const [key, re] of summaryPatterns) {
    const m = t.match(re);
    if (m) (out[key] as number | null) = parseNum(m[1]);
  }

  // --- Payment Amount EUR ---
  const paymentMatch = t.match(/Payment Amount\s+([\d,.()]+)\s*EUR/i);
  if (paymentMatch) out.payoutAmountEur = parseNum(paymentMatch[1]);

  // --- Transaction Types Breakdown ---
  // "Sales/Settlements 2689 63,991.58"
  const salesMatch = t.match(/Sales\/Settlements\s+(\d+)\s+([\d,.()]+)/i);
  if (salesMatch) {
    out.salesCount = parseInt(salesMatch[1], 10);
    // grossVolume déjà capturé ci-dessus, mais on peut sanity-check
    if (out.grossVolume == null) out.grossVolume = parseNum(salesMatch[2]);
  }
  // "Refunds 6 (77.94)"
  const refundsMatch = t.match(/Refunds\s+(\d+)\s+([\d,.()]+)/i);
  if (refundsMatch) {
    out.refundsCount = parseInt(refundsMatch[1], 10);
    out.refundAmount = parseNum(refundsMatch[2]);
  }
  // "Chargebacks 10 (307.90)"
  const chargebacksMatch = t.match(/Chargebacks\s+(\d+)\s+([\d,.()]+)/i);
  if (chargebacksMatch) {
    out.chargebacksCount = parseInt(chargebacksMatch[1], 10);
    out.chargebackAmount = parseNum(chargebacksMatch[2]);
  }

  // --- Sales Breakdown by Discount Type ---
  // "Interchange++ 2689 Int++ 63,991.58 (1,919.55)"
  // Le rate "Int++" est un placeholder texte, le vrai % vient du contrat.
  // L'amount est le markup (pas le gross).
  const icPlusMatch = t.match(
    /Interchange\+\+\s+\d+\s+Int\+\+\s+[\d,.()]+\s+([\d,.()]+)/i,
  );
  if (icPlusMatch) {
    out.interchangePlusAmount = parseNum(icPlusMatch[1]);
    // % dérivé du gross
    if (out.grossVolume && out.interchangePlusAmount) {
      const pct = (out.interchangePlusAmount / out.grossVolume) * 100;
      out.interchangePlusRate = Math.round(pct * 100) / 100;
    }
  }
  // "Interchange Fees 2695 (1,037.88)"
  const icMatch = t.match(/Interchange Fees\s+\d+\s+([\d,.()]+)/i);
  if (icMatch) out.interchangeAmount = parseNum(icMatch[1]);
  // "Scheme Fees 2695 (929.49)"
  const schemeMatch = t.match(/Scheme Fees\s+\d+\s+([\d,.()]+)/i);
  if (schemeMatch) out.schemeAmount = parseNum(schemeMatch[1]);

  // --- Transaction Fees ---
  // "Sale Approved 2689 0.27 USD (726.03)"
  const saleApprovedMatch = t.match(
    /Sale Approved\s+(\d+)\s+([\d.]+)\s+[A-Z]{3}\s+([\d,.()]+)/i,
  );
  if (saleApprovedMatch) {
    out.saleApprovedCount = parseInt(saleApprovedMatch[1], 10);
    out.saleApprovedRate = parseFloat(saleApprovedMatch[2]);
    out.saleApprovedAmount = parseNum(saleApprovedMatch[3]);
  }
  // "Sale Declined 1599 0.16 USD (255.84)"
  const saleDeclinedMatch = t.match(
    /Sale Declined\s+(\d+)\s+([\d.]+)\s+[A-Z]{3}\s+([\d,.()]+)/i,
  );
  if (saleDeclinedMatch) {
    out.saleDeclinedCount = parseInt(saleDeclinedMatch[1], 10);
    out.saleDeclinedRate = parseFloat(saleDeclinedMatch[2]);
    out.saleDeclinedAmount = parseNum(saleDeclinedMatch[3]);
  }
  // "Refund Approved 6 0.55 USD (3.30)"
  const refundFeeMatch = t.match(
    /Refund Approved\s+(\d+)\s+([\d.]+)\s+[A-Z]{3}\s+([\d,.()]+)/i,
  );
  if (refundFeeMatch) {
    out.refundFeeRate = parseFloat(refundFeeMatch[2]);
    out.refundFeeAmount = parseNum(refundFeeMatch[3]);
  }
  // "Chargeback 10 USD (337.35)" — pas de rate dans le statement (forfaitaire)
  const cbFeeMatch = t.match(
    /Chargeback\s+(\d+)\s+[A-Z]{3}\s+([\d,.()]+)/i,
  );
  if (cbFeeMatch) {
    out.chargebackFeeAmount = parseNum(cbFeeMatch[2]);
  }

  // --- Reserves ---
  // "Withheld Rolling Reserve 15 Nov 2026 10.00 (6,399.16)"
  const withheldMatch = t.match(
    /Withheld Rolling Reserve\s+[\d\s\w]+?\s+([\d.]+)\s+\(([\d,.()]+)\)/i,
  );
  if (withheldMatch) {
    out.withheldReservePercent = parseFloat(withheldMatch[1]);
    out.withheldReserveAmount = parseNum(withheldMatch[2]);
  }
  // "Released Rolling Reserve from ... 17 May 2026 10.00 483.23"
  // Le dernier nombre de la ligne (positif, hors parenthèses).
  const releasedMatch = t.match(
    /Released Rolling Reserve[^\n]*?([\d,]+\.\d{2})\s*$/im,
  );
  if (releasedMatch) {
    out.releasedReserveAmount = parseNum(releasedMatch[1]);
  }

  return out;
}
