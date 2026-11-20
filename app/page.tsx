import { POSTS_FEED_METADATA, PostsFeedRoute } from "@/publication/redesign/routes/posts-routes";

export const dynamic = "force-dynamic";

export const metadata = POSTS_FEED_METADATA;

export default function HomePage() {
  return <PostsFeedRoute />;
}
