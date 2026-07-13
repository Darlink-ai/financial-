import type { Invoice } from "./types";

export type ParsedSheet = {
  headers: string[];
  rows: (string | number | null)[][];
};

export type MatchResult = {
  rowIndex: number; // 0-based in rows[]
  invoice: Invoice;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  /** Montant lu dans la ligne Excel — source de vérité (relevé bancaire). */
  excelAmount: number | null;
  /** Date de comptabilisation / valuta lue dans la ligne Excel. */
  excelDate: string | null;
  /** Texte concaténé de toutes les cellules string de la row Excel — sert
   *  à extraire côté UI le nom du créditeur bancaire pour comparaison avec
   *  le créditeur PDF (avec alias Brevo/Sendinblue, Meta/Facebook, etc.). */
  excelRowText?: string;
};

/** True si la chaîne ne doit PAS être incluse dans le "excelRowText"
 *  utilisé pour identifier le créditeur. Filtre :
 *   - dates/heures/timestamps ISO
 *   - codes devise 3 lettres (EUR, USD, CHF, GBP…)
 *   - identifiants de transaction (long alphanumérique mixte sans espace)
 *   - fragments numériques isolés
 *
 * L'objectif : ne garder que les chaînes qui ressemblent à un vrai nom
 * de contrepartie (créditeur/débiteur bancaire). Sinon on se retrouve
 * avec "EUR 9930588BN9051844 LE MANHATTAN SA" que le LLM peut mal
 * interpréter. */
function shouldSkipForVendor(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return true;
  // ISO date/datetime
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}[\d:.Z]*)?$/.test(trimmed)) return true;
  // Heure seule
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return true;
  // Fragments date/année
  if (/^\d{4}-\d{1,2}$/.test(trimmed)) return true;
  if (/^\d{4}$/.test(trimmed)) return true;
  // Codes devise 3 lettres uppercase (EUR, USD, CHF, GBP…)
  if (/^[A-Z]{3}$/.test(trimmed)) return true;
  // Identifiants de transaction : ≥12 chars, majoritairement alphanumériques
  // sans espace (ex: "9930588BN9051844"). Regex : que des lettres/chiffres,
  // au moins un chiffre ET au moins une lettre (pour éviter de filtrer des
  // vrais noms courts).
  if (
    trimmed.length >= 12 &&
    /^[A-Za-z0-9]+$/.test(trimmed) &&
    /\d/.test(trimmed) &&
    /[A-Za-z]/.test(trimmed)
  )
    return true;
  // Nombre pur ou avec ; (ex ";000")
  if (/^[\d;.,\s]+$/.test(trimmed)) return true;
  return false;
}

/**
 * Extrait le texte "utile" d'une row Excel pour identifier le créditeur.
 * Cible EN PRIORITÉ la colonne créditeur détectée par detectColumns
 * (idxCreditor). Si non détectée, concatène les cellules string en
 * EXCLUANT les dates/heures/timestamps.
 *
 * Avant, on concaténait tout → on se retrouvait avec
 * "2026-05-24T00:00:00.000Z 10:48:36 2026-0 ..." parce que la banque
 * stringifie ses dates.
 */
