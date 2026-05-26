/**
 * Helpers Google Drive API v3.
 *
 * On utilise le scope `drive.file` qui ne donne accès qu'aux fichiers
 * créés par notre app — pas besoin de demander l'accès complet au Drive
 * de l'utilisateur.
 */

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Timeouts par défaut pour éviter qu'un appel Drive bloque tout le sync.
const DRIVE_TIMEOUT_MS = 20_000;
const DRIVE_UPLOAD_TIMEOUT_MS = 45_000; // upload PDF, plus lent

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
};

async function driveFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${DRIVE_BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    signal: init?.signal ?? timeoutSignal(DRIVE_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`drive ${r.status}: ${text.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

/** Cherche un sous-dossier par nom dans un parent donné. */
export async function findFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveFile | null> {
  const q = [
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "trashed = false",
  ].join(" and ");
  const url = `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
  const data = await driveFetch<{ files: DriveFile[] }>(accessToken, url);
  return data.files[0] ?? null;
}

/** Crée un sous-dossier dans un parent donné. */
export async function createFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  return await driveFetch<DriveFile>(accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    }),
  });
}

/** Trouve un dossier ou le crée si absent. Retourne son ID. */
export async function findOrCreateFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<string> {
  const existing = await findFolder(accessToken, parentId, name);
  if (existing) return existing.id;
  const created = await createFolder(accessToken, parentId, name);
  return created.id;
}

/**
 * Upload d'un PDF (Buffer) dans un dossier Drive donné.
 * Utilise le multipart upload (1 seul appel, < 5 MB recommandé — nos
 * factures font typiquement quelques centaines de KB).
 */
export async function uploadPdf(opts: {
  accessToken: string;
  parentId: string;
  name: string; // sans extension
  pdfBuffer: Buffer;
}): Promise<DriveFile> {
  const metadata = {
    name: `${opts.name}.pdf`,
    mimeType: "application/pdf",
    parents: [opts.parentId],
  };

  const boundary = `factura-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const CRLF = "\r\n";
  const meta = Buffer.from(
    `--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${JSON.stringify(
      metadata,
    )}${CRLF}`,
  );
  const fileHeader = Buffer.from(
    `--${boundary}${CRLF}Content-Type: application/pdf${CRLF}${CRLF}`,
  );
  const closing = Buffer.from(`${CRLF}--${boundary}--`);
  const body = Buffer.concat([meta, fileHeader, opts.pdfBuffer, closing]);

  const url = `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`;
  const r = await fetch(url, {
    method: "POST",
    signal: timeoutSignal(DRIVE_UPLOAD_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
    },
    body: new Uint8Array(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`drive upload ${r.status}: ${text.slice(0, 300)}`);
  }
  return (await r.json()) as DriveFile;
}

/** Récupère l'email du compte Google connecté. */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const r = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: timeoutSignal(DRIVE_TIMEOUT_MS),
    },
  );
  if (!r.ok) throw new Error(`userinfo ${r.status}`);
  const data = (await r.json()) as { email: string };
  return data.email;
}
