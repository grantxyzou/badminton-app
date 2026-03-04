/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        court: '#4ade80',
        'forest-900': '#050f07',
        'forest-800': '#0a1f0e',
      },
    },
  },
  plugins: [],
};
