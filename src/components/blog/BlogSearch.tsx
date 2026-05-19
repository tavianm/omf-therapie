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
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative flex items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un article..."
          className="w-full px-4 py-[14px] pl-12 pr-28 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
          aria-label="Rechercher un article"
        />
        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-sage-400" aria-hidden="true" />
        
        {searchQuery && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-24 top-1/2 transform -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-sage-400 hover:text-sage-600"
            aria-label="Effacer la recherche"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        
        <button
          type="submit"
          className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-mint-600 text-white px-4 py-[10px] min-h-[44px] rounded-md hover:bg-mint-700 transition-colors"
        >
          Rechercher
        </button>
      </div>
    </form>
  );
};