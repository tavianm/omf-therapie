import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useLocation, useSearchParams } from "react-router-dom";
import SEO from "../components/SEO";
import { BlogHeader } from "../components/blog/BlogHeader";
import { BlogList } from "../components/blog/BlogList";
import { BlogPagination } from "../components/blog/BlogPagination";
import { BlogSearch } from "../components/blog/BlogSearch";
import { BlogSidebar } from "../components/blog/BlogSidebar";
import { useBlogPosts } from "../hooks/useBlogPosts";

const Blog = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { categories, isLoading, error, totalPages, filteredPosts } =
    useBlogPosts(
      {
        page: currentPage,
        search: searchQuery,
        category: selectedCategory,
      },
      refreshKey
    );

  useEffect(() => {
    window.scrollTo(0, 0);

    // Get query parameters from URL
    const page = searchParams.get("page");
    const search = searchParams.get("search");
    const category = searchParams.get("category");

    if (page) setCurrentPage(parseInt(page));
    if (search) setSearchQuery(search);
    if (category) setSelectedCategory(category);
  }, [location.pathname, searchParams]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    searchParams.set("page", page.toString());
    setSearchParams(searchParams);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);

    if (query) {
      searchParams.set("search", query);
    } else {
      searchParams.delete("search");
    }

    searchParams.delete("page");
    setSearchParams(searchParams);
  };

  const handleCategorySelect = (category: string | null) => {
    setSelectedCategory(category);
    setCurrentPage(1);

    if (category) {
      searchParams.set("category", category);
    } else {
      searchParams.delete("category");
    }

    searchParams.delete("page");
    setSearchParams(searchParams);
  };

  const handleSyncComplete = () => {
    // Refresh the blog posts by updating the key
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <>
      <SEO
        title="Blog | Oriane Montabonnet - Thérapeute à Montpellier"
        description="Découvrez les articles et conseils d'Oriane Montabonnet, thérapeute à Montpellier, sur le bien-être, la psychologie et le développement personnel."
        canonical="https://omf-therapie.fr/blog"
      />
      <Toaster position="bottom-center" />
      <div className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <BlogHeader
            title="Blog"
            subtitle="Réflexions, conseils et actualités sur le bien-être et la thérapie"
            onSyncComplete={handleSyncComplete}
            showSyncButton={false}
          />

          <div className="mt-8 mb-6">
            <BlogSearch onSearch={handleSearch} initialValue={searchQuery} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3">
              <BlogList
                posts={filteredPosts}
                isLoading={isLoading}
                error={error}
              />

              {totalPages > 1 && (
                <div className="mt-10">
                  <BlogPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </div>

            <div className="lg:col-span-1">
              <BlogSidebar
                categories={categories}
                selectedCategory={selectedCategory}
                onCategorySelect={handleCategorySelect}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Blog;

