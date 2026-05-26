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

  function scanRow(row: (string | number | null)[]) {
    const cells = row.map((c) => norm(String(c ?? "")));
    const find = (alts: string[]) =>
      cells.findIndex((c) => c && alts.some((a) => c.includes(a)));
    return {
      creditor: find(KW.creditor),
      amount: find(KW.amount),
      date: find(KW.date),
      code: find(KW.code),
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
    dataStartRow: best.dataStartRow,
  };
}

/**
 * Calcule les totaux du fichier de rapprochement : somme des débits
 * (dépenses) et somme des crédits (entrées d'argent).
 *
 * Heuristique :
 * - Si la colonne montant détectée est explicitement nommée "Débit" /
 *   "Sortie", tous les nombres > 0 dans cette colonne sont des débits.
 * - Sinon (colonne "Montant" mixte), les nombres < 0 sont des débits
 *   (en valeur absolue), les > 0 sont des crédits.
 *
 * Pour un fichier UBS séparant "Débit" et "Crédit" en 2 colonnes,
 * detectColumns prend la 1ère matchée (souvent "Débit") — on reste
 * cohérent en sommant cette unique colonne.
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
  const { idxAmount, dataStartRow } = detectColumns(sheet);
  const rowDebits: number[] = new Array(sheet.rows.length).fill(0);
  if (idxAmount < 0) {
    return {
      totalDebit: 0,
      totalCredit: 0,
      debitRowCount: 0,
      creditRowCount: 0,
      rowDebits,
    };
  }

  // Détecte si la colonne est sémantiquement "Débit pur" (toutes les
  // valeurs positives sont des sorties) ou "Montant signé".
  const header = norm(String(sheet.headers[idxAmount] ?? ""));
  const isPureDebitColumn =
    header.includes("debit") ||
    header.includes("débit") ||
    header.includes("sortie");

  let totalDebit = 0;
  let totalCredit = 0;
  let debitRowCount = 0;
  let creditRowCount = 0;

  for (let i = dataStartRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const v = parseAmount(row[idxAmount]);
    if (v == null) continue;
    if (isPureDebitColumn) {
      // Tous les nombres > 0 sont des débits dans une colonne "Débit pur".
      if (v > 0) {
        totalDebit += v;
        debitRowCount += 1;
        rowDebits[i] = v;
      }
    } else {
      // Colonne montant signée : négatif = débit, positif = crédit.
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

export function matchInvoicesAgainstSheet(
  sheet: ParsedSheet,
  invoices: Invoice[],
): MatchResult[] {
  const { idxCreditor, idxAmount, idxDate, idxCode, dataStartRow } =
    detectColumns(sheet);

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
): { result: MatchResult; score: number } | null {
  const { idxCreditor, idxAmount, idxDate, idxCode, dataStartRow } =
    detectColumns(sheet);

  const invCreditorTokens = creditorTokens(inv.creditor);
  let best: { result: MatchResult; score: number } | null = null;

  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex < dataStartRow) return;
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
