/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sage: {
          50: '#f4f7f4',
          100: '#e6ede6',
          200: '#cfdccf',
          300: '#adc2ad',
          400: '#85a185',
          500: '#658465',
          600: '#4e674e',
          700: '#405440',
          800: '#364436',
          900: '#2e392e',
        },
        mint: {
          50: '#f2f8f6',
          100: '#e6f1ed',
          200: '#d1e5df',
          300: '#acd3c8',
          400: '#7eb6a7',
          500: '#5e9c8d',
          600: '#477a6d',
          700: '#3c6259',
          800: '#345049',
          900: '#2d423d',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Cormorant Garamond', 'serif'],
      },
    },
  },
  plugins: [],
};