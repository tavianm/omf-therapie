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
      typography: (theme) => ({
        sage: {
          css: {
            '--tw-prose-body': theme('colors.sage.600'),
            '--tw-prose-headings': theme('colors.sage.800'),
            '--tw-prose-lead': theme('colors.sage.700'),
            '--tw-prose-links': theme('colors.mint.600'),
            '--tw-prose-bold': theme('colors.sage.800'),
            '--tw-prose-counters': theme('colors.sage.500'),
            '--tw-prose-bullets': theme('colors.sage.400'),
            '--tw-prose-hr': theme('colors.sage.200'),
            '--tw-prose-quotes': theme('colors.sage.700'),
            '--tw-prose-quote-borders': theme('colors.mint.300'),
            '--tw-prose-captions': theme('colors.sage.500'),
            '--tw-prose-code': theme('colors.sage.800'),
            '--tw-prose-pre-code': theme('colors.sage.200'),
            '--tw-prose-pre-bg': theme('colors.sage.800'),
            '--tw-prose-th-borders': theme('colors.sage.300'),
            '--tw-prose-td-borders': theme('colors.sage.200'),
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/line-clamp'),
  ],
};