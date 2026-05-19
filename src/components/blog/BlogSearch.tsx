import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

interface BlogSearchProps {
  onSearch: (query: string) => void;
  initialValue?: string;
}

export const BlogSearch = ({ onSearch, initialValue = "" }: BlogSearchProps) => {
  const [searchQuery, setSearchQuery] = useState(initialValue);

  useEffect(() => {
    setSearchQuery(initialValue);
  }, [initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery.trim());
  };

  const handleClear = () => {
    setSearchQuery("");
    onSearch("");
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 border border-sage-200 rounded-lg focus-within:ring-2 focus-within:ring-mint-500">
        <Search className="ml-4 h-5 w-5 text-sage-400 shrink-0" aria-hidden="true" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un article..."
          className="flex-1 py-3 bg-transparent outline-none text-sage-900 placeholder:text-sage-400"
          aria-label="Rechercher un article"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-sage-400 hover:text-sage-600"
            aria-label="Effacer la recherche"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <button
          type="submit"
          className="mr-2 bg-mint-600 text-white px-4 min-h-[40px] rounded-md hover:bg-mint-700 transition-colors shrink-0"
        >
          Rechercher
        </button>
      </div>
    </form>
  );
};