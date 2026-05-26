import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Fond + surfaces : navy profond avec une légère teinte bleue.
        bg: "#070b16",
        panel: "#0f1525",
        panel2: "#172033",
        panel3: "#1f2a44",
        border: "#243049",
        borderHover: "#33425f",
        // Accents : bleus vifs, plus lumineux.
        accent: "#60a5fa",      // sky-blue clair (texte/icônes)
        accent2: "#3b82f6",     // blue-500 (boutons/CTA)
        accent3: "#22d3ee",     // cyan vif (highlights / charts secondaires)
        // Status
        ok: "#34d399",          // emerald-400
        warn: "#fbbf24",        // amber-400
        err: "#f87171",         // red-400
        muted: "#94a3b8",       // slate-400 (lisible sur navy)
        text: "#eaf1ff",        // blanc-bleuté
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
