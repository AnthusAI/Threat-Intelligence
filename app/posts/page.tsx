import { POSTS_INDEX_METADATA, PostsIndexRoute } from "@/publication/redesign/routes/posts-routes";

export const revalidate = 60;

export const metadata = POSTS_INDEX_METADATA;

export default function PostsIndexPage() {
  return <PostsIndexRoute />;
}
