/**
 * Helpers Gmail API — listing, get message, get attachment.
 * Toutes les fonctions prennent un accessToken Bearer.
 */

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailMessageHeader = { name: string; value: string };

export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailMessagePart;
};

export type ParsedAttachment = {
  attachmentId: string;
  filename: string;
  size: number;
  mimeType: string;
};

export async function listMessages(
  accessToken: string,
  query: string,
  maxResults = 100,
  /**
   * Par défaut, Gmail API EXCLUT les messages dans spam et trash.
   * Mettre à true pour inclure ces dossiers — utile pour récupérer les
   * factures que l'algorithme anti-spam de Gmail a classé indésirables.
   * On combine avec un filtre query (in:inbox OR in:spam) pour exclure
   * la corbeille (in:trash).
   */
  includeSpamTrash = false,
): Promise<string[]> {
  const url = new URL(`${BASE}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  if (includeSpamTrash) {
    url.searchParams.set("includeSpamTrash", "true");
  }

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`gmail list ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as { messages?: { id: string }[] };
  return (data.messages || []).map((m) => m.id);
}

export async function getMessage(
  accessToken: string,
  id: string,
): Promise<GmailMessage> {
  const r = await fetch(`${BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`gmail get ${r.status}: ${txt.slice(0, 200)}`);
  }
  return (await r.json()) as GmailMessage;
}

export function header(msg: GmailMessage, name: string): string | null {
  const headers = msg.payload.headers ?? [];
  const found = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

export function extractPdfAttachments(msg: GmailMessage): ParsedAttachment[] {
  const out: ParsedAttachment[] = [];
  const walk = (part: GmailMessagePart) => {
    if (
      part.filename &&
      /\.pdf$/i.test(part.filename) &&
      part.body?.attachmentId
    ) {
      out.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        size: part.body.size ?? 0,
        mimeType: part.mimeType ?? "application/pdf",
      });
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  };
  walk(msg.payload);
  return out;
}

export async function getAttachmentBase64(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<string> {
  const r = await fetch(
    `${BASE}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`gmail attachment ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as { data: string; size: number };
  // Gmail renvoie en base64url SANS padding. On convertit en base64
  // standard (-→+, _→/) ET on ajoute le padding "=" requis pour que
  // Buffer.from(..., "base64") décode sans perdre des bytes.
  let b64 = data.data.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}
