import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/supabase/env";

export const runtime = "nodejs";

const COOKIE_NAME = "factura_user";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(COOKIE_NAME, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 jours
    path: "/",
  });
  return res;
}
