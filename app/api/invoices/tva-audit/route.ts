import { NextResponse } from "next/server";
import postgres from "postgres";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/invoices/tva-audit?startMonth=2026-01&endMonth=2026-03&auth=<CRON_SECRET>
 *
 * Audit read-only : parcourt toutes les factures VALIDÉES (status='matched'
 * avec excel_row_matched non-null) dont invoice_date tombe dans la fenêtre
 * [startMonth, endMonth]. Pour chacune :
 *   - Décode attachment_b64 (le PDF stocké en DB, source de vérité identique
 *     à celui envoyé sur Drive)
 *   - Extrait le texte brut avec unpdf (pas d'OCR, PDFs scannés = miss)
 *   - Détecte la présence de TVA/VAT/MwSt/IVA
 *   - Essaie d'extraire le taux (7.7%, 8.1%, 20%, 19%…) et le montant TVA
 *
 * PAS DE MODIFICATION Drive/DB : c'est un pur audit lecture. On lit
 * attachment_b64 déjà en DB — pas d'aller-retour Drive.
 *
 * Auth : Bearer CRON_SECRET (URL param ?auth ou header Authorization).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth =
    url.searchParams.get("auth") ??
    (req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startMonth = url.searchParams.get("startMonth"); // YYYY-MM
  const endMonth = url.searchParams.get("endMonth");
  if (!startMonth || !endMonth || !/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return NextResponse.json(
      { error: "bad_params", message: "startMonth et endMonth en YYYY-MM requis." },
      { status: 400 },
    );
  }

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );

  try {
    const rows = await sql<
      {
        id: string;
        creditor: string | null;
        amount: string | null;
        currency: string | null;
        invoice_date: Date | null;
        excel_row_matched: number | null;
        account_currency: string;
        subject: string | null;
        drive_path: string | null;
        final_name: string | null;
        attachment_b64: string | null;
      }[]
    >`
      SELECT id, creditor, amount, currency, invoice_date,
             excel_row_matched, account_currency, subject,
             drive_path, final_name, attachment_b64
      FROM invoices
      WHERE status = 'matched'
        AND excel_row_matched IS NOT NULL
        AND invoice_date IS NOT NULL
        AND to_char(invoice_date, 'YYYY-MM') >= ${startMonth}
        AND to_char(invoice_date, 'YYYY-MM') <= ${endMonth}
      ORDER BY invoice_date ASC, account_currency ASC, excel_row_matched ASC
    `;

    const results: Array<{
      id: string;
      creditor: string | null;
      subject: string | null;
      finalName: string | null;
      drivePath: string | null;
      amount: number | null;
      currency: string | null;
      invoiceDate: string | null;
      accountCurrency: string;
      excelRow: number | null;
      month: string | null;
      hasPdf: boolean;
      pdfError?: string;
      hasTVA: boolean;
      tvaRate: number | null;
      tvaAmount: number | null;
      tvaCurrency: string | null;
      htAmount: number | null;
      ttcAmount: number | null;
      snippets: string[];
    }> = [];

    for (const r of rows) {
      const invoiceDate = r.invoice_date?.toISOString().slice(0, 10) ?? null;
      const month = invoiceDate?.slice(0, 7) ?? null;
      const base = {
        id: r.id,
        creditor: r.creditor,
        subject: r.subject,
        finalName: r.final_name,
        drivePath: r.drive_path,
        amount: r.amount != null ? Number(r.amount) : null,
        currency: r.currency,
        invoiceDate,
        accountCurrency: r.account_currency,
        excelRow: r.excel_row_matched,
        month,
        hasPdf: false,
      };

      if (!r.attachment_b64) {
        results.push({
          ...base,
          pdfError: "no_attachment",
          hasTVA: false,
          tvaRate: null,
          tvaAmount: null,
          tvaCurrency: null,
          htAmount: null,
          ttcAmount: null,
          snippets: [],
        });
        continue;
      }

      let text = "";
      let pdfError: string | undefined;
      try {
        const buf = Buffer.from(r.attachment_b64, "base64");
        const uint8 = new Uint8Array(buf.byteLength);
        uint8.set(buf);
        const doc = await getDocumentProxy(uint8);
        const result = await extractText(doc, { mergePages: true });
        text = result.text ?? "";
      } catch (e) {
        pdfError = (e as Error).message.slice(0, 100);
      }

      const analysis = analyzeTVA(text);
      results.push({
        ...base,
        hasPdf: !pdfError,
        pdfError,
        ...analysis,
      });
    }

    // Agrégats
    const withTVA = results.filter((r) => r.hasTVA);
    const withoutTVA = results.filter((r) => !r.hasTVA && r.hasPdf);
    const failed = results.filter((r) => !r.hasPdf);

    const totalTVAByCurrency: Record<string, number> = {};
    for (const r of withTVA) {
      if (r.tvaAmount != null && r.tvaCurrency) {
        totalTVAByCurrency[r.tvaCurrency] =
          (totalTVAByCurrency[r.tvaCurrency] ?? 0) + r.tvaAmount;
      }
    }
    // Round to 2 decimals
    for (const k of Object.keys(totalTVAByCurrency)) {
      totalTVAByCurrency[k] = Math.round(totalTVAByCurrency[k] * 100) / 100;
    }

    return NextResponse.json({
      ok: true,
      window: { startMonth, endMonth },
      counts: {
        total: results.length,
        withTVA: withTVA.length,
        withoutTVA: withoutTVA.length,
        failed: failed.length,
      },
      totalTVAByCurrency,
      invoices: results,
    });
  } finally {
    await sql.end();
  }
}

