/**
 * Restriction d'accès : seuls ces emails exacts sont autorisés à se connecter.
 * Toute autre adresse — même @famelink.ai — est refusée.
 */
export const ALLOWED_EMAILS = [
  "contact@famelink.ai",
  "gauthier.koller@famelink.ai",
  "robin.koller@famelink.ai",
  "investisseurs@famelink.ai",
  "jacqueline@famelink.ai",
];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  return ALLOWED_EMAILS.includes(normalized);
}

/**
 * Nettoie une valeur d'env var :
 * - trim whitespace
 * - retire les guillemets éventuels (si l'utilisateur a collé `"value"`)
 * - retire tout caractère non-ASCII (qui ferait planter le fetch côté
 *   navigateur avec `String contains non ISO-8859-1 code point`)
 */
function clean(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  // Strip n'importe quel char hors ASCII imprimable (0x20-0x7E)
  v = v.replace(/[^\x20-\x7E]/g, "");
  return v;
}

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = clean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
