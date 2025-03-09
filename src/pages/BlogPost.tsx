import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import SEO from "../components/SEO";
import { BlogPostDetail } from "../components/blog/BlogPostDetail";
import { SuspenseFallback } from "../components/common/SuspenseFallback";
import { useBlogPost } from "../hooks/useBlogPost";

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const [isLoading, setIsLoading] = useState(true);
  
  const { post, relatedPosts, error } = useBlogPost(slug || "");

  useEffect(() => {
    window.scrollTo(0, 0);
    
    // Simulate loading time
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);
    
    return () => clearTimeout(timer);
  }, [slug]);

  if (isLoading) {
    return <SuspenseFallback />;
  }

  if (error) {
    return (
      <div className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-xl font-serif font-semibold text-red-800 mb-3">
              Une erreur est survenue
            </h2>
            <p className="text-red-600 mb-4">{error}</p>
            <p className="text-sage-600">
              Veuillez rafraîchir la page ou réessayer plus tard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-sage-50 border border-sage-200 rounded-lg p-8 text-center">
            <h2 className="text-xl font-serif font-semibold text-sage-800 mb-3">
              Article non trouvé
            </h2>
            <p className="text-sage-600 mb-4">
              L'article que vous recherchez n'existe pas ou a été supprimé.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEO
        title={`${post.title} | Oriane Montabonnet - Blog`}
        description={post.excerpt}
        canonical={`https://omf-therapie.fr/blog/${post.slug}`}
        type="article"
        image={post.imageUrl || undefined}
      />
      <div className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <BlogPostDetail post={post} relatedPosts={relatedPosts} />
        </div>
      </div>
    </>
  );
};

export default BlogPost;