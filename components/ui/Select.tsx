"use client";

import { Check, ChevronDown } from "lucide-react";
import { Popover } from "./Popover";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

/**
 * Select stylé "plateforme" — pas le menu déroulant natif de l'OS.
 * Utilise le composant Popover pour le menu.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Sélectionner…",
  disabled = false,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);

  return (
    <Popover
      sameWidth
      className={className}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={disabled ? undefined : toggle}
          disabled={disabled}
          className={`input flex items-center justify-between gap-2 text-left ${
            disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <span
            className={`truncate text-[13px] ${
              current ? "text-text" : "text-muted"
            }`}
          >
            {current?.label ?? placeholder}
          </span>
          <ChevronDown
            size={12}
            className={`text-muted shrink-0 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-0.5 max-h-[260px] overflow-y-auto">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-[12px] transition-colors flex items-center justify-between gap-2 ${
                  active
                    ? "bg-panel2 text-text border border-border"
                    : "text-muted hover:text-text hover:bg-panel2 border border-transparent"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.label}</span>
                  {o.hint && (
                    <span className="block text-[10px] text-muted truncate">
                      {o.hint}
                    </span>
                  )}
                </span>
                {active && <Check size={12} className="text-accent shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
