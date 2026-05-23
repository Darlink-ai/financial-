import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d12",
        panel: "#11141b",
        panel2: "#161a23",
        border: "#1f2430",
        accent: "#7c9cff",
        accent2: "#5b8def",
        ok: "#22c55e",
        warn: "#f59e0b",
        err: "#ef4444",
        muted: "#8a93a6",
        text: "#e7ebf3",
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
