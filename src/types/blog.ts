export interface BlogPost {
  id: string;
  disabled?: boolean;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  date: string;
  categories: string[];
  imageUrl?: string;
  linkedinUrl?: string;
  author: {
    name: string;
    title: string;
  };
}

export interface BlogPostsResponse {
  posts: BlogPost[];
  totalPosts: number;
  totalPages: number;
  categories: { name: string; count: number }[];
}

export interface BlogPostsParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string | null;
}

