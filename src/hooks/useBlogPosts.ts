import { useEffect, useState } from "react";
import { BlogPost, BlogPostsParams, BlogPostsResponse } from "../types/blog";
import { fetchBlogPosts } from "../utils/blogApi";

interface UseBlogPostsResult {
  posts: BlogPost[];
  filteredPosts: BlogPost[];
  totalPosts: number;
  totalPages: number;
  categories: { name: string; count: number }[];
  isLoading: boolean;
  error: string | null;
}

export const useBlogPosts = (
  params: BlogPostsParams = {},
  refreshKey: number = 0
): UseBlogPostsResult => {
  const [data, setData] = useState<BlogPostsResponse>({
    posts: [],
    totalPosts: 0,
    totalPages: 0,
    categories: [],
  });
  const [filteredPosts, setFilteredPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPosts = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchBlogPosts(params);
        setData(response);
        setFilteredPosts(response.posts);
      } catch (err) {
        setError(
          "Impossible de charger les articles. Veuillez réessayer plus tard."
        );
        console.error("Error fetching blog posts:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.page, params.search, params.category, refreshKey]);

  return {
    posts: data.posts,
    filteredPosts,
    totalPosts: data.totalPosts,
    totalPages: data.totalPages,
    categories: data.categories,
    isLoading,
    error,
  };
};
