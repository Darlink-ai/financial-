import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/store";
import { SidebarWithCount } from "@/components/SidebarWithCount";
import { DbErrorBanner } from "@/components/DbErrorBanner";

export const metadata: Metadata = {
  title: "Factura — Classement automatique des factures",
  description: "Plateforme de récupération, analyse, classement et rapprochement Excel des factures.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <StoreProvider>
          <div className="flex min-h-screen">
            <SidebarWithCount />
            <main className="flex-1 min-w-0">
              <DbErrorBanner />
              {children}
            </main>
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
