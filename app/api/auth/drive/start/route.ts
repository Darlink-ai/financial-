import { NextResponse } from "next/server";
import {
  DRIVE_SCOPES,
  buildAuthorizeUrl,
  getDriveRedirectUri,
} from "@/lib/google-oauth";
import { getDriveCredentials } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const creds = await getDriveCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_drive_credentials", req.url),
      { status: 303 },
    );
  }

  const redirectUri = getDriveRedirectUri(req);
  // state simple — c'est un compte unique, pas besoin d'identifier une row.
  const state = "drive";

  const authorize = buildAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
    scopes: DRIVE_SCOPES,
  });

  return NextResponse.redirect(authorize, { status: 303 });
}
