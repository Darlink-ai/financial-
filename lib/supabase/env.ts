/**
 * Restriction d'accès : seuls les emails dont la partie domaine appartient à
 * cette liste sont autorisés à se connecter.
 */
export const ALLOWED_EMAIL_DOMAINS = ["famelink.ai"];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
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
