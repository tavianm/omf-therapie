import { motion } from "framer-motion";
import { Leaf } from "lucide-react";
import { BlogPost } from "../../types/blog";
import { BlogPostCard } from "./BlogPostCard";

interface BlogListProps {
  posts: BlogPost[];
  isLoading: boolean;
  error: string | null;
}

export const BlogList = ({ posts, isLoading, error }: BlogListProps) => {
  if (isLoading) {
    return <BlogLoadingState />;
  }

  if (error) {
    return <BlogErrorState error={error} />;
  }

  if (posts.length === 0) {
    return <BlogEmptyState />;
  }

  return (
    <div className="space-y-8">
      {posts.map((post) => (
        <BlogPostCard key={post.id} post={post} />
      ))}
    </div>
  );
};

const BlogLoadingState = () => (
  <div className="flex flex-col items-center justify-center py-12">
    <motion.div
      animate={{
        rotate: 360,
        scale: [1, 1.1, 1],
      }}
      transition={{
        rotate: { duration: 2, repeat: Infinity, ease: "linear" },
        scale: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
      }}
      className="inline-block mb-6"
    >
      <Leaf className="h-12 w-12 text-mint-600" />
    </motion.div>
    <h2 className="text-xl font-serif font-semibold text-sage-800 mb-3">
      Chargement des articles...
    </h2>
    <p className="text-sage-600">Merci de patienter un instant</p>
  </div>
);

const BlogErrorState = ({ error }: { error: string }) => (
  <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
    <h2 className="text-xl font-serif font-semibold text-red-800 mb-3">
      Une erreur est survenue
    </h2>
    <p className="text-red-600 mb-4">{error}</p>
    <p className="text-sage-600">
      Veuillez rafraîchir la page ou réessayer plus tard.
    </p>
  </div>
);

const BlogEmptyState = () => (
  <div className="bg-sage-50 border border-sage-200 rounded-lg p-8 text-center">
    <h2 className="text-xl font-serif font-semibold text-sage-800 mb-3">
      Aucun article trouvé
    </h2>
    <p className="text-sage-600 mb-4">
      Aucun article ne correspond à votre recherche.
    </p>
    <p className="text-sage-500">
      Essayez de modifier vos critères de recherche ou consultez les autres catégories.
    </p>
  </div>
);