/**
 * Orchestrateur d'upload de facture vers Google Drive.
 *
 * Crée à la volée l'arborescence :
 *   {rootFolderName}/{YYYY}/{MM}/{CODE - Libellé}/{finalName}.pdf
 *
 * Met en cache les IDs de dossiers entre les appels (utile dans un
 * sync où plusieurs factures peuvent partager la même catégorie).
 */

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

  const [year, month] = input.invoiceDateIso.split("-");
  const categoryFolderName = `${input.folderCode} - ${input.folderLabel}`;

  const yearId = await cachedFindOrCreate(accessToken, rootId, year, cache);
  const monthId = await cachedFindOrCreate(accessToken, yearId, month, cache);
  const catId = await cachedFindOrCreate(
    accessToken,
    monthId,
    categoryFolderName,
    cache,
  );

  const file: DriveFile = await uploadPdf({
    accessToken,
    parentId: catId,
    name: input.finalName,
    pdfBuffer: input.pdfBuffer,
  });

  const drivePath = `/${cfg.rootFolderName}/${year}/${month}/${categoryFolderName}/${input.finalName}.pdf`;
  return {
    driveFileId: file.id,
    drivePath,
    webViewLink: file.webViewLink,
  };
}
