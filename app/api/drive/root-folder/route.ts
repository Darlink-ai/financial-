import { NextResponse } from "next/server";
import { setDriveRootFolderId, getDriveWithTokens } from "@/lib/db";
import { findFolder } from "@/lib/drive-api";
import { getDriveAccessToken } from "@/lib/upload-to-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/drive/root-folder
 * Body : { folderId: string | null }
 *
 * Sauvegarde l'ID d'un dossier Drive que l'utilisateur a choisi
 * manuellement comme racine pour les uploads. Si null, on efface (le
 * prochain upload recréera "Comptabilité" automatiquement).
 *
 * Si l'ID est fourni, on vérifie son existence via l'API Drive avant
 * de sauvegarder — pour éviter qu'un mauvais ID casse les syncs futurs.
 */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    folderId?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const folderId = body.folderId?.trim() ?? null;

  try {
    if (folderId) {
      // Vérifie que le dossier existe et qu'on y a accès.
      const cfg = await getDriveWithTokens();
      if (!cfg) {
        return NextResponse.json(
          { error: "drive_not_connected", message: "Drive non connecté." },
          { status: 400 },
        );
      }
      const token = await getDriveAccessToken();
      if (!token) {
        return NextResponse.json(
          { error: "no_token", message: "Pas d'access_token Drive." },
          { status: 500 },
        );
      }
      // findFolder cherche par nom dans un parent. On utilise une requête
      // directe sur l'ID pour vérifier l'existence + droits.
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,capabilities/canAddChildren`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) {
        const text = await r.text();
        return NextResponse.json(
          {
            error: "folder_not_accessible",
            message: `Drive ne trouve pas ce dossier ou pas les droits : ${r.status} — ${text.slice(0, 200)}`,
          },
          { status: 400 },
        );
      }
      const data = (await r.json()) as {
        id: string;
        name: string;
        mimeType: string;
        capabilities?: { canAddChildren?: boolean };
      };
      if (data.mimeType !== "application/vnd.google-apps.folder") {
        return NextResponse.json(
          {
            error: "not_a_folder",
            message: `L'ID pointe sur "${data.name}" mais ce n'est pas un dossier.`,
          },
          { status: 400 },
        );
      }
      if (data.capabilities?.canAddChildren === false) {
        return NextResponse.json(
          {
            error: "no_write_access",
            message: `Tu n'as pas les droits d'écriture sur "${data.name}". Demande au propriétaire de te donner Éditeur.`,
          },
          { status: 400 },
        );
      }
    }

    await setDriveRootFolderId(folderId ?? "");
    return NextResponse.json({ ok: true, rootFolderId: folderId });

    // Note : si folderId === null, on a écrit "" (chaîne vide) — au
    // prochain upload, ensureRootFolderId verra "" comme falsy et
    // re-créera "Comptabilité" automatiquement.
  } catch (e) {
    return NextResponse.json(
      { error: "save_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
