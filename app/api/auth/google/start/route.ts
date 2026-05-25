import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  getGoogleCredentials,
  getRedirectUri,
} from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mailboxId = url.searchParams.get("mailboxId");
  if (!mailboxId) {
    return NextResponse.json({ error: "missing_mailboxId" }, { status: 400 });
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_google_credentials", req.url),
      { status: 303 },
    );
  }

  const redirectUri = getRedirectUri(req);
  // State = mailboxId (le callback en aura besoin). Pas critique pour CSRF
  // dans une app à 1-2 users, mais on pourrait HMAC-signer plus tard.
  const state = encodeURIComponent(mailboxId);

  const authorize = buildAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
  });

  return NextResponse.redirect(authorize, { status: 303 });
}
