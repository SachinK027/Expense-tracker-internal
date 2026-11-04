/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9f3',
          100: '#d5f0e1',
          200: '#aee1c5',
          300: '#7ccba3',
          400: '#4aaf80',
          500: '#2d9266',
          600: '#1f7552',
          700: '#1a5e43',
          800: '#174b37',
          900: '#143e2e',
          950: '#0a2319',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f6f7f9',
          dark: '#0f1419',
          'dark-muted': '#1a222d',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 2px 12px rgba(15, 20, 25, 0.06)',
        card: '0 1px 3px rgba(15, 20, 25, 0.04), 0 4px 16px rgba(15, 20, 25, 0.04)',
      },
    },
  },
  plugins: [],
}
