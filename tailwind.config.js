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
          50: "#eef9ff",
          100: "#d8f0ff",
          200: "#b6e3ff",
          300: "#82d0ff",
          400: "#48b4ff",
          500: "#1f93ff",
          600: "#0a74f0",
          700: "#0b5cd0",
          800: "#104ba8",
          900: "#143f84",
        },
        magenta: {
          400: "#ff7ad9",
          500: "#f04ec0",
          600: "#cf2ea0",
        },
        lime: { 400: "#9cff5e", 500: "#6ee63a" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px -4px rgba(31,147,255,0.45)",
        "glow-magenta": "0 0 24px -4px rgba(240,78,192,0.45)",
        card: "0 8px 30px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        aurora:
          "radial-gradient(1200px 600px at 10% -10%, rgba(31,147,255,0.18), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(240,78,192,0.14), transparent 55%)",
      },
      borderRadius: { xl2: "1.25rem" },
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
