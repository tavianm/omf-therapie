import { motion } from "framer-motion";
import parse from "html-react-parser";
import { ArrowLeft, Calendar, Clock, Tag, User } from "lucide-react";
import { Link } from "react-router-dom";
import { BlogPost } from "../../types/blog";
import { ShareButtons } from "./ShareButtons";

interface BlogPostDetailProps {
  post: BlogPost;
  relatedPosts: BlogPost[];
}

export const BlogPostDetail = ({ post, relatedPosts }: BlogPostDetailProps) => {
  const { fadeInUp, fadeIn } = {
    fadeInUp: () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5 },
    }),
    fadeIn: () => ({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.5, delay: 0.2 },
    }),
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to="/blog"
        className="inline-flex items-center text-mint-600 hover:text-mint-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour aux articles
      </Link>

      <motion.article {...fadeInUp()} className="bg-white rounded-lg shadow-sm overflow-hidden p-6 md:p-8">
        <div className="flex flex-wrap gap-2 mb-4">
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

        <h1 className="text-3xl md:text-4xl font-serif font-semibold text-sage-800 mb-4">
          {post.title}
        </h1>

        <div className="flex flex-wrap items-center text-sage-500 text-sm mb-6">
          <span className="flex items-center mr-4 mb-2">
            <User className="h-4 w-4 mr-1" />
            Oriane Montabonnet
          </span>
          <span className="flex items-center mr-4 mb-2">
            <Calendar className="h-4 w-4 mr-1" />
            {post.date}
          </span>
          <span className="flex items-center mb-2">
            <Clock className="h-4 w-4 mr-1" />
            {post.readingTime} min de lecture
          </span>
        </div>

        {post.imageUrl && (
          <div className="mb-6">
            <img
              src={post.imageUrl}
              alt={post.title}
              className="w-full h-auto rounded-lg"
              width="800"
              height="400"
            />
          </div>
        )}

        <div className="prose prose-sage max-w-none mb-8">
          {parse(post.content)}
        </div>

        <div className="border-t border-sage-100 pt-6 flex flex-wrap justify-between items-center">
          <div className="mb-4 md:mb-0">
            <h3 className="text-sage-700 font-medium mb-2">Partager cet article</h3>
            <ShareButtons post={post} />
          </div>

          <Link
            to="/contact"
            className="text-mint-600 font-medium hover:text-mint-700 transition-colors"
          >
            Des questions? Contactez-moi
          </Link>
        </div>
      </motion.article>

      {relatedPosts.length > 0 && (
        <motion.div {...fadeIn()} className="mt-12">
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
            Articles similaires
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {relatedPosts.slice(0, 2).map((relatedPost) => (
              <div key={relatedPost.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                <Link to={`/blog/${relatedPost.slug}`} className="block p-6">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {relatedPost.categories.slice(0, 1).map((category) => (
                      <span
                        key={category}
                        className="inline-flex items-center gap-1 text-xs font-medium text-mint-600 bg-mint-50 px-2 py-1 rounded-full"
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-xl font-serif font-semibold text-sage-800 mb-2 hover:text-mint-600 transition-colors">
                    {relatedPost.title}
                  </h3>
                  <p className="text-sage-600 line-clamp-2">{relatedPost.excerpt}</p>
                </Link>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};