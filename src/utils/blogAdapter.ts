import type { CollectionEntry } from 'astro:content';
import type { BlogPost } from '../types/blog';

export function collectionEntryToBlogPost(entry: CollectionEntry<'blog'>): BlogPost {
  return {
    id: entry.data.id,
    title: entry.data.title,
    slug: entry.id.replace(/\.md$/, ''), // strip .md extension (Astro 5: entry.id includes extension)
    excerpt: entry.data.excerpt,
    content: entry.body ?? '', // raw markdown body
    date: entry.data.date,
    categories: entry.data.categories,
    author: entry.data.author,
    imageUrl: entry.data.imageUrl,
    linkedinUrl: entry.data.linkedinUrl,
    disabled: entry.data.disabled ?? false,
  };
}
