import type { ReactNode } from "react";

/**
 * Bande supérieure des pages : ne rend QUE les actions (boutons).
 * Le titre / sous-titre passés en props sont ignorés — la sidebar
 * indique déjà où on est.
 *
 * Si aucune action, on ne rend rien du tout.
 */
export function PageHeader({
  title: _title,
  subtitle: _subtitle,
  actions,
  showMonthSelector: _showMonthSelector,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  showMonthSelector?: boolean;
}) {
  void _title;
  void _subtitle;
  void _showMonthSelector;

  if (!actions) return null;

  return (
    <header className="px-8 pt-5 pb-4 border-b border-border">
      <div className="flex items-center justify-end gap-3 flex-wrap">
        {actions}
      </div>
    </header>
  );
}
