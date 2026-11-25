import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Instrument_Sans } from "next/font/google";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Factura — Classement automatique des factures",
  description: "Plateforme de récupération, analyse, classement et rapprochement Excel des factures.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={instrumentSans.variable}>
      <body>{children}</body>
    </html>
  );
}
