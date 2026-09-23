import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Institutional dark "trading desk" palette.
        void: "#080A0F", // page background
        panel: "#0F131B", // card surface
        elevated: "#151A24", // raised surface / hover
        inset: "#0B0E14", // inputs / recessed
        line: "#212836", // hairline border
        "line-soft": "#1A202C",
        ink: "#E8ECF4", // primary text
        muted: "#8B95A8", // secondary text
        faint: "#5A6478", // tertiary / placeholder
        // accents
        accent: "#4C82FB", // Circle-blue primary
        "accent-deep": "#3667D6",
        settle: "#34D399", // payout / success green
        pending: "#F5B14C", // awaiting / amber
        danger: "#F26D6D",
        // aliases so stray utilities resolve
        usdc: "#4C82FB",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: { tightest: "-0.03em", widest2: "0.22em" },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 30px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(76,130,251,0.4), 0 8px 30px -8px rgba(76,130,251,0.35)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulse2: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        rise: "rise 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "toast-in": "toast-in 0.4s cubic-bezier(0.16,1,0.3,1) both",
        pulse2: "pulse2 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
