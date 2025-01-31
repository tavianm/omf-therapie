const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');
const primeUi = require('tailwindcss-primeui');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {},
  },
  plugins: [primeUi],
};
