import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isAllowedEmail } from "./env";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/callback",
  // signout reste accessible même sans session, sinon impossible de la
  // déclencher proprement
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")))
    return true;
  // Static assets et Next internal
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$/i)
  )
    return true;
  return false;
}

export async function updateSession(request: NextRequest) {
  const env = getSupabaseEnv();

  // Sans config Supabase on laisse passer (utile en local sans auth configurée).
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

  // Si l'utilisateur est connecté avec un email non autorisé → signout + 401 / redirect.
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

  // Routes protégées : si pas de user
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
