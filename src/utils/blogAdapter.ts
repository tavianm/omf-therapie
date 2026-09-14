import type { CollectionEntry } from 'astro:content';
import type { BlogPost } from '../types/blog';

export function collectionEntryToBlogPost(entry: CollectionEntry<'blog'>): BlogPost {
  return {
    id: entry.data.postId,
    title: entry.data.title,
    slug: entry.id, // glob loader: entry.id is the file path relative to base, without extension (= URL slug)
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
