// Astro 7 removed the `z` re-export from `astro:content` — import the bundled
// zod directly instead (`defineCollection` still comes from `astro:content`).
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    postId: z.string(),
    title: z.string(),
    excerpt: z.string(),
    date: z.string(), // French date format: "15 février 2025"
    dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateIso must be YYYY-MM-DD"), // sort key for blog lists — fail the build on malformed frontmatter
    categories: z.array(z.string()),
    author: z.object({
      name: z.string(),
      title: z.string(),
    }),
    imageUrl: z.string().optional(),
    linkedinUrl: z.string().optional(),
    disabled: z.boolean().optional().default(false),
  }),
});

export const collections = { blog };
