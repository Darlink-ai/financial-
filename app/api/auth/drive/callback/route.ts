import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  getDriveRedirectUri,
} from "@/lib/google-oauth";
import { fetchUserEmail } from "@/lib/drive-api";
import { getDriveCredentials, saveDriveOAuth } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(
      new URL(`/connectors?error=${encodeURIComponent(err)}`, req.url),
      { status: 303 },
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_code", req.url),
      { status: 303 },
    );
  }

  const creds = await getDriveCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL("/connectors?error=missing_drive_credentials", req.url),
      { status: 303 },
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: getDriveRedirectUri(req),
    });

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL("/connectors?error=no_refresh_token", req.url),
        { status: 303 },
      );
    }

    const userEmail = await fetchUserEmail(tokens.access_token);

    await saveDriveOAuth({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope,
      userEmail,
    });

    return NextResponse.redirect(
      new URL(`/connectors?drive=connected`, req.url),
      { status: 303 },
    );
  } catch (e) {
    console.error("Drive OAuth callback failed", e);
    return NextResponse.redirect(
      new URL(
        `/connectors?error=${encodeURIComponent((e as Error).message)}`,
        req.url,
      ),
      { status: 303 },
    );
  }
}
