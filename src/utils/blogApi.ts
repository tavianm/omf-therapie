import { parse } from "date-fns";
import { fr } from "date-fns/locale";
import { BlogPost, BlogPostsParams, BlogPostsResponse } from "../types/blog";
import { BLOG_POSTS } from "./blog-list";

// Calculate reading time based on content length
export const calculateReadingTime = (content: string): number => {
  const wordsPerMinute = 200;
  const wordCount = content.split(/\s+/).length;
  return Math.ceil(wordCount / wordsPerMinute);
};

// Extract all unique categories from blog posts
const extractCategories = (): { name: string; count: number }[] => {
  const categoriesMap = new Map<string, number>();

  BLOG_POSTS.filter((post) => !post.disabled).forEach((post) => {
    post.categories.forEach((category) => {
      const currentCount = categoriesMap.get(category) || 0;
      categoriesMap.set(category, currentCount + 1);
    });
  });

  return Array.from(categoriesMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
};

// Filter posts based on search parameters
const filterPosts = (
  posts: BlogPost[],
  search?: string,
  category?: string | null
): BlogPost[] => {
  let filteredPosts = [...posts].filter((post) => !post.disabled);

  if (search) {
    const searchLower = search.toLowerCase();
    filteredPosts = filteredPosts.filter(
      (post) =>
        !post.disabled &&
        (post.title.toLowerCase().includes(searchLower) ||
          post.excerpt.toLowerCase().includes(searchLower) ||
          post.content.toLowerCase().includes(searchLower) ||
          post.categories.some((cat) =>
            cat.toLowerCase().includes(searchLower)
          ))
    );
  }

  if (category) {
    filteredPosts = filteredPosts.filter((post) =>
      post.categories.includes(category)
    );
  }

  return filteredPosts.sort((a, b) => {
    const parseDate = (dateStr: string) => {
      return parse(dateStr, "d MMMM yyyy", new Date(), { locale: fr });
    };
    return parseDate(b.date).getTime() - parseDate(a.date).getTime();
  });
};

// Paginate posts
const paginatePosts = (
  posts: BlogPost[],
  page: number = 1,
  limit: number = 5
): BlogPost[] => {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  return posts.slice(startIndex, endIndex);
};

// Simulated API function to fetch blog posts
export const fetchBlogPosts = async (
  params: BlogPostsParams = {}
): Promise<BlogPostsResponse> => {
  const { page = 1, limit = 4, search, category } = params;

  // Filter posts based on search and category
  const filteredPosts = filterPosts(BLOG_POSTS, search, category);

  // Paginate the filtered posts
  const paginatedPosts = paginatePosts(filteredPosts, page, limit);

  // Get all categories with counts
  const categories = extractCategories();

  return {
    posts: paginatedPosts,
    totalPosts: filteredPosts.length,
    totalPages: Math.ceil(filteredPosts.length / limit),
    categories,
  };
};

// Simulated API function to fetch a single blog post by slug
export const fetchBlogPostBySlug = async (
  slug: string
): Promise<BlogPost | null> => {
  const post =
    BLOG_POSTS.filter((post) => !post.disabled).find(
      (post) => post.slug === slug
    ) || null;

  return post;
};

// Simulated API function to fetch related posts
export const fetchRelatedPosts = async (
  postId: string,
  categories: string[]
): Promise<BlogPost[]> => {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Find posts with similar categories, excluding the current post
  const relatedPosts = BLOG_POSTS.filter(
    (post) =>
      !post.disabled &&
      post.id !== postId &&
      post.categories.some((cat) => categories.includes(cat))
  )
    // Sort by number of matching categories
    .sort((a, b) => {
      const aMatches = a.categories.filter((cat) =>
        categories.includes(cat)
      ).length;
      const bMatches = b.categories.filter((cat) =>
        categories.includes(cat)
      ).length;
      return bMatches - aMatches;
    })
    // Limit to 3 related posts
    .slice(0, 3);

  return relatedPosts;
};


