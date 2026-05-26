"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PopoverProps = {
  /** Le trigger reçoit `open` et un toggle. Doit rendre un élément cliquable. */
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  /** Contenu du popover. Peut être une fn pour récupérer un closer. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Alignement horizontal par rapport au trigger. */
  align?: "left" | "right";
  /** Forcer la même largeur que le trigger (utile pour un select). */
  sameWidth?: boolean;
  /** Classes additionnelles sur le conteneur extérieur. */
  className?: string;
};

/**
 * Popover positionné en absolu sous le trigger.
 * - Ferme au clic à l'extérieur
 * - Ferme à la touche Escape
 * - Pas de portal : utilise z-index pour rester au-dessus
 */
export function Popover({
  trigger,
  children,
  align = "left",
  sameWidth = false,
  className = "",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className={[
            "absolute z-50 mt-1.5",
            align === "right" ? "right-0" : "left-0",
            sameWidth ? "w-full" : "min-w-[12rem]",
          ].join(" ")}
        >
          <div className="card p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] border border-border bg-panel">
            {typeof children === "function"
              ? (children as (close: () => void) => ReactNode)(() => setOpen(false))
              : children}
          </div>
        </div>
      )}
    </div>
  );
}
