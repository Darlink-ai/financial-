import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  getGoogleCredentialsForMailbox,
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

  const creds = await getGoogleCredentialsForMailbox(mailboxId);
  if (!creds) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_google_credentials", req.url),
      { status: 303 },
    );
  }

  const redirectUri = getRedirectUri(req);
  const state = encodeURIComponent(mailboxId);

  const authorize = buildAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
  });

  return NextResponse.redirect(authorize, { status: 303 });
}
