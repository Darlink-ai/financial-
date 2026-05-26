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

/**
 * Cherche un fichier (non-dossier) par nom dans un parent donné.
 * Utilisé pour la détection de doublons avant upload.
 */
export async function findFileByName(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveFile | null> {
  const q = [
    `mimeType != '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "trashed = false",
  ].join(" and ");
  const url = `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`;
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
 * Upload d'un PDF dans un dossier Drive donné.
 *
 * - Vérifie d'abord qu'aucun fichier avec ce nom n'existe déjà dans
 *   le dossier (skip + retourne l'existant si oui → évite les doublons
 *   facture/reçu sur Drive).
 * - Utilise une approche en 2 temps (resumable-ish) :
 *     1) POST sur /files avec uniquement les métadonnées JSON
 *     2) PATCH /upload/files/<id> avec le binaire PDF
 *   → plus fiable que le multipart-related manuel (qui avait un souci
 *     d'encodage produisant des PDFs corrompus).
 */
export async function uploadPdf(opts: {
  accessToken: string;
  parentId: string;
  name: string; // sans extension
  pdfBuffer: Buffer;
}): Promise<DriveFile> {
  const fullName = `${opts.name}.pdf`;

  // ---- 1. Skip si le fichier existe déjà ----
  try {
    const existing = await findFileByName(
      opts.accessToken,
      opts.parentId,
      fullName,
    );
    if (existing) {
      // Doublon détecté : on retourne le fichier existant sans re-uploader.
      return existing;
    }
  } catch (e) {
    // Si la recherche échoue (réseau, droits…) on poursuit l'upload —
    // mieux vaut un éventuel doublon qu'une exception bloquante.
    console.warn("findFileByName failed before upload:", (e as Error).message);
  }

  // ---- 2a. Créer la row Drive avec les métadonnées seulement ----
  const meta = await driveFetch<DriveFile>(opts.accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: fullName,
      mimeType: "application/pdf",
      parents: [opts.parentId],
    }),
  });

  // ---- 2b. Validation magic bytes ----
  // Un PDF commence toujours par "%PDF-". Si le buffer reçu ne commence
  // pas par ça, c'est qu'il a été corrompu quelque part en amont
  // (base64 mal décodé, etc.). On clean la row vide et on throw clair.
  const magic = opts.pdfBuffer.subarray(0, 5).toString("ascii");
  if (magic !== "%PDF-") {
    try {
      await fetch(`${DRIVE_BASE}/files/${meta.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: timeoutSignal(DRIVE_TIMEOUT_MS),
      });
    } catch {
      /* ignore */
    }
    throw new Error(
      `pdf invalide (magic="${magic}", taille=${opts.pdfBuffer.length}) — base64 corrompu ?`,
    );
  }

  // ---- 2c. Upload du binaire via Blob ----
  // Blob est plus standard / robuste que Uint8Array dans Node fetch :
  // les bytes sont copiés en interne, fetch les envoie tels quels.
  const blob = new Blob([new Uint8Array(opts.pdfBuffer)], {
    type: "application/pdf",
  });

  const uploadUrl = `${DRIVE_UPLOAD}/files/${meta.id}?uploadType=media&fields=id,name,size,webViewLink`;
  const r = await fetch(uploadUrl, {
    method: "PATCH",
    signal: timeoutSignal(DRIVE_UPLOAD_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/pdf",
    },
    body: blob,
  });
  if (!r.ok) {
    const text = await r.text();
    try {
      await fetch(`${DRIVE_BASE}/files/${meta.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: timeoutSignal(DRIVE_TIMEOUT_MS),
      });
    } catch {
      /* ignore */
    }
    throw new Error(`drive upload ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = (await r.json()) as DriveFile & { size?: string };
  // Sanity check : Drive renvoie size en string. Si elle est très loin
  // de notre input, c'est qu'on a uploadé du vide / du tronqué.
  if (data.size) {
    const driveSize = parseInt(data.size, 10);
    if (driveSize === 0 || driveSize < opts.pdfBuffer.length * 0.5) {
      throw new Error(
        `drive upload incomplet : envoyé ${opts.pdfBuffer.length} bytes, Drive a stocké ${driveSize}`,
      );
    }
  }
  return data;
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
