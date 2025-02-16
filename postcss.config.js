export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    cssnano: {
      preset: [
        "default",
        {
          discardComments: { removeAll: true },
          normalizeWhitespace: true,
          minifyFontValues: true,
          minifyGradients: true,
          reduceIdents: true,
          reduceTransforms: true,
          autoprefixer: true,
          mergeRules: true,
          mergeLonghand: true,
          cssDeclarationSorter: true,
        },
      ],
    },
  },
};
