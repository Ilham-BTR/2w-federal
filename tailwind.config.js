/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'fade-in':  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-out': { '0%': { opacity: '1' }, '100%': { opacity: '0' } },
        'pop-in':   { '0%': { opacity: '0', transform: 'scale(.95) translateY(8px)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
        'pop-out':  { '0%': { opacity: '1', transform: 'scale(1) translateY(0)' }, '100%': { opacity: '0', transform: 'scale(.96) translateY(6px)' } },
      },
      animation: {
        'fade-in':  'fade-in .2s ease-out',
        'fade-out': 'fade-out .18s ease-in forwards',
        'pop-in':   'pop-in .22s cubic-bezier(.2,.8,.2,1)',
        'pop-out':  'pop-out .18s ease-in forwards',
      },
    },
  },
  plugins: [],
};
