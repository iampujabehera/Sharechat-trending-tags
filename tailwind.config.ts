import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ShareChat real-app design tokens (from screen-recording analysis).
        sc: {
          black: "#000000",
          surface: "#0D0D0D",
          surface2: "#161616",
          blue: "#3B82F6",
          orange: "#E85D24",
          gold: "#F59E0B",
          green: "#16A34A",
          red: "#DC2626",
          text: "#FFFFFF",
          text2: "#9CA3AF",
          text3: "#4B5563",
        },
      },
      borderColor: {
        DEFAULT: "rgba(255,255,255,0.08)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        slideUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s linear infinite",
        slideUp: "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        fadeIn: "fadeIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
