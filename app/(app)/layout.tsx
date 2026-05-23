import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { StoreProvider } from "@/lib/store";
import { SidebarWithCount } from "@/components/SidebarWithCount";
import { DbErrorBanner } from "@/components/DbErrorBanner";
import { isAllowedEmail } from "@/lib/supabase/env";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const rawEmail = cookieStore.get("factura_user")?.value;
  const userEmail = rawEmail && isAllowedEmail(rawEmail) ? rawEmail : null;

  return (
    <StoreProvider>
      <div className="flex min-h-screen">
        <SidebarWithCount userEmail={userEmail} />
        <main className="flex-1 min-w-0">
          <DbErrorBanner />
          {children}
        </main>
      </div>
    </StoreProvider>
  );
}
