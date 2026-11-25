import type { Config } from "tailwindcss";

/**
 * Toutes les couleurs sont branchées sur les CSS variables déclarées dans
 * app/globals.css. Ça permet d'avoir un vrai theme switch (light / dark)
 * sans avoir à toucher les classes utility partout, ET de continuer à
 * utiliser les opacity modifiers Tailwind (bg-panel/50, text-muted/60…).
 *
 * Pattern : `hsl(var(--name) / <alpha-value>)` — Tailwind remplace
 * <alpha-value> par l'opacity du modifier.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "hsl(var(--page) / <alpha-value>)",
        bg: "hsl(var(--bg) / <alpha-value>)",
        panel: "hsl(var(--panel) / <alpha-value>)",
        panel2: "hsl(var(--panel2) / <alpha-value>)",
        panel3: "hsl(var(--panel3) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        borderHover: "hsl(var(--border-hover) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        accent2: "hsl(var(--accent2) / <alpha-value>)",
        accent3: "hsl(var(--accent3) / <alpha-value>)",
        ok: "hsl(var(--ok) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        err: "hsl(var(--err) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        text: "hsl(var(--text) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Formes de l'admin dropp.ing : tout est plus arrondi.
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "22px",
        "3xl": "28px",
      },
    },
  },
  plugins: [],
};

export default config;
