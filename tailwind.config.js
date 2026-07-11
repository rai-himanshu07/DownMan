/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // DownMan custom palette — variable-driven so light mode can flip it
        ink: {
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
        },
        slate: {
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
          700: "rgb(var(--slate-700) / <alpha-value>)",
        },
        aurora: {
          50: "#f7ffd9",
          100: "#efffb0",
          200: "#e5ff7c",
          300: "#d9ff54",
          400: "#ccf43c",
          500: "#b8df2d",
          600: "#91b31f",
          700: "#6f8b19",
          800: "#516517",
          900: "#3c4a15",
        },
        magenta: {
          400: "#62ded5",
          500: "#35c5bd",
          600: "#209c98",
        },
        lime: { 400: "#8be5a0", 500: "#5fc77a" },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Noto Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(204,244,60,0.34)",
        "glow-magenta": "0 0 0 1px rgba(98,222,213,0.32)",
        card: "0 12px 30px -22px rgba(0,0,0,0.9)",
      },
      backgroundImage: {
        aurora:
          "linear-gradient(rgba(204,244,60,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(204,244,60,0.025) 1px, transparent 1px)",
      },
      borderRadius: { xl2: "0.5rem" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "fade-up": "fade-up 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
