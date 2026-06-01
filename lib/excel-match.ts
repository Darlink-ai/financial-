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
};

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
      // DE / Suisse alémanique
      "buchungstext", "verwendungszweck", "bezeichnung", "text",
      // EN
      "purpose", "remittance",
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
    // skipDate : ignore les en-têtes qui commencent par "date" pour les
    // catégories non-date. Sinon "Date de transaction" matche "transaction"
    // dans la liste creditor, "Date de valeur" matche "valeur" dans amount,
    // etc. → on choppe par erreur une colonne date pour autre chose.
    const find = (alts: string[], skipDate = true) =>
      cells.findIndex((c) => {
        if (!c) return false;
        if (skipDate && c.startsWith("date")) return false;
        return alts.some((a) => c.includes(a));
      });
    // Pour debit/credit on cherche un startsWith — distingue "debit" de
    // "credit" (aucun des deux n'est préfixe de l'autre) tout en couvrant
    // "Débit", "Débit CHF", "Débit(CHF)", "Débits", etc.
    const findStrict = (alts: string[]) =>
      cells.findIndex((c) => {
        if (!c) return false;
        return alts.some((a) => c.startsWith(a));
      });
    return {
      creditor: find(KW.creditor),
      amount: find(KW.amount),
      date: find(KW.date, false), // on autorise "date" dans le header date
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

  return {
    idxCreditor: best.creditor,
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

export function matchInvoicesAgainstSheet(
  sheet: ParsedSheet,
  invoices: Invoice[],
  opts?: {
    /** Set des n° de ligne Excel humains (1-based, ex. 14) déjà revendiqués
     *  par d'autres factures. Le matcher les SKIP, ce qui permet à 2 factures
     *  du même créditeur/jour (Runpod 28/01 lignes 14 et 15) de tomber chacune
     *  sur sa propre ligne au lieu d'entrer en collision. */
    excludeRowIndices?: Set<number>;
  },
): MatchResult[] {
  const { idxCreditor, idxAmount, idxDate, idxCode, dataStartRow } =
    detectColumns(sheet);

  const excludeRows = opts?.excludeRowIndices ?? new Set<number>();

  const results: MatchResult[] = [];

  // Quand le `name` ne match pas, on cherche le créditeur dans TOUTES
  // les cellules string de la row : les relevés UBS mettent souvent le
  // nom du fournisseur dans une "Description" longue avec d'autres infos.
  function rowAsText(row: (string | number | null)[]): string {
    return row
      .map((c) => (typeof c === "string" ? c : ""))
      .filter(Boolean)
      .join(" ");
  }

  for (const inv of invoices) {
    const invCreditorTokens = creditorTokens(inv.creditor);
    let best: { score: number; result: MatchResult } | null = null;

    sheet.rows.forEach((row, rowIndex) => {
      // Skip les lignes de préambule (numéro de compte, etc.) AVANT
      // la vraie ligne d'en-tête.
      if (rowIndex < dataStartRow) return;

      // Skip les lignes déjà revendiquées par d'autres factures (matched ou
      // drafts /import). Convention : excludeRowIndices contient des N° Excel
      // humains (1-based), et le rowIndex 0-based équivaut au N° Excel
      // rowIndex + 2. Voir `matchedRow = matches[0].rowIndex + 2` dans
      // auto-process pour la même convention.
      if (excludeRows.has(rowIndex + 2)) return;

      const reasons: string[] = [];
      let score = 0;

      const rowCreditor = idxCreditor >= 0 ? norm(row[idxCreditor]) : "";
      const rowAmount = idxAmount >= 0 ? parseAmount(row[idxAmount]) : null;
      const rowDate = idxDate >= 0 ? parseDate(row[idxDate]) : null;
      const rowCode = idxCode >= 0 ? String(row[idxCode] ?? "").trim() : "";

      // ---- Créditeur (tokenisé) ----
      // On cherche n'importe quel token significatif (>= 4 chars, hors
      // suffixes corporate type "inc", "ltd", etc.) dans la cellule
      // créditeur OU dans toute la row text. Beaucoup plus flexible.
      if (invCreditorTokens.length > 0) {
        const haystack = rowCreditor + " " + norm(rowAsText(row));
        const hitTokens = invCreditorTokens.filter((t) => haystack.includes(t));
        if (hitTokens.length > 0) {
          score += 3;
          reasons.push(`créditeur "${hitTokens.join(", ")}"`);
        }
      }

      // ---- Montant ----
      if (inv.amount != null && rowAmount != null) {
        const absRow = Math.abs(rowAmount);
        const diff = Math.abs(inv.amount - absRow);
        const rel = diff / Math.max(inv.amount, absRow);
        if (diff < 0.01) {
          score += 3;
          reasons.push("montant exact");
        } else if (rel < 0.05) {
          score += 2;
          reasons.push("montant ±5%");
        } else if (rel < 0.15) {
          score += 1.3;
          reasons.push("montant ±15% (FX)");
        } else if (rel < 0.25) {
          score += 0.8;
          reasons.push("montant ±25% (FX+frais)");
        }
      }

      // ---- Date (tolérance max ±7 jours — au-delà on considère que
      //         c'est pas la même transaction) ----
      if (inv.invoiceDate && rowDate) {
        const diffDays = Math.abs(
          (new Date(inv.invoiceDate).getTime() - new Date(rowDate).getTime()) /
            86_400_000,
        );
        if (diffDays === 0) {
          score += 2;
          reasons.push("date exacte");
        } else if (diffDays <= 3) {
          score += 1.5;
          reasons.push("date à ±3j");
        } else if (diffDays <= 7) {
          score += 1.2;
          reasons.push("date à ±7j");
        }
        // > 7 jours → 0 point (trop loin pour être la même tx)
      }

      if (inv.folderCode && rowCode && rowCode === inv.folderCode) {
        score += 1;
        reasons.push(`code ${inv.folderCode}`);
      }

      // Seuil 4 → le créditeur seul (3) ne suffit pas mais
      // créditeur + montant proche (4-5) ou créditeur + date (4.5-5)
      // passe. Le créditeur SEUL avec rien d'autre on rejette pour
      // éviter les faux positifs (plusieurs paiements du même
      // fournisseur dans le mois).
      if (score >= 4) {
        const candidate: MatchResult = {
          rowIndex,
          invoice: inv,
          confidence: score >= 6 ? "high" : score >= 5 ? "medium" : "low",
          reasons,
          excelAmount: rowAmount,
          excelDate: rowDate,
        };
        if (!best || score > best.score) {
          best = { score, result: candidate };
        }
      }
    });

    if (best) results.push((best as { score: number; result: MatchResult }).result);
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
  const { idxCreditor, idxAmount, idxDate, idxCode, dataStartRow } =
    detectColumns(sheet);
  const excludeRows = opts?.excludeRowIndices ?? new Set<number>();

  const invCreditorTokens = creditorTokens(inv.creditor);
  let best: { result: MatchResult; score: number } | null = null;

  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex < dataStartRow) return;
    if (excludeRows.has(rowIndex + 2)) return;
    const reasons: string[] = [];
    let score = 0;

    const rowCreditor = idxCreditor >= 0 ? norm(row[idxCreditor]) : "";
    const rowAmount = idxAmount >= 0 ? parseAmount(row[idxAmount]) : null;
    const rowDate = idxDate >= 0 ? parseDate(row[idxDate]) : null;
    const rowCode = idxCode >= 0 ? String(row[idxCode] ?? "").trim() : "";

    if (invCreditorTokens.length > 0) {
      const haystack = rowCreditor + " " +
        norm(row.map((c) => (typeof c === "string" ? c : "")).join(" "));
      const hitTokens = invCreditorTokens.filter((t) => haystack.includes(t));
      if (hitTokens.length > 0) {
        score += 3;
        reasons.push(`créditeur "${hitTokens.join(", ")}"`);
      }
    }
    if (inv.amount != null && rowAmount != null) {
      const absRow = Math.abs(rowAmount);
      const diff = Math.abs(inv.amount - absRow);
      const rel = diff / Math.max(inv.amount, absRow);
      if (diff < 0.01) {
        score += 3;
        reasons.push("montant exact");
      } else if (rel < 0.05) {
        score += 2;
        reasons.push("montant ±5%");
      } else if (rel < 0.15) {
        score += 1.3;
        reasons.push("montant ±15%");
      } else if (rel < 0.25) {
        score += 0.8;
        reasons.push("montant ±25%");
      }
    }
    if (inv.invoiceDate && rowDate) {
      const diffDays = Math.abs(
        (new Date(inv.invoiceDate).getTime() - new Date(rowDate).getTime()) /
          86_400_000,
      );
      if (diffDays === 0) {
        score += 2;
        reasons.push("date exacte");
      } else if (diffDays <= 3) {
        score += 1.5;
        reasons.push("date ±3j");
      } else if (diffDays <= 7) {
        score += 1.2;
        reasons.push("date ±7j");
      }
      // > 7j : 0 point
    }
    if (inv.folderCode && rowCode && rowCode === inv.folderCode) {
      score += 1;
      reasons.push(`code ${inv.folderCode}`);
    }

    if (score > 0 && (!best || score > best.score)) {
      best = {
        score,
        result: {
          rowIndex,
          invoice: inv,
          confidence: score >= 6 ? "high" : score >= 5 ? "medium" : "low",
          reasons,
          excelAmount: rowAmount,
          excelDate: rowDate,
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
