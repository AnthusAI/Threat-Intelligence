import type { ArticleVideoAsset } from "@/lib/articles";

type ArticleVideoFigureProps = {
  video: ArticleVideoAsset;
  slug: string;
  figureClassName?: string;
  priority?: boolean;
};

export function ArticleVideoFigure({ video, slug, figureClassName = "article-photo article-video" }: ArticleVideoFigureProps) {
  return (
    <figure className={figureClassName} data-media-type="video">
      <video
        controls
        playsInline
        preload="metadata"
        poster={video.posterSrc}
        aria-label={video.alt}
        className="article-video__player"
      >
        <source src={video.src} type="video/mp4" />
      </video>
      {video.caption ? <figcaption>{video.caption}</figcaption> : null}
      {video.credit ? <p className="article-video__credit">{video.credit}</p> : null}
      <span className="sr-only" data-video-slug={slug}>
        {video.alt}
      </span>
    </figure>
  );
}