function rowStringText(
  row: (string | number | null)[],
  idxCreditor?: number,
): string {
  // 1. Si on connaît la colonne créditeur, on la prend en priorité.
  if (idxCreditor != null && idxCreditor >= 0) {
    const cell = row[idxCreditor];
    if (typeof cell === "string" && cell.trim() && !shouldSkipForVendor(cell)) {
      return cell.trim();
    }
  }
  // 2. Fallback : concat les cellules string qui ne sont ni vides ni des
  //    dates/heures/currencies/IDs. On rank aussi par "corporate suffix"
  //    présent (SA, AG, GMBH, SARL, Inc, Ltd) pour prioriser ce qui
  //    ressemble le plus à un nom d'entreprise.
  const CORPORATE_SUFFIXES =
    /\b(SA|AG|GMBH|GmbH|SARL|SAS|SASU|Inc|Ltd|LLC|Corp|Co|BV|OY|SPA|SRL|PLC|PBC)\b/i;
  const kept = row
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((s) => s && !shouldSkipForVendor(s));
  // Prefer cells with corporate suffix — les mettre en premier.
  kept.sort((a, b) => {
    const aHit = CORPORATE_SUFFIXES.test(a) ? 1 : 0;
    const bHit = CORPORATE_SUFFIXES.test(b) ? 1 : 0;
    return bHit - aHit;
  });
  return kept.join(" ");
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/'/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // dd.mm.yy or dd.mm.yyyy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? "19" : "20") + y;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Détecte les vraies colonnes (créditeur / montant / date / code) dans
 * un fichier Excel qui peut avoir des lignes de préambule (numéro de
 * compte, etc.) AVANT le vrai en-tête.
 *
 * Stratégie : on examine sheet.headers (row 0) puis les 15 premières
 * lignes de data. On prend la ligne qui matche le plus de keywords.
 * Tout ce qui est avant cette ligne est considéré comme préambule
 * et ignoré lors du matching.
 */
export function detectColumns(sheet: ParsedSheet): {
  idxCreditor: number;
  idxAmount: number;
  idxDate: number;
  idxCode: number;
  /** Colonne Débit dédiée si le fichier en sépare une (sinon -1). */
  idxDebit: number;
  /** Colonne Crédit dédiée si le fichier en sépare une (sinon -1). */
  idxCredit: number;
  dataStartRow: number;
} {
  type Candidates = {
    creditor: string[];
    amount: string[];
    date: string[];
    code: string[];
  };
  const KW: Candidates = {
    creditor: [
      // FR comptable
      "creditor", "fournisseur", "creditrice", "creanc", "vendor", "nom",
      "libelle", "libellé", "description", "denomination", "denominat",
      "transaction", "objet", "details", "détails",
      // FR / UBS bancaire
      "texte", "designation", "désignation", "communication", "memo",
      "mémo", "raison", "motif", "reference", "référence",
      "contrepartie", "beneficiaire", "bénéficiaire", "partenaire",
      "debiteur", "débiteur", "donneur", "ordre",
      // DE / Suisse alémanique
      "buchungstext", "verwendungszweck", "bezeichnung", "text",
      "gegenpartei", "empfanger", "empfänger", "auftraggeber",
      // EN
      "purpose", "remittance", "counterparty", "payee", "payer",
      "beneficiary", "merchant",
    ],
    amount: [
      "montant", "amount", "ttc", "total", "debit", "débit", "credit",
      "crédit", "betrag", "valeur", "somme", "sortie", "entree", "entrée",
    ],
    date: [
      "date", "facture", "valuta", "comptabilis", "operation", "opération",
      "buchung", "execution", "exécution",
    ],
    code: ["code", "compte", "categorie", "catégorie"],
  };

  // Mots dédiés pour distinguer Débit / Crédit quand les deux sont des
  // colonnes séparées (cas UBS). Après norm() on n'a plus de diacritiques,
  // donc "débit" et "debit" sont fusionnés.
  const DEBIT_KW = ["debit", "sortie", "soll"];
  const CREDIT_KW = ["credit", "entree", "haben"];

  function scanRow(row: (string | number | null)[]) {
    const cells = row.map((c) => norm(String(c ?? "")));
    const find = (alts: string[], skipDate = true) =>
      cells.findIndex((c) => {
        if (!c) return false;
        if (skipDate && c.startsWith("date")) return false;
        return alts.some((a) => c.includes(a));
      });
    // Comme find, mais retourne TOUS les indices qui matchent. Sert pour
    // creditor où un fichier peut avoir "Description" (heures) ET
    // "Description1" (vrais noms) — on veut ensuite scorer par contenu.
    const findAll = (alts: string[], skipDate = true) => {
      const out: number[] = [];
      cells.forEach((c, i) => {
        if (!c) return;
        if (skipDate && c.startsWith("date")) return;
        if (alts.some((a) => c.includes(a))) out.push(i);
      });
      return out;
    };
    const findStrict = (alts: string[]) =>
      cells.findIndex((c) => {
        if (!c) return false;
        return alts.some((a) => c.startsWith(a));
      });
    return {
      creditor: find(KW.creditor),
      creditorCandidates: findAll(KW.creditor),
      amount: find(KW.amount),
      date: find(KW.date, false),
      code: find(KW.code),
      debit: findStrict(DEBIT_KW),
      credit: findStrict(CREDIT_KW),
    };
  }
  function scoreOf(s: { creditor: number; amount: number; date: number }) {
    return (
      (s.creditor >= 0 ? 1 : 0) +
      (s.amount >= 0 ? 1 : 0) +
      (s.date >= 0 ? 1 : 0)
    );
  }

  /**
   * Score une colonne par son CONTENU sur les 30 premières lignes de data.
   * Sert à départager plusieurs colonnes matchant le keyword "description"
   * — ex. Description = heures, Description1 = vrais noms.
   * Points :
   *   +3 : contient un suffixe corporate (SA, AG, GMBH, LTD, INC, LLC…)
   *   +1 : chaîne longue (>= 8 chars) avec des lettres — vrai texte
   *   -2 : ressemble à une date/heure/ID (via shouldSkipForVendor)
   *   -1 : vide
   * Retourne le score total.
   */
  function scoreColumnContent(colIdx: number, startRow: number): number {
    if (colIdx < 0) return -Infinity;
    const CORPORATE = /\b(SA|AG|GMBH|GmbH|SARL|SAS|SASU|Inc|Ltd|LLC|Corp|Co|BV|OY|SPA|SRL|PLC|PBC|LIMITED|LLP)\b/i;
    let score = 0;
    const sampleEnd = Math.min(startRow + 30, sheet.rows.length);
    let sampled = 0;
    for (let r = startRow; r < sampleEnd; r++) {
      const cell = sheet.rows[r]?.[colIdx];
      if (cell == null || cell === "") {
        score -= 1;
        continue;
      }
      const s = String(cell).trim();
      if (!s) {
        score -= 1;
        continue;
      }
      sampled++;
      if (shouldSkipForVendor(s)) {
        score -= 2;
        continue;
      }
      if (CORPORATE.test(s)) score += 3;
      if (s.length >= 8 && /[A-Za-z]/.test(s)) score += 1;
    }
    return sampled === 0 ? -Infinity : score;
  }

  // Candidat 1 : sheet.headers (row 0 du fichier)
  const fromHeaders = scanRow(sheet.headers as unknown as (string | number | null)[]);
  let best = {
    ...fromHeaders,
    score: scoreOf(fromHeaders),
    dataStartRow: 0,
  };

  // Candidat 2..N : les 15 premières lignes de data
  const limit = Math.min(15, sheet.rows.length);
  for (let i = 0; i < limit; i++) {
    const sc = scanRow(sheet.rows[i]);
    const score = scoreOf(sc);
    if (score > best.score) {
      best = { ...sc, score, dataStartRow: i + 1 };
    }
  }

  // Si plusieurs colonnes matchent le keyword créditeur, on choisit celle
  // dont le CONTENU ressemble le plus à des noms d'entreprise (via
  // scoreColumnContent). Cas typique : "Description" contient l'heure,
  // "Description1" contient le vrai débiteur — les 2 matchent "description"
  // mais seule Description1 a des noms.
  let idxCreditorFinal = best.creditor;
  if (best.creditorCandidates.length > 1) {
    let bestContentScore = -Infinity;
    for (const col of best.creditorCandidates) {
      const s = scoreColumnContent(col, best.dataStartRow);
      if (s > bestContentScore) {
        bestContentScore = s;
        idxCreditorFinal = col;
      }
    }
  }

  return {
    idxCreditor: idxCreditorFinal,
    idxAmount: best.amount,
    idxDate: best.date,
    idxCode: best.code,
    idxDebit: best.debit,
    idxCredit: best.credit,
    dataStartRow: best.dataStartRow,
  };
}

/**
 * Calcule les totaux du fichier de rapprochement : somme des débits
 * (dépenses) et somme des crédits (entrées d'argent).
 *
 * Logique :
 * 1. Si le fichier sépare Débit et Crédit en 2 colonnes (cas UBS standard) :
 *    on somme la colonne Débit (toutes les valeurs positives) pour les
 *    dépenses, la colonne Crédit pour les entrées. Cas privilégié.
 * 2. Sinon, on lit la colonne "Montant" générique :
 *    - Si son header contient "débit" / "sortie" → toutes les valeurs > 0
 *      sont des débits.
 *    - Sinon (colonne signée) → < 0 = débit, > 0 = crédit.
 *
 * Le tableau `rowDebits` donne ligne par ligne le débit (positif) ou
 * 0 — utile pour ventiler par code comptable côté UI en croisant avec
 * les factures matchées.
 */
export function computeExpenseTotal(sheet: ParsedSheet): {
  totalDebit: number;
  totalCredit: number;
  debitRowCount: number;
  creditRowCount: number;
  rowDebits: number[]; // longueur = sheet.rows.length, 0 pour les rows non-debit
} {
  const { idxAmount, idxDebit, idxCredit, dataStartRow } = detectColumns(sheet);
  const rowDebits: number[] = new Array(sheet.rows.length).fill(0);

  let totalDebit = 0;
  let totalCredit = 0;
  let debitRowCount = 0;
  let creditRowCount = 0;

  // Cas 1 : colonnes Débit ET/OU Crédit dédiées.
  // Dans ces colonnes, la sémantique est implicite (toute valeur = sortie
  // ou entrée d'argent), donc le signe ne porte aucune info — UBS exporte
  // souvent les débits en négatif. On somme la valeur absolue.
  if (idxDebit >= 0 || idxCredit >= 0) {
    for (let i = dataStartRow; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      if (idxDebit >= 0) {
        const v = parseAmount(row[idxDebit]);
        if (v != null && v !== 0) {
          const abs = Math.abs(v);
          totalDebit += abs;
          debitRowCount += 1;
          rowDebits[i] = abs;
        }
      }
      if (idxCredit >= 0) {
        const v = parseAmount(row[idxCredit]);
        if (v != null && v !== 0) {
          totalCredit += Math.abs(v);
          creditRowCount += 1;
        }
      }
    }
    return { totalDebit, totalCredit, debitRowCount, creditRowCount, rowDebits };
  }

  // Cas 2 : colonne "Montant" générique.
  if (idxAmount < 0) {
    return {
      totalDebit: 0,
      totalCredit: 0,
      debitRowCount: 0,
      creditRowCount: 0,
      rowDebits,
    };
  }

  // Lit la VRAIE ligne d'en-tête (peut être > 0 si préambule UBS), pas
  // sheet.headers (qui correspond à la row 0 du fichier).
  const headerRow =
    dataStartRow > 0
      ? sheet.rows[dataStartRow - 1] ?? sheet.headers
      : sheet.headers;
  const header = norm(String(headerRow[idxAmount] ?? ""));
  const isPureDebitColumn =
    header.includes("debit") ||
    header.includes("débit") ||
    header.includes("sortie");

  for (let i = dataStartRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const v = parseAmount(row[idxAmount]);
    if (v == null) continue;
    if (isPureDebitColumn) {
      if (v > 0) {
        totalDebit += v;
        debitRowCount += 1;
        rowDebits[i] = v;
      }
    } else {
      if (v < 0) {
        totalDebit += -v;
        debitRowCount += 1;
        rowDebits[i] = -v;
      } else if (v > 0) {
        totalCredit += v;
        creditRowCount += 1;
      }
    }
  }

  return { totalDebit, totalCredit, debitRowCount, creditRowCount, rowDebits };
}

type CreditLine = {
  rowIndex: number;
  amount: number;
  description: string;
  date: string | null;
};

/**
 * Liste TOUTES les lignes crédit (entrée d'argent) d'une sheet avec leur
 * description complète (toutes les cellules string concaténées). Utile
 * pour debug : quand le pattern utilisateur ne match rien, on montre
 * les top crédits pour aider à trouver le bon mot.
 */
export function listAllCredits(sheet: ParsedSheet): CreditLine[] {
  const { idxCredit, idxAmount, idxCreditor, idxDate, dataStartRow } =
    detectColumns(sheet);

  const rowAsText = (row: (string | number | null)[]) =>
    row
      .map((c) => (typeof c === "string" ? c : ""))
      .filter(Boolean)
      .join(" · ");

  const out: CreditLine[] = [];
  for (let i = dataStartRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    let amount = 0;
    if (idxCredit >= 0) {
      const v = parseAmount(row[idxCredit]);
      if (v != null && v !== 0) amount = Math.abs(v);
    } else if (idxAmount >= 0) {
      const v = parseAmount(row[idxAmount]);
      if (v != null && v > 0) amount = v;
    }
    if (amount <= 0) continue;
    const description =
      idxCreditor >= 0
        ? String(row[idxCreditor] ?? "")
        : rowAsText(row);
    const date =
      idxDate >= 0
        ? parseDate(row[idxDate]) ?? String(row[idxDate] ?? "")
        : null;
    out.push({
      rowIndex: i,
      amount,
      description: description.trim() || rowAsText(row),
      date: date || null,
    });
  }
  return out;
}

/**
 * Détecte les transferts inter-comptes (genre EUR → CHF). Un transfert
 * apparaît :
 *   - Comme DÉBIT dans le compte source (montant > minAmount)
 *   - Comme CRÉDIT dans un AUTRE compte (montant matchant à ±tol% après
 *     conversion FX, date à ±dateWindow jours)
 *
 * Ces opérations doublent le montant des dépenses si on les compte (le
 * débit n'est pas une vraie sortie d'argent, juste un déplacement entre
 * comptes du même propriétaire).
 *
 * fxRateFor(from, to, date) : doit renvoyer le taux 1 unité from → to.
 * Pour notre cas, on passe getFxRate(month, from, to) — la date n'est
 * actuellement pas utilisée mais on garde l'argument pour évolution.
 */
export type DetectedTransfer = {
  debit: {
    currency: "USD" | "EUR" | "CHF";
    rowIndex: number;
    amount: number;
    date: string | null;
    description: string;
  };
  credit: {
    currency: "USD" | "EUR" | "CHF";
    rowIndex: number;
    amount: number;
    date: string | null;
    description: string;
  };
  /** Différence relative entre le montant débité et le crédit attendu (FX). */
  amountDiffPct: number;
  /** Écart en jours entre la date du débit et celle du crédit. */
  daysDiff: number | null;
};

export function detectInterAccountTransfers(
  sheetsByCurrency: Partial<
    Record<"USD" | "EUR" | "CHF", ParsedSheet | null | undefined>
  >,
  fxRateFor: (
    from: "USD" | "EUR" | "CHF",
    to: "USD" | "EUR" | "CHF",
    isoDate: string | null,
  ) => number,
  options: {
    minAmount?: number;
    amountTolerance?: number; // 0-1, ex 0.05 pour ±5%
    dateWindowDays?: number;
  } = {},
): DetectedTransfer[] {
  const minAmount = options.minAmount ?? 4000;
  const tol = options.amountTolerance ?? 0.05;
  const dateWindow = options.dateWindowDays ?? 7;

  type LineRef = {
    currency: "USD" | "EUR" | "CHF";
    rowIndex: number;
    amount: number;
    date: string | null;
    description: string;
  };

  // Collecte des débits > minAmount par devise.
  const bigDebits: LineRef[] = [];
  // Tous les crédits (peu importe le montant — peut être inférieur au seuil
  // à cause des frais bancaires).
  const allCredits: LineRef[] = [];

  for (const cur of ["USD", "EUR", "CHF"] as const) {
    const sheet = sheetsByCurrency[cur];
    if (!sheet) continue;
    const { rowDebits } = computeExpenseTotal(sheet);
    const { idxCreditor, idxDate, dataStartRow } = detectColumns(sheet);
    for (let i = dataStartRow; i < sheet.rows.length; i++) {
      const debitAmt = rowDebits[i];
      if (debitAmt >= minAmount) {
        const row = sheet.rows[i];
        const description =
          idxCreditor >= 0 ? String(row[idxCreditor] ?? "") : "";
        const date =
          idxDate >= 0 ? parseDate(row[idxDate]) ?? String(row[idxDate] ?? "") : null;
        bigDebits.push({
          currency: cur,
          rowIndex: i,
          amount: debitAmt,
          date: date || null,
          description: description.trim(),
        });
      }
    }
    for (const c of listAllCredits(sheet)) {
      allCredits.push({
        currency: cur,
        rowIndex: c.rowIndex,
        amount: c.amount,
        date: c.date,
        description: c.description,
      });
    }
  }

  // Matching : pour chaque gros débit, trouver le meilleur crédit dans une
  // AUTRE devise qui correspond.
  const usedCreditKeys = new Set<string>();
  const transfers: DetectedTransfer[] = [];
  for (const debit of bigDebits) {
    let best: { credit: LineRef; diffPct: number; daysDiff: number | null } | null =
      null;
    for (const credit of allCredits) {
      if (credit.currency === debit.currency) continue; // doit être un autre compte
      const creditKey = `${credit.currency}:${credit.rowIndex}`;
      if (usedCreditKeys.has(creditKey)) continue;

      // Convertit le crédit dans la devise du débit pour comparer.
      const rate = fxRateFor(credit.currency, debit.currency, credit.date);
      const expected = credit.amount * rate;
      if (expected <= 0) continue;
      const diffPct = Math.abs(debit.amount - expected) / debit.amount;
      if (diffPct > tol) continue;

      // Check date si dispo.
      let daysDiff: number | null = null;
      if (debit.date && credit.date) {
        const a = new Date(debit.date).getTime();
        const b = new Date(credit.date).getTime();
        if (Number.isFinite(a) && Number.isFinite(b)) {
          daysDiff = Math.abs(a - b) / 86_400_000;
          if (daysDiff > dateWindow) continue;
        }
      }

      // Préfère le match avec le plus petit diff %.
      if (!best || diffPct < best.diffPct) {
        best = { credit, diffPct, daysDiff };
      }
    }

    if (best) {
      transfers.push({
        debit,
        credit: best.credit,
        amountDiffPct: best.diffPct,
        daysDiff: best.daysDiff,
      });
      usedCreditKeys.add(`${best.credit.currency}:${best.credit.rowIndex}`);
    }
  }

  return transfers;
}

/**
 * Trouve toutes les lignes CRÉDIT (entrée d'argent) dont la description
 * contient l'un des patterns donnés (case-insensitive, normalisé).
 *
 * Sert à identifier les virements reçus d'un processeur de paiement (EMP,
 * Centrobill…) dans un Excel de rapprochement bancaire. Retourne la somme
 * + le détail des lignes matchées pour affichage côté UI.
 *
 * Quand `matches` est vide, l'appelant peut afficher `allCredits` pour
 * aider l'utilisateur à trouver le bon mot-clé.
 */
export function sumCreditsMatching(
  sheet: ParsedSheet,
  patterns: string[],
): {
  total: number;
  matches: CreditLine[];
  allCredits: CreditLine[];
} {
  const allCredits = listAllCredits(sheet);
  const normPatterns = patterns
    .map((p) => norm(p))
    .filter((p) => p.length > 0);
  if (normPatterns.length === 0) {
    return { total: 0, matches: [], allCredits };
  }
  const matches = allCredits.filter((c) => {
    const d = norm(c.description);
    return normPatterns.some((p) => d.includes(p));
  });
  const total =
    Math.round(matches.reduce((s, m) => s + m.amount, 0) * 100) / 100;
  return { total, matches, allCredits };
}

/**
 * RÈGLE DE MATCHING (simplifiée depuis juillet 2026, cf. demande user) :
 * on considère qu'il y a match SI ET SEULEMENT SI :
 *   1. Le montant Excel est à ±20% du montant facture
 *   2. La date Excel est à ±2 jours de la date facture
 *
 * Si les deux critères sont satisfaits → match. Sinon → pas de proposition,
 * tri manuel.
 *
 * En cas de plusieurs candidats respectant les 2 critères, on retient celui
 * dont la déviation combinée (%|amount| + %|date|) est la plus faible.
 *
 * Créditeur / folder code ne rentrent PLUS dans le scoring — l'utilisateur
 * a explicitement demandé de s'en tenir à ces 2 critères objectifs.
 */
const AMOUNT_TOLERANCE = 0.2; // ±20% (strict)
const DATE_TOLERANCE_DAYS = 2; // ±2 jours (strict)
const AMOUNT_TOLERANCE_LOOSE = 0.4; // ±40% (fallback pour otherCandidates)
const DATE_TOLERANCE_DAYS_LOOSE = 5; // ±5 jours (fallback)

function isStrictMatch(
  inv: Invoice,
  rowAmount: number | null,
  rowDate: string | null,
  opts?: { loose?: boolean },
): { ok: false } | { ok: true; amountRel: number; dateDiffDays: number } {
  if (inv.amount == null || rowAmount == null) return { ok: false };
  if (!inv.invoiceDate || !rowDate) return { ok: false };
  const absRow = Math.abs(rowAmount);
  const rel =
    Math.abs(inv.amount - absRow) / Math.max(inv.amount, absRow);
  const amountTol = opts?.loose ? AMOUNT_TOLERANCE_LOOSE : AMOUNT_TOLERANCE;
  if (rel > amountTol) return { ok: false };
  const diffDays = Math.abs(
    (new Date(inv.invoiceDate).getTime() - new Date(rowDate).getTime()) /
      86_400_000,
  );
  const dateTol = opts?.loose
    ? DATE_TOLERANCE_DAYS_LOOSE
    : DATE_TOLERANCE_DAYS;
  if (diffDays > dateTol) return { ok: false };
  return { ok: true, amountRel: rel, dateDiffDays: diffDays };
}

export function matchInvoicesAgainstSheet(
  sheet: ParsedSheet,
  invoices: Invoice[],
  opts?: {
    /** Set des n° de ligne Excel humains (1-based) déjà revendiqués par
     *  d'autres factures — skip pour éviter les collisions. */
    excludeRowIndices?: Set<number>;
    /** Si true, retourne TOUS les candidats valides pour chaque facture
     *  (triés par déviation croissante), pas juste le meilleur. Utile
     *  pour l'itération créditeur côté auto-process. */
    returnAllCandidates?: boolean;
    /** Si true, utilise les tolérances larges (±40% montant, ±5j date)
     *  au lieu des strictes (±20% / ±2j). Sert à peupler otherCandidates
     *  avec plus d'options quand le LLM refuse le nom du strict. */
    loose?: boolean;
  },
): MatchResult[] {
  const { idxCreditor, idxAmount, idxDate, dataStartRow } =
    detectColumns(sheet);
  const excludeRows = opts?.excludeRowIndices ?? new Set<number>();
  const results: MatchResult[] = [];

  for (const inv of invoices) {
    const candidates: {
      combinedDev: number;
      result: MatchResult;
    }[] = [];

    sheet.rows.forEach((row, rowIndex) => {
      if (rowIndex < dataStartRow) return;
      if (excludeRows.has(rowIndex + 2)) return;

      const rowAmount = idxAmount >= 0 ? parseAmount(row[idxAmount]) : null;
      const rowDate = idxDate >= 0 ? parseDate(row[idxDate]) : null;

      const check = isStrictMatch(inv, rowAmount, rowDate, {
        loose: opts?.loose,
      });
      if (!check.ok) return;

      // Déviation combinée : plus c'est bas, plus le match est précis.
      // On normalise date/2j sur [0,1] pour rester dans la même échelle
      // que amountRel [0,0.2].
      const combinedDev = check.amountRel + check.dateDiffDays / 10;

      const candidate: MatchResult = {
        rowIndex,
        invoice: inv,
        confidence:
          check.amountRel < 0.05 && check.dateDiffDays === 0
            ? "high"
            : check.amountRel < 0.15
              ? "medium"
              : "low",
        reasons: [
          `montant ±${(check.amountRel * 100).toFixed(1)}%`,
          `date à ±${check.dateDiffDays.toFixed(0)}j`,
        ],
        excelAmount: rowAmount,
        excelDate: rowDate,
        excelRowText: rowStringText(row, idxCreditor),
      };
      candidates.push({ combinedDev, result: candidate });
    });

    candidates.sort((a, b) => a.combinedDev - b.combinedDev);
    if (opts?.returnAllCandidates) {
      results.push(...candidates.map((c) => c.result));
    } else if (candidates.length > 0) {
      results.push(candidates[0].result);
    }
  }

  return results;
}

/**
 * Variante de matchInvoicesAgainstSheet qui retourne la MEILLEURE
 * candidate même si en dessous du seuil. Utilisé pour expliquer à
 * l'utilisateur pourquoi son match a échoué.
 */
export function findBestCandidate(
  sheet: ParsedSheet,
  inv: Invoice,
  opts?: { excludeRowIndices?: Set<number> },
): { result: MatchResult; score: number } | null {
  // Diagnostic uniquement : renvoie la ligne la PLUS PROCHE en combinant
  // écart montant + écart date, MÊME si en dehors des tolérances strictes.
  // Sert à afficher à l'utilisateur "closest thing was line X with 30%
  // amount diff, 5j date diff" quand aucun match strict n'a été trouvé.
  const { idxCreditor, idxAmount, idxDate, dataStartRow } =
    detectColumns(sheet);
  const excludeRows = opts?.excludeRowIndices ?? new Set<number>();
  let best: { result: MatchResult; score: number } | null = null;

  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex < dataStartRow) return;
    if (excludeRows.has(rowIndex + 2)) return;

    const rowAmount = idxAmount >= 0 ? parseAmount(row[idxAmount]) : null;
    const rowDate = idxDate >= 0 ? parseDate(row[idxDate]) : null;
    if (inv.amount == null || rowAmount == null) return;
    if (!inv.invoiceDate || !rowDate) return;

    const absRow = Math.abs(rowAmount);
    const rel = Math.abs(inv.amount - absRow) / Math.max(inv.amount, absRow);
    const diffDays = Math.abs(
      (new Date(inv.invoiceDate).getTime() - new Date(rowDate).getTime()) /
        86_400_000,
    );
    // Score = 1 / (1 + combinedDev) → plus élevé = plus proche.
    const combinedDev = rel + diffDays / 10;
    const score = 1 / (1 + combinedDev);

    if (!best || score > best.score) {
      best = {
        score,
        result: {
          rowIndex,
          invoice: inv,
          confidence: "low",
          reasons: [
            `montant ${(rel * 100).toFixed(0)}%`,
            `date ±${diffDays.toFixed(0)}j`,
          ],
          excelAmount: rowAmount,
          excelDate: rowDate,
          excelRowText: rowStringText(row, idxCreditor),
        },
      };
    }
  });

  return best;
}

/**
 * Tokenise un nom de créancier pour matcher de manière fuzzy.
 * "DigitalOcean Support" → ["digitalocean"]
 * "Deep Infra Inc." → ["deep", "infra"]
 * Filtre les tokens < 4 chars + les suffixes corporate.
 */
const CORPORATE_STOPWORDS = new Set([
  "inc", "ltd", "llc", "gmbh", "corp", "corporation", "ag", "sa",
  "sarl", "limited", "company", "co", "support", "billing", "payments",
  "payment", "team", "the",
]);

function creditorTokens(creditor: string | null): string[] {
  if (!creditor) return [];
  const tokens = norm(creditor)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  return tokens.filter(
    (t) => t.length >= 4 && !CORPORATE_STOPWORDS.has(t),
  );
}
