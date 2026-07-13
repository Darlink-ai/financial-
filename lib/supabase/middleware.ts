import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isAllowedEmail } from "./env";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/callback",
  "/api/auth/signout",
  "/api/diag",
  // rematch-drafts a sa propre auth Bearer CRON_SECRET + check cookie.
  // Middleware skip pour que le header Authorization ne soit pas
  // court-circuité côté Supabase auth.
  "/api/invoices/rematch-drafts",
  // debug-match : diagnostic dry-run authentifié via ?auth=CRON_SECRET.
  "/api/invoices/debug-match",
  // debug-list : liste read-only des invoices par mois/devise.
  "/api/invoices/debug-list",
  // reprocess-manual : bulk re-traitement des invoices status='manual',
  // authentifié via Bearer CRON_SECRET ou cookie Supabase (bouton UI).
  "/api/invoices/reprocess-manual",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")))
    return true;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$/i)
  )
    return true;
  return false;
}

export async function updateSession(request: NextRequest) {
  // Feature flag : auth désactivée par défaut.
  if (process.env.AUTH_ENABLED !== "true") {
    return NextResponse.next({ request });
  }

  const env = getSupabaseEnv();
  // Sans config Supabase on laisse passer (dev local sans env vars).
  if (!env) return NextResponse.next({ request });

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Email connecté mais hors du domaine autorisé → signout + redirect.
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    if (isApi) {
      return NextResponse.json({ error: "domain_not_allowed" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "domain_not_allowed");
    return NextResponse.redirect(url);
  }

  // Pas connecté → redirect /login (ou 401 pour API).
  if (!user && !isPublic(pathname)) {
    if (isApi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Déjà connecté et tente d'accéder à /login → renvoie au tableau de bord.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
