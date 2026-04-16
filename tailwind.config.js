/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Accessibility bump (research finding #6): shift the two smallest
      // text sizes up one notch so older players (Uncle Chen, 50+) can read
      // secondary labels and microcopy without pinch-to-zoom.
      //   text-xs: 12px → 14px
      //   text-sm: 14px → 16px
      // Other sizes (base, lg, xl, ...) stay at Tailwind defaults.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['1rem', { lineHeight: '1.5rem' }],
      },
      colors: {
        court: '#4ade80',
        'forest-900': '#050f07',
        'forest-800': '#0a1f0e',
      },
    },
  },
  plugins: [],
};
