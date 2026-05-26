/**
 * Helper Google OAuth 2.0 pour brancher des boîtes Gmail.
 * Les credentials (client_id / client_secret) viennent de la table
 * app_settings (renseignés par l'utilisateur dans la page Connexions).
 */

import { getMailboxOAuthCredentials } from "./db";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify", // marquer comme lu
  "https://www.googleapis.com/auth/drive.file", // futur : upload sur Drive
  "openid",
  "email",
];

// Scopes pour le compte Drive global (séparé des mailboxes Gmail).
// Scope `drive` complet : permet d'écrire dans n'importe quel dossier
// auquel l'utilisateur OAuth a accès — y compris ceux créés manuellement.
// (Si tu veux du moindre privilège, repasse à `drive.file`, mais alors
//  le bot ne pourra ranger que dans son propre dossier auto-créé.)
export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid",
  "email",
];

export async function getGoogleCredentialsForMailbox(
  mailboxId: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  return await getMailboxOAuthCredentials(mailboxId);
}

export function getRedirectUri(request: Request): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/api/auth/google/callback`;
}

export function getDriveRedirectUri(request: Request): string {
  const explicit = process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/api/auth/drive/callback`;
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string;
  scopes?: string[];
}): string {
  const u = new URL(GOOGLE_AUTHORIZE_URL);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (opts.scopes ?? GMAIL_SCOPES).join(" "));
  u.searchParams.set("access_type", "offline"); // pour avoir le refresh_token
  u.searchParams.set("prompt", "consent"); // force le refresh_token à être renvoyé
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", opts.state);
  if (opts.loginHint) u.searchParams.set("login_hint", opts.loginHint);
  return u.toString();
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export async function exchangeCodeForTokens(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google token exchange failed (${r.status}): ${text}`);
  }
  return (await r.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresAt: string; scope: string }> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google refresh failed (${r.status}): ${text}`);
  }
  const data = (await r.json()) as Omit<GoogleTokenResponse, "refresh_token">;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope,
  };
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const r = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    throw new Error(`Google userinfo failed (${r.status})`);
  }
  const data = (await r.json()) as { email: string };
  return data.email;
}
