import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "./env";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/signout",
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

const COOKIE_NAME = "factura_user";

export async function updateSession(request: NextRequest) {
  // Feature flag : auth désactivée par défaut. Pour la réactiver,
  // ajouter AUTH_ENABLED=true dans Vercel env vars.
  if (process.env.AUTH_ENABLED !== "true") {
    return NextResponse.next({ request });
  }

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const cookieEmail = request.cookies.get(COOKIE_NAME)?.value;
  const isAuthed = !!cookieEmail && isAllowedEmail(cookieEmail);

  // Si on a un cookie avec un email plus autorisé → on le purge
  if (cookieEmail && !isAllowedEmail(cookieEmail)) {
    const res = isApi
      ? NextResponse.json({ error: "domain_not_allowed" }, { status: 401 })
      : (() => {
          const url = request.nextUrl.clone();
          url.pathname = "/login";
          url.searchParams.set("error", "domain_not_allowed");
          return NextResponse.redirect(url);
        })();
    res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return res;
  }

  // Routes protégées : si pas authed → redirect /login (ou 401 pour API)
  if (!isAuthed && !isPublic(pathname)) {
    if (isApi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Déjà authed et tente d'accéder à /login → renvoie au tableau de bord
  if (isAuthed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
