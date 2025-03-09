import { useEffect, useState } from "react";
import { BlogPost } from "../types/blog";
import { fetchBlogPostBySlug, fetchRelatedPosts } from "../utils/blogApi";

interface UseBlogPostResult {
  post: BlogPost | null;
  relatedPosts: BlogPost[];
  isLoading: boolean;
  error: string | null;
}

export const useBlogPost = (slug: string): UseBlogPostResult => {
  const [post, setPost] = useState<BlogPost | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPost = async () => {
      if (!slug) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const postData = await fetchBlogPostBySlug(slug);
        setPost(postData);
        
        if (postData) {
          const related = await fetchRelatedPosts(postData.id, postData.categories);
          setRelatedPosts(related);
        }
      } catch (err) {
        setError("Impossible de charger l'article. Veuillez réessayer plus tard.");
        console.error("Error fetching blog post:", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPost();
  }, [slug]);

  return {
    post,
    relatedPosts,
    isLoading,
    error,
  };
};