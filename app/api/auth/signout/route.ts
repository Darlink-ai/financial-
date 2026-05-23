import { NextResponse } from "next/server";

export const runtime = "nodejs";

const COOKIE_NAME = "factura_user";

export async function POST(request: Request) {
  const url = new URL("/login", request.url);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
