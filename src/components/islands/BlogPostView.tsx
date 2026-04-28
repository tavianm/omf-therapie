import type { BlogPost } from '../../types/blog';
import { BlogPostDetail } from '../blog/BlogPostDetail';

interface Props {
  post: BlogPost;
  relatedPosts?: BlogPost[];
}

export function BlogPostView({ post, relatedPosts = [] }: Props) {
  return <BlogPostDetail post={post} relatedPosts={relatedPosts} />;
}
