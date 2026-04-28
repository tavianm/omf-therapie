import { useState, useMemo } from 'react';
import type { BlogPost } from '../../types/blog';
import { BlogList } from '../blog/BlogList';
import { BlogSearch } from '../blog/BlogSearch';
import { BlogPagination } from '../blog/BlogPagination';
import { BlogSidebar } from '../blog/BlogSidebar';

const POSTS_PER_PAGE = 5;

interface Props {
  initialPosts: BlogPost[];
}

export function BlogClientWrapper({ initialPosts }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('category');
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Compute categories from all non-disabled posts
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    initialPosts.forEach((post) => {
      if (!post.disabled) {
        post.categories.forEach((cat) =>
          counts.set(cat, (counts.get(cat) ?? 0) + 1)
        );
      }
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [initialPosts]);

  const filteredPosts = useMemo(() => {
    return initialPosts.filter((post) => {
      if (post.disabled) return false;
      if (selectedCategory && !post.categories.includes(selectedCategory))
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          post.title.toLowerCase().includes(q) ||
          post.excerpt.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [initialPosts, searchQuery, selectedCategory]);

  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = filteredPosts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  );

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const handleCategorySelect = (category: string | null) => {
    setSelectedCategory(category);
    setCurrentPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid lg:grid-cols-4 gap-8">
        <aside className="lg:col-span-1">
          <BlogSidebar
            categories={categories}
            selectedCategory={selectedCategory}
            onCategorySelect={handleCategorySelect}
          />
        </aside>
        <main className="lg:col-span-3">
          <BlogSearch onSearch={handleSearch} initialValue={searchQuery} />
          <div className="mt-6">
            <BlogList posts={paginatedPosts} isLoading={false} error={null} />
          </div>
          {totalPages > 1 && (
            <div className="mt-8">
              <BlogPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
