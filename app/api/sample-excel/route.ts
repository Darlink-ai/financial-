import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM

  const allData: Record<string, (string | number)[][]> = {
    "2026-05": [
      ["Date", "Créditeur", "Libellé", "Montant", "Devise", "Catégorie"],
      ["10.05.2026", "OpenAI", "Abonnement API mai", 200.0, "USD", "TECH"],
      ["12.05.2026", "Meta", "Campagne Facebook Ads mai", 540.0, "CHF", "MKT"],
      ["15.05.2026", "Swisscom", "Forfaits mobiles", 89.0, "CHF", "ADM"],
      ["18.05.2026", "Stripe", "Frais de transaction mai", 312.7, "CHF", "PROC"],
      ["22.05.2026", "Runpod", "GPU compute mai", 124.5, "USD", "TECH"],
      ["01.05.2026", "Régie Dupont", "Loyer mai 2026", 2400.0, "CHF", "LOC"],
      ["07.05.2026", "Migros", "Café & boissons salle de pause", 54.3, "CHF", "ADM"],
      ["20.05.2026", "SIG", "Électricité bureau", 245.0, "CHF", "LOC"],
    ],
    "2026-04": [
      ["Date", "Créditeur", "Libellé", "Montant", "Devise", "Catégorie"],
      ["15.04.2026", "Helvetia", "Prime trimestrielle Q2", 480.0, "CHF", "ASS"],
      ["10.04.2026", "OpenAI", "Abonnement API avril", 200.0, "USD", "TECH"],
      ["01.04.2026", "Régie Dupont", "Loyer avril 2026", 2400.0, "CHF", "LOC"],
    ],
  };

  const data = month && allData[month] ? allData[month] : allData["2026-05"];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comptabilité");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = month
    ? `exemple-comptabilite-${month}.xlsx`
    : "exemple-comptabilite.xlsx";

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
