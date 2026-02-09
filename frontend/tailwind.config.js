/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Literata', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        brandYellow: '#FACC15',
        brandYellowDark: '#EAB308',
        ink: '#111827',
        muted: '#6B7280',
        surface: '#F8FAFC',
      },
      boxShadow: {
        card: '0 12px 30px rgba(15, 23, 42, 0.08)',
        soft: '0 6px 16px rgba(15, 23, 42, 0.08)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
}
