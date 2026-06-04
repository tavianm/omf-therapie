import type { BlogPost } from '../../types/blog';
import { BlogPostCard } from './BlogPostCard';

interface BlogListProps {
  posts: BlogPost[];
  error: string | null;
}

export const BlogList = ({ posts, error }: BlogListProps) => {
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
      Essayez de modifier vos critères de recherche ou consultez les autres
      catégories.
    </p>
  </div>
);
