import type { Config } from "tailwindcss";

/**
 * "Ledger" — a monochrome system. Black / white / gray only, no colored accent.
 * White is reserved for what the chain has decided or what spends money
 * (the OPEN live line, the VERIFIED / PAID stamps, primary actions, amounts).
 * Risk (Mainnet, expired, reverted) is shown with a hatched hazard pattern,
 * never a hue — so it survives grayscale and screenshots.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 9-step ink scale (ink-0 = void … ink-8 = verdict)
        void: "#000000",
        ground: "#0A0A0A", // page
        panel: "#111111", // forms, menus, elevated surfaces
        raise: "#1A1A1A", // hover / info toast
        rule: "#262626", // primary hairline
        hair: "#1F1F1F", // section rules
        edge: "#4D4D4D", // secondary outline
        muted: "#8C8C8C", // tertiary text
        sub: "#B3B3B3", // secondary body
        body: "#D4D4D4", // body text
        ink: "#EDEDED", // default text
        verdict: "#FFFFFF", // the chain's word / money
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.065em",
        tighter: "-0.05em",
        tight2: "-0.03em",
        wide2: "0.06em",
        wide3: "0.08em",
        wide4: "0.1em",
      },
      borderRadius: {
        none: "0",
        DEFAULT: "0", // square everywhere by default
        sm: "0",
        md: "0",
        lg: "0",
        full: "9999px", // only for dots / avatars
      },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(255,255,255,.6)" },
          "70%": { boxShadow: "0 0 0 8px rgba(255,255,255,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        },
        blink: { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
        shimmer: { "0%": { opacity: ".35" }, "50%": { opacity: ".8" }, "100%": { opacity: ".35" } },
        spin: { to: { transform: "rotate(360deg)" } },
        ticker: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        toastIn: { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        rowIn: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        pulseRing: "pulseRing 2s ease-out infinite",
        blink: "blink 1.2s steps(1) infinite",
        shimmer: "shimmer 1.2s infinite",
        spin: "spin 1s linear infinite",
        ticker: "ticker 40s linear infinite",
        toastIn: "toastIn .4s cubic-bezier(0.16,1,0.3,1) both",
        rowIn: "rowIn .5s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
