import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchUserEmail,
  getGoogleCredentials,
  getRedirectUri,
} from "@/lib/google-oauth";
import { saveMailboxOAuth } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(
      new URL(`/connectors?error=${encodeURIComponent(err)}`, req.url),
      { status: 303 },
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_code_or_state", req.url),
      { status: 303 },
    );
  }

  const mailboxId = decodeURIComponent(state);

  const creds = await getGoogleCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_google_credentials", req.url),
      { status: 303 },
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: getRedirectUri(req),
    });

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL("/connectors?error=no_refresh_token", req.url),
        { status: 303 },
      );
    }

    const userEmail = await fetchUserEmail(tokens.access_token);

    await saveMailboxOAuth(mailboxId, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope,
      userEmail,
    });

    return NextResponse.redirect(
      new URL(`/connectors?connected=${encodeURIComponent(mailboxId)}`, req.url),
      { status: 303 },
    );
  } catch (e) {
    console.error("Google OAuth callback failed", e);
    return NextResponse.redirect(
      new URL(
        `/connectors?error=${encodeURIComponent((e as Error).message)}`,
        req.url,
      ),
      { status: 303 },
    );
  }
}
