import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    postId: z.string(),
    title: z.string(),
    excerpt: z.string(),
    date: z.string(), // French date format: "15 février 2025"
    dateIso: z.string(), // ISO date: "2025-02-15" (for schema.org)
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
