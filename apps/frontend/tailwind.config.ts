import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#5750E8",
          primary: "#5750E8",
          primaryDark: "#33359D",
          gold: "#33359D",
          blue: "#2196C9",
          green: "#43A847",
          red: "#E53935",
          neutral: "#5C6670"
        },
        neon: {
          orange: "#5750E8",
          cyan: "#06FFA5",
          magenta: "#FF006E",
          purple: "#8338EC",
          blue: "#3A86FF",
          yellow: "#FFBE0B"
        },
        bg: {
          light: "#F5F3EE",
          canvas: "#FFFFFF",
          surface: "#FAFAF8",
          "surface-2": "#F7F7FB",
          accent: "#F0EDE8",
          dark: "#06060C",
          dark2: "#0A0A14",
          darkcard: "#0F0F1B",
          sidebar: "#0A0A12"
        }
      },
      fontFamily: {
        display: ["var(--font-space)", "var(--font-inter)", "sans-serif"],
        sans: ["var(--font-inter)", "sans-serif"],
        inter: ["var(--font-inter)", "sans-serif"],
        space: ["var(--font-space)", "sans-serif"],
        ui: ["var(--font-oswald)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      },
      fontSize: {
        "display-xl": ["6rem", { lineHeight: "1", letterSpacing: "-0.035em" }],
        "display-lg": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-md": ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "h1": ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "h2": ["2rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "h3": ["1.5rem", { lineHeight: "1.3" }],
        "body-lg": ["1.125rem", { lineHeight: "1.6" }],
        "eyebrow": ["0.6875rem", { lineHeight: "1", letterSpacing: "0.15em" }]
      },
      boxShadow: {
        glow: "0 8px 32px rgba(87,80,232,0.35)",
        "glow-lg": "0 16px 64px rgba(87,80,232,0.28)",
        "glow-neon": "0 0 40px rgba(255,0,110,0.4)",
        glass: "0 10px 40px rgba(0,0,0,0.08)",
        "glass-dark": "0 20px 60px rgba(0,0,0,0.4)",
        "card-light": "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        "card-light-hover": "0 4px 12px rgba(16,24,40,0.08), 0 2px 4px rgba(16,24,40,0.06)",
        "glass-light": "0 8px 32px rgba(16,24,40,0.06)"
      },
      borderRadius: {
        xl2: "1.25rem"
      },
      animation: {
        "shimmer": "shimmer 2s linear infinite",
        "float": "float 6s ease-in-out infinite",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "aurora-spin": "aurora-spin 20s linear infinite",
        "fade-in": "fade-in 0.5s cubic-bezier(0.23, 1, 0.32, 1)"
      }
    }
  },
  plugins: []
};
export default config;
