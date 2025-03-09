import { motion } from "framer-motion";
import { Calendar, Clock, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { BlogPost } from "../../types/blog";
import { calculateReadingTime } from "../../utils/blogApi";
import { ShareButtons } from "./ShareButtons";

interface BlogPostCardProps {
  post: BlogPost;
}

export const BlogPostCard = ({ post }: BlogPostCardProps) => {
  const { fadeInUp } = {
    fadeInUp: () => ({
      initial: { opacity: 0, y: 20 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true },
      transition: { duration: 0.5 },
    }),
  };

  return (
    <motion.article
      {...fadeInUp()}
      className="bg-white rounded-lg shadow-sm overflow-hidden"
    >
      <div className="p-6">
        <div className="flex flex-wrap gap-2 mb-3">
          {post.categories.map((category) => (
            <Link
              key={category}
              to={`/blog?category=${encodeURIComponent(category)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-mint-600 bg-mint-50 px-2 py-1 rounded-full hover:bg-mint-100 transition-colors"
            >
              <Tag className="h-3 w-3" />
              {category}
            </Link>
          ))}
        </div>

        <Link to={`/blog/${post.slug}`}>
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-3 hover:text-mint-600 transition-colors">
            {post.title}
          </h2>
        </Link>

        <div className="flex items-center text-sage-500 text-sm mb-4">
          <span className="flex items-center">
            <Calendar className="h-4 w-4 mr-1" />
            {post.date}
          </span>
          <span className="mx-2">•</span>
          <span className="flex items-center">
            <Clock className="h-4 w-4 mr-1" />
            {calculateReadingTime(post.content)} min de lecture
          </span>
        </div>

        <p className="text-sage-600 mb-4 line-clamp-3">{post.excerpt}</p>

        <div className="flex justify-between items-center">
          <Link
            to={`/blog/${post.slug}`}
            className="text-mint-600 font-medium hover:text-mint-700 transition-colors"
          >
            Lire la suite
          </Link>

          <ShareButtons post={post} />
        </div>
      </div>
    </motion.article>
  );
};

