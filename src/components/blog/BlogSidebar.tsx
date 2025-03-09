import { motion } from "framer-motion";
import { Tag } from "lucide-react";

interface BlogSidebarProps {
  categories: { name: string; count: number }[];
  selectedCategory: string | null;
  onCategorySelect: (category: string | null) => void;
}

export const BlogSidebar = ({
  categories,
  selectedCategory,
  onCategorySelect,
}: BlogSidebarProps) => {
  const { fadeIn } = {
    fadeIn: () => ({
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      viewport: { once: true },
      transition: { duration: 0.5 },
    }),
  };

  return (
    <motion.aside {...fadeIn()} className="space-y-8">
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h2 className="text-xl font-serif font-semibold text-sage-800 mb-4 flex items-center">
          <Tag className="h-5 w-5 mr-2 text-mint-600" />
          Catégories
        </h2>
        
        <ul className="space-y-2">
          <li>
            <button
              onClick={() => onCategorySelect(null)}
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                selectedCategory === null
                  ? "bg-mint-50 text-mint-600 font-medium"
                  : "text-sage-600 hover:bg-sage-50"
              }`}
            >
              Toutes les catégories
            </button>
          </li>
          
          {categories.map((category) => (
            <li key={category.name}>
              <button
                onClick={() => onCategorySelect(category.name)}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors flex justify-between items-center ${
                  selectedCategory === category.name
                    ? "bg-mint-50 text-mint-600 font-medium"
                    : "text-sage-600 hover:bg-sage-50"
                }`}
              >
                <span>{category.name}</span>
                <span className="bg-sage-100 text-sage-600 text-xs px-2 py-1 rounded-full">
                  {category.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      
      <div className="bg-mint-50 p-6 rounded-lg">
        <h2 className="text-xl font-serif font-semibold text-sage-800 mb-3">
          Besoin d'aide?
        </h2>
        <p className="text-sage-600 mb-4">
          N'hésitez pas à me contacter pour toute question ou pour prendre rendez-vous.
        </p>
        <a
          href="/contact"
          className="btn-primary w-full justify-center"
        >
          Me contacter
        </a>
      </div>
    </motion.aside>
  );
};