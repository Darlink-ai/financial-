import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/store";
import { SidebarWithCount } from "@/components/SidebarWithCount";
import { DbErrorBanner } from "@/components/DbErrorBanner";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/supabase/env";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const userEmail = supabase
    ? (await supabase.auth.getUser()).data.user?.email ?? null
    : null;
  const safeEmail = isAllowedEmail(userEmail) ? userEmail : null;

  return (
    <StoreProvider>
      <div className="flex min-h-screen bg-page">
        <SidebarWithCount userEmail={safeEmail} />
        <main className="flex-1 min-w-0 py-4 pr-4">
          {/* overflow-clip (pas hidden) : garde les en-têtes « sticky » des pages. */}
          <div className="app-frame min-h-[calc(100vh-32px)] overflow-clip">
            <DbErrorBanner />
            {children}
          </div>
        </main>
      </div>
    </StoreProvider>
  );
}
