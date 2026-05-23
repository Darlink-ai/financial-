import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
  // Kept for backwards-compat with existing callers — month selector now lives in the sidebar.
  showMonthSelector: _showMonthSelector,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  showMonthSelector?: boolean;
}) {
  void _showMonthSelector;
  return (
    <header className="px-8 pt-8 pb-6 border-b border-border">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-muted mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-3 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