/**
 * Analyse le texte d'un PDF pour trouver les indices de TVA.
 *
 * Cherche : mots-clés (TVA/VAT/MwSt/IVA/Sales Tax/GST), taux (7.7%, 8.1%,
 * 20%, 19%, 5%…), et montants associés. Extrait aussi HT (excl. VAT) et
 * TTC (incl. VAT) quand identifiables.
 */
function analyzeTVA(text: string): {
  hasTVA: boolean;
  tvaRate: number | null;
  tvaAmount: number | null;
  tvaCurrency: string | null;
  htAmount: number | null;
  ttcAmount: number | null;
  snippets: string[];
} {
  const snippets: string[] = [];
  if (!text) {
    return {
      hasTVA: false,
      tvaRate: null,
      tvaAmount: null,
      tvaCurrency: null,
      htAmount: null,
      ttcAmount: null,
      snippets,
    };
  }

  // Normalise : supprime NBSP, espaces multiples.
  const norm = text.replace(/ /g, " ").replace(/[ \t]+/g, " ");

  // Regex mot-clés TVA. On garde une fenêtre de 80 char autour de chaque
  // hit pour extraire montant et taux dans la même zone.
  const KW = /(TVA|VAT|MwSt\.?|IVA|Sales\s*Tax|GST|HST|USt\.?)\b/gi;
  const hits: { keyword: string; idx: number; snippet: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = KW.exec(norm)) !== null) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(norm.length, match.index + 80);
    const snippet = norm.slice(start, end).replace(/\s+/g, " ").trim();
    hits.push({ keyword: match[1], idx: match.index, snippet });
    // Cap snippets (pas la peine de garder 100 hits)
    if (hits.length > 20) break;
  }

  if (hits.length === 0) {
    // Fallback : regarde "excl. VAT" / "incl. VAT" / "hors taxes" / "TTC" /
    // "HT" tout seuls même sans TVA/VAT explicites.
    const FALLBACK = /\b(HT|TTC|hors\s*taxes?|incl\.?\s*VAT|excl\.?\s*VAT)\b/i;
    if (!FALLBACK.test(norm)) {
      return {
        hasTVA: false,
        tvaRate: null,
        tvaAmount: null,
        tvaCurrency: null,
        htAmount: null,
        ttcAmount: null,
        snippets,
      };
    }
  }

  // Extraire taux (7.7 / 8.1 / 20 / 19 / 21 / 5 / 5.5…). Cherche un %
  // dans un rayon proche d'un mot-clé.
  const RATE_RE = /(\d{1,2}([.,]\d{1,2})?)\s*%/g;
  const rates: number[] = [];
  for (const h of hits) {
    const zone = norm.slice(
      Math.max(0, h.idx - 60),
      Math.min(norm.length, h.idx + 100),
    );
    let rm: RegExpExecArray | null;
    RATE_RE.lastIndex = 0;
    while ((rm = RATE_RE.exec(zone)) !== null) {
      const v = parseFloat(rm[1].replace(",", "."));
      if (v > 0 && v <= 30) rates.push(v);
    }
  }
  // Taux principal = le plus fréquent, ou 1er trouvé
  let tvaRate: number | null = null;
  if (rates.length > 0) {
    const freq = new Map<number, number>();
    for (const r of rates) freq.set(r, (freq.get(r) ?? 0) + 1);
    tvaRate = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // Extraire montant TVA : cherche "TVA[^\n]*<nombre><devise?>" ou
  // "<nombre><devise?><any>TVA".
  const AMOUNT_RE =
    /(\d{1,3}(?:[',.\s]\d{3})*(?:[.,]\d{1,2})?)\s*(CHF|EUR|USD|€|\$|Fr\.?)/gi;
  let tvaAmount: number | null = null;
  let tvaCurrency: string | null = null;
  for (const h of hits) {
    // Zone après le mot-clé (plus stricte : 60 chars devant, mais on privilégie
    // le montant qui vient APRES le mot TVA).
    const zone = norm.slice(h.idx, Math.min(norm.length, h.idx + 120));
    AMOUNT_RE.lastIndex = 0;
    const found = AMOUNT_RE.exec(zone);
    if (found) {
      const raw = found[1];
      const cur = normalizeCurrency(found[2]);
      const value = parseNumber(raw);
      if (value != null && value > 0 && value < 1_000_000) {
        tvaAmount = value;
        tvaCurrency = cur;
        break;
      }
    }
  }
  // Fallback : cherche un montant "TVA CHF 12.34" plus loose (nombre 60
  // char avant le mot TVA, montant collé au taux)
  if (tvaAmount == null && hits.length > 0) {
    for (const h of hits) {
      const zone = norm.slice(
        Math.max(0, h.idx - 60),
        Math.min(norm.length, h.idx + 60),
      );
      AMOUNT_RE.lastIndex = 0;
      let am: RegExpExecArray | null;
      const cands: { v: number; cur: string }[] = [];
      while ((am = AMOUNT_RE.exec(zone)) !== null) {
        const v = parseNumber(am[1]);
        const cur = normalizeCurrency(am[2]);
        if (v != null && v > 0 && v < 1_000_000) cands.push({ v, cur });
      }
      if (cands.length > 0) {
        // Prend le plus petit (le TVA est typiquement < HT < TTC)
        cands.sort((a, b) => a.v - b.v);
        tvaAmount = cands[0].v;
        tvaCurrency = cands[0].cur;
        break;
      }
    }
  }

  // HT / TTC (best-effort, souvent absents)
  const HT_RE =
    /(?:total\s*)?(?:HT|hors\s*taxes?|net|subtotal|excl\.?\s*VAT|excl\.?\s*tax)[:\s]+([\d',.\s]+)\s*(CHF|EUR|USD|€|\$)?/i;
  const TTC_RE =
    /(?:total\s*)?(?:TTC|toutes\s*taxes\s*comprises|gross|grand\s*total|incl\.?\s*VAT|incl\.?\s*tax|amount\s*due)[:\s]+([\d',.\s]+)\s*(CHF|EUR|USD|€|\$)?/i;
  const htMatch = norm.match(HT_RE);
  const ttcMatch = norm.match(TTC_RE);
  const htAmount = htMatch ? parseNumber(htMatch[1]) : null;
  const ttcAmount = ttcMatch ? parseNumber(ttcMatch[1]) : null;

  return {
    hasTVA: hits.length > 0 || tvaAmount != null || tvaRate != null,
    tvaRate,
    tvaAmount,
    tvaCurrency,
    htAmount,
    ttcAmount,
    snippets: hits.slice(0, 3).map((h) => h.snippet),
  };
}

function normalizeCurrency(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (s === "€") return "EUR";
  if (s === "$") return "USD";
  if (s.startsWith("FR")) return "CHF";
  return s;
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  // Retire espaces / apostrophes suisses / points de milliers (heuristique :
  // dernier séparateur = décimal). Ex : "1'234.56" → 1234.56 ; "1 234,56" → 1234.56
  let s = raw.trim().replace(/[\s']/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot > lastComma) {
    // décimal = point → virgules = milliers
    s = s.replace(/,/g, "");
  } else if (lastComma > lastDot) {
    // décimal = virgule → points = milliers
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
