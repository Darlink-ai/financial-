/**
 * Orchestrateur d'upload de facture vers Google Drive.
 *
 * Arborescence cible : {rootFolderName}/{MM mois}/{finalName}.pdf
 *   ex : Comptabilité/01 janvier/22.01.26 - Hetzner - TECH.pdf
 *
 * On classe uniquement par mois (12 dossiers fixes), pas par année
 * ni par catégorie comptable — le code comptable est dans le nom du
 * fichier ce qui suffit. Le nom commence par la date pour que le tri
 * Drive donne un ordre chronologique au sein d'un mois.
 *
 * Met en cache les IDs de dossiers entre les appels (utile dans un
 * sync où plusieurs factures partagent le même mois).
 */

const MONTHS_FR = [
  "01_Janvier",
  "02_Février",
  "03_Mars",
  "04_Avril",
  "05_Mai",
  "06_Juin",
  "07_Juillet",
  "08_Août",
  "09_Septembre",
  "10_Octobre",
  "11_Novembre",
  "12_Décembre",
];

function monthFolderName(invoiceDateIso: string): string {
  const m = parseInt(invoiceDateIso.slice(5, 7), 10);
  return MONTHS_FR[m - 1] ?? "00_Inconnu";
}

import {
  getDriveWithTokens,
  setDriveRootFolderId,
  updateDriveAccessToken,
} from "./db";
import {
  findOrCreateFolder,
  uploadPdf,
  type DriveFile,
} from "./drive-api";
import { refreshAccessToken } from "./google-oauth";

export type DriveFolderCache = Map<string, string>; // key="parentId|name" → folderId

export type DriveUploadInput = {
  pdfBuffer: Buffer;
  finalName: string;        // "22.05.26 - Runpod - TECH"
  invoiceDateIso: string;   // "2026-05-22"
  folderCode: string;       // "TECH"
  folderLabel: string;      // "Charges logicielles, R&D & Technologie"
};

export type DriveUploadResult = {
  driveFileId: string;
  drivePath: string;        // "/Comptabilité/2026/05/TECH - …/22.05.26 - …pdf"
  webViewLink?: string;
};

/**
 * Récupère un access_token valide, le rafraîchit si nécessaire.
 * Retourne null si Drive n'est pas configuré.
 */
export async function getDriveAccessToken(): Promise<string | null> {
  const cfg = await getDriveWithTokens();
  if (!cfg) return null;
  const now = Date.now();
  const expiresAt = cfg.expiresAt ? cfg.expiresAt.getTime() : 0;
  if (cfg.accessToken && expiresAt > now + 60_000) return cfg.accessToken;

  const refreshed = await refreshAccessToken({
    refreshToken: cfg.refreshToken,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  });
  await updateDriveAccessToken(refreshed.accessToken, refreshed.expiresAt);
  return refreshed.accessToken;
}

/** Helper interne qui passe par le cache. */
async function cachedFindOrCreate(
  accessToken: string,
  parentId: string,
  name: string,
  cache?: DriveFolderCache,
): Promise<string> {
  const key = `${parentId}|${name}`;
  if (cache?.has(key)) return cache.get(key)!;
  const id = await findOrCreateFolder(accessToken, parentId, name);
  cache?.set(key, id);
  return id;
}

/**
 * Résout (ou crée) le dossier racine "Comptabilité" sous le Drive root.
 * Mémorise son ID dans drive_config pour ne pas le re-chercher à chaque sync.
 */
async function ensureRootFolderId(
  accessToken: string,
  rootFolderName: string,
  cachedRootId: string | null,
): Promise<string> {
  if (cachedRootId) return cachedRootId;
  const id = await findOrCreateFolder(accessToken, "root", rootFolderName);
  await setDriveRootFolderId(id);
  return id;
}

/**
 * Upload une facture dans la bonne arborescence Drive.
 * Lève une exception si Drive n'est pas configuré.
 */
export async function uploadInvoiceToDrive(
  input: DriveUploadInput,
  cache?: DriveFolderCache,
): Promise<DriveUploadResult> {
  const accessToken = await getDriveAccessToken();
  if (!accessToken) {
    throw new Error("Drive non configuré (pas de credentials ou pas de refresh_token)");
  }

  const cfg = await getDriveWithTokens();
  if (!cfg) throw new Error("Drive non configuré");

  const rootId = await ensureRootFolderId(
    accessToken,
    cfg.rootFolderName,
    cfg.rootFolderId,
  );

  // Une seule profondeur : root → MM mois. Pas d'année, pas de
  // sous-dossier par catégorie.
  const monthFolder = monthFolderName(input.invoiceDateIso);
  const monthId = await cachedFindOrCreate(
    accessToken,
    rootId,
    monthFolder,
    cache,
  );

  const file: DriveFile = await uploadPdf({
    accessToken,
    parentId: monthId,
    name: input.finalName,
    pdfBuffer: input.pdfBuffer,
  });

  const drivePath = `/${cfg.rootFolderName}/${monthFolder}/${input.finalName}.pdf`;
  return {
    driveFileId: file.id,
    drivePath,
    webViewLink: file.webViewLink,
  };
}
