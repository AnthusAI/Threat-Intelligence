import { PostDetailRoute, generatePostMetadata } from "@/publication/redesign/routes/posts-routes";

export const revalidate = 60;

type PostDetailPageProps = { params: Promise<{ postSlug: string }> };

export async function generateMetadata({ params }: PostDetailPageProps) {
  const { postSlug } = await params;
  return generatePostMetadata(decodeURIComponent(postSlug));
}

export default async function PostDetailPage({ params }: PostDetailPageProps) {
  const { postSlug } = await params;
  return <PostDetailRoute postSlug={decodeURIComponent(postSlug)} />;
}
