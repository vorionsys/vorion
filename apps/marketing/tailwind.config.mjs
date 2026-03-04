/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        vorion: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        secondary: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        accent: {
          cyan: '#06b6d4',
          emerald: '#22c55e',
          amber: '#f59e0b',
          rose: '#f43f5e',
          purple: '#a855f7',
        },
        trust: {
          sandbox: '#ef4444',
          provisional: '#f97316',
          standard: '#eab308',
          trusted: '#3b82f6',
          certified: '#8b5cf6',
          autonomous: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      backgroundColor: {
        dark: '#0f172a',
        'dark-secondary': '#1e293b',
        'dark-elevated': '#1e1b4b',
      },
    },
  },
  plugins: [],
};
