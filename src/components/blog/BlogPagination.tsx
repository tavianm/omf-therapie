import { ChevronLeft, ChevronRight } from "lucide-react";

interface BlogPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const BlogPagination = ({
  currentPage,
  totalPages,
  onPageChange,
}: BlogPaginationProps) => {
  const renderPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    
    // Always show first page
    pages.push(
      <PaginationButton
        key={1}
        page={1}
        isActive={currentPage === 1}
        onClick={() => onPageChange(1)}
      />
    );
    
    // Show ellipsis if needed
    if (currentPage > 3) {
      pages.push(
        <span key="ellipsis-1" className="px-3 py-2">
          ...
        </span>
      );
    }
    
    // Show pages around current page
    const startPage = Math.max(2, currentPage - 1);
    const endPage = Math.min(totalPages - 1, currentPage + 1);
    
    for (let i = startPage; i <= endPage; i++) {
      if (i !== 1 && i !== totalPages) {
        pages.push(
          <PaginationButton
            key={i}
            page={i}
            isActive={currentPage === i}
            onClick={() => onPageChange(i)}
          />
        );
      }
    }
    
    // Show ellipsis if needed
    if (currentPage < totalPages - 2) {
      pages.push(
        <span key="ellipsis-2" className="px-3 py-2">
          ...
        </span>
      );
    }
    
    // Always show last page
    if (totalPages > 1) {
      pages.push(
        <PaginationButton
          key={totalPages}
          page={totalPages}
          isActive={currentPage === totalPages}
          onClick={() => onPageChange(totalPages)}
        />
      );
    }
    
    return pages;
  };

  return (
    <nav aria-label="Pagination" className="flex justify-center">
      <ul className="flex items-center space-x-1">
        <li>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={`flex items-center justify-center w-10 h-10 rounded-md ${
              currentPage === 1
                ? "text-sage-400 cursor-not-allowed"
                : "text-sage-600 hover:bg-sage-100"
            }`}
            aria-label="Page précédente"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </li>
        
        {renderPageNumbers()}
        
        <li>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={`flex items-center justify-center w-10 h-10 rounded-md ${
              currentPage === totalPages
                ? "text-sage-400 cursor-not-allowed"
                : "text-sage-600 hover:bg-sage-100"
            }`}
            aria-label="Page suivante"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </li>
      </ul>
    </nav>
  );
};

interface PaginationButtonProps {
  page: number;
  isActive: boolean;
  onClick: () => void;
}

const PaginationButton = ({ page, isActive, onClick }: PaginationButtonProps) => (
  <li>
    <button
      onClick={onClick}
      className={`flex items-center justify-center w-10 h-10 rounded-md ${
        isActive
          ? "bg-mint-600 text-white"
          : "text-sage-600 hover:bg-sage-100"
      }`}
      aria-current={isActive ? "page" : undefined}
      aria-label={`Page ${page}`}
    >
      {page}
    </button>
  </li>
);