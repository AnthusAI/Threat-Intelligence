"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY } from "../../pictograms/art";
import {
  getThreatIntelligencePictogramPhaseOffset,
  isThreatIntelligencePictogramSlug,
  type ThreatIntelligencePictogramSlug,
} from "../../pictograms/registry";
import { PICTOGRAM_PALETTE, usePictogramMotion } from "../../pictograms/system";
import { BrandWebMark } from "../brand-web-mark";
import { CANONICAL_EDITION_FIGURES } from "./canonical-edition-figures";

export type PictogramPlateShape = "figure" | "post-image" | "thumbnail";

const POST_IMAGE_ASPECT_RATIO = 1200 / 630;

export function hasAnimatedPictogram(pictogramSlug: string | undefined): boolean {
  if (!pictogramSlug) return false;
  return pictogramSlug in CANONICAL_EDITION_FIGURES || isThreatIntelligencePictogramSlug(pictogramSlug);
}

function usePauseMotionWhileOffscreen() {
  const plateReference = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const plateElement = plateReference.current;
    if (!plateElement || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) plateElement.classList.toggle("figure-offscreen", !entry.isIntersecting);
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(plateElement);
    return () => observer.disconnect();
  }, []);
  return plateReference;
}

function LegacyAnimatedPictogram({
  pictogramSlug,
  accessibleDescription,
}: {
  pictogramSlug: ThreatIntelligencePictogramSlug;
  accessibleDescription: string;
}) {
  const motionTiming = usePictogramMotion(getThreatIntelligencePictogramPhaseOffset(pictogramSlug));
  const registryEntry = THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY[pictogramSlug];
  const RegisteredPictogram = registryEntry.render;
  return (
    <div
      className="pictogram-plate__legacy-canvas"
      style={{ "--legacy-pictogram-aspect-ratio": String(registryEntry.aspectRatio ?? 1) } as CSSProperties}
    >
      <RegisteredPictogram alt={accessibleDescription} palette={PICTOGRAM_PALETTE} timing={motionTiming} />
    </div>
  );
}

export function AnimatedPictogramPlate({
  pictogramSlug,
  accessibleDescription,
  shape = "figure",
  fallbackImageSource,
  priority = false,
}: {
  pictogramSlug?: string;
  accessibleDescription: string;
  shape?: PictogramPlateShape;
  fallbackImageSource?: string;
  priority?: boolean;
}) {
  const plateReference = usePauseMotionWhileOffscreen();
  const canonicalFigure = pictogramSlug ? CANONICAL_EDITION_FIGURES[pictogramSlug] : undefined;
  const plateAspectRatio = shape === "figure" ? canonicalFigure?.aspectRatio ?? 2 : POST_IMAGE_ASPECT_RATIO;
  const plateStyle = { "--pictogram-plate-aspect-ratio": String(plateAspectRatio) } as CSSProperties;

  let plateContent: ReactNode;
  if (canonicalFigure) {
    const CanonicalFigure = canonicalFigure.render;
    plateContent = <CanonicalFigure accessibleDescription={accessibleDescription || canonicalFigure.defaultAccessibleDescription} />;
  } else if (pictogramSlug && isThreatIntelligencePictogramSlug(pictogramSlug)) {
    plateContent = <LegacyAnimatedPictogram accessibleDescription={accessibleDescription} pictogramSlug={pictogramSlug} />;
  } else if (fallbackImageSource) {
    plateContent = (
      <img
        alt={accessibleDescription}
        className="pictogram-plate__image"
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        src={fallbackImageSource}
      />
    );
  } else {
    plateContent = (
      <span className="pictogram-plate__placeholder-mark">
        <BrandWebMark accessibleLabel={accessibleDescription} />
      </span>
    );
  }

  return (
    <div className={`figure-plate pictogram-plate pictogram-plate--${shape}`} ref={plateReference} style={plateStyle}>
      {plateContent}
    </div>
  );
}

export function AnimatedPictogramFigure({
  pictogramSlug,
  accessibleDescription,
  caption,
  figureNumberLabel,
  fallbackImageSource,
  priority = false,
  className = "",
}: {
  pictogramSlug?: string;
  accessibleDescription: string;
  caption?: string;
  figureNumberLabel?: string;
  fallbackImageSource?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure className={`pictogram-figure-block ${className}`.trim()}>
      <AnimatedPictogramPlate
        accessibleDescription={accessibleDescription}
        fallbackImageSource={fallbackImageSource}
        pictogramSlug={pictogramSlug}
        priority={priority}
      />
      {caption ? (
        <figcaption className="pictogram-figure-block__caption">
          {figureNumberLabel ? <span className="pictogram-figure-block__number">FIG {figureNumberLabel}</span> : null}
          <span>{caption}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
