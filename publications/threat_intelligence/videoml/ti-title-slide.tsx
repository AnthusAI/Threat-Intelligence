import React from "react";
import { ThreatIntelligencePictogramVideo } from "./pictogram-video";
import { TI_VIDEO_LAYOUT, tiVideoRows } from "./ti-video-rhythm";

export type TiTitleSlideProps = Record<string, unknown> & {
  pictogramSlug?: string;
  pictogramSize?: number;
  frame?: number;
  fps?: number;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  mastheadEyebrow?: string;
  titleWordSplit?: boolean;
  horizontalAlign?: "left" | "center";
  verticalAlign?: "top" | "center" | "bottom";
  titleSize?: number;
  subtitleSize?: number;
  titleColor?: string;
  titleWeight?: number;
  eyebrowWeight?: number;
  eyebrowLetterSpacing?: number;
  eyebrowSize?: number;
  eyebrowRule?: boolean;
  padding?: number;
  gap?: number;
  columnGap?: number;
  titleLineHeight?: number;
  subtitleLineHeight?: number;
  secondaryPictogramSlug?: string;
  secondaryPictogramDelaySec?: number;
};

const fontHeadline = "var(--font-headline, Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif)";
const fontSubhead = "var(--font-subhead, Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif)";
const fontEyebrow = "var(--font-eyebrow, Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif)";

function EyebrowWithRules({
  label,
  letterSpacing,
  weight,
  fontSize = TI_VIDEO_LAYOUT.eyebrowSize,
  ruleHeight = TI_VIDEO_LAYOUT.eyebrowRuleHeight,
  marginBottom = TI_VIDEO_LAYOUT.eyebrowMarginBottom,
}: {
  label: string;
  letterSpacing: number;
  weight: number;
  fontSize?: number;
  ruleHeight?: number;
  marginBottom?: number;
}) {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 12, marginBottom, width: "100%" }}>
      <div style={{ background: "var(--ti-alarm-red)", flex: 1, height: ruleHeight, minWidth: ruleHeight }} />
      <span
        style={{
          background: "var(--background, #111110)",
          color: "var(--ti-headline-color, var(--foreground-strong, #eeeeec))",
          fontFamily: fontEyebrow,
          fontSize,
          fontStyle: "normal",
          fontWeight: weight,
          letterSpacing: `${letterSpacing}em`,
          lineHeight: `${ruleHeight}px`,
          padding: "0 6px",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div style={{ background: "var(--ti-alarm-red)", flex: 1, height: ruleHeight, minWidth: ruleHeight }} />
    </div>
  );
}

function PlainEyebrow({
  label,
  letterSpacing,
  weight,
  marginBottom = TI_VIDEO_LAYOUT.eyebrowMarginBottom,
}: {
  label: string;
  letterSpacing: number;
  weight: number;
  marginBottom?: number;
}) {
  return (
    <p
      style={{
        color: "var(--ti-headline-color, var(--foreground-strong, #eeeeec))",
        fontFamily: fontEyebrow,
        fontSize: TI_VIDEO_LAYOUT.eyebrowSize,
        fontStyle: "normal",
        fontWeight: weight,
        letterSpacing: `${letterSpacing}em`,
        lineHeight: `${TI_VIDEO_LAYOUT.eyebrowRuleHeight}px`,
        margin: `0 0 ${marginBottom}px`,
        textTransform: "uppercase",
      }}
    >
      {label}
    </p>
  );
}

function splitMastheadEyebrow(text: string): { lead: string; rest: string } {
  const trimmed = text.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return { lead: trimmed, rest: "" };
  }
  return { lead: trimmed.slice(0, firstSpace), rest: trimmed.slice(firstSpace + 1) };
}

/** Blog masthead eyebrow: strong lead word + muted remainder. */
function MastheadEyebrow({
  label,
  marginBottom = tiVideoRows(1),
}: {
  label: string;
  marginBottom?: number;
}) {
  const { lead, rest } = splitMastheadEyebrow(label);

  return (
    <p
      style={{
        fontFamily: fontEyebrow,
        fontSize: TI_VIDEO_LAYOUT.eyebrowSize,
        fontStyle: "normal",
        fontWeight: 900,
        letterSpacing: "0.09em",
        lineHeight: `${tiVideoRows(2)}px`,
        margin: `0 0 ${marginBottom}px`,
        textTransform: "uppercase",
      }}
    >
      <span style={{ color: "var(--ti-headline-color, var(--foreground-strong, #eeeeec))" }}>{lead}</span>
      {rest ? (
        <span style={{ color: "var(--ti-body-color, var(--color-text-muted, #b5b3ad))" }}> {rest}</span>
      ) : null}
    </p>
  );
}

function SplitTitle({
  title,
  titleColor,
  titleSize,
  titleWeight,
  titleLineHeight,
  wordGap = tiVideoRows(1),
}: {
  title: string;
  titleColor: string;
  titleSize: number;
  titleWeight: number;
  titleLineHeight: number;
  wordGap?: number;
}) {
  const words = title.trim().split(/\s+/).filter(Boolean);

  return (
    <h1
      style={{
        color: titleColor,
        display: "grid",
        fontFamily: fontHeadline,
        fontSize: titleSize,
        fontStyle: "normal",
        fontWeight: titleWeight,
        gap: wordGap,
        lineHeight: `${titleLineHeight}px`,
        margin: 0,
      }}
    >
      {words.map((word) => (
        <span key={word} style={{ display: "block" }}>
          {word}
        </span>
      ))}
    </h1>
  );
}

export function TiTitleSlide(props: TiTitleSlideProps) {
  const {
    pictogramSlug,
    pictogramSize = TI_VIDEO_LAYOUT.pictogramSize,
    frame = 0,
    fps = 30,
    title = "",
    subtitle,
    eyebrow,
    mastheadEyebrow,
    titleWordSplit = false,
    horizontalAlign = "left",
    verticalAlign = "center",
    titleSize = TI_VIDEO_LAYOUT.titleSize,
    subtitleSize = TI_VIDEO_LAYOUT.subtitleSize,
    titleColor,
    titleWeight = 900,
    eyebrowWeight = 900,
    eyebrowLetterSpacing = 0.09,
    eyebrowSize = TI_VIDEO_LAYOUT.eyebrowSize,
    eyebrowRule = false,
    padding = TI_VIDEO_LAYOUT.padding,
    gap = TI_VIDEO_LAYOUT.gap,
    columnGap = TI_VIDEO_LAYOUT.columnGap,
    titleLineHeight = TI_VIDEO_LAYOUT.titleLineHeight,
    subtitleLineHeight = TI_VIDEO_LAYOUT.subtitleLineHeight,
    secondaryPictogramSlug,
    secondaryPictogramDelaySec,
  } = props;

  const resolvedTitleColor = titleColor || "var(--ti-headline-color, var(--foreground-strong, #eeeeec))";
  const resolvedSubtitleColor = "var(--ti-body-color, var(--color-text-muted, #b5b3ad))";
  const resolvedTitleSize = Number(titleSize);
  const resolvedTitleWeight = Number(titleWeight);
  const resolvedTitleLineHeight = Number(titleLineHeight);

  const mastheadEyebrowNode = mastheadEyebrow ? (
    <MastheadEyebrow label={String(mastheadEyebrow)} marginBottom={tiVideoRows(1)} />
  ) : null;

  const titleNode = titleWordSplit ? (
    <SplitTitle
      title={String(title)}
      titleColor={resolvedTitleColor}
      titleLineHeight={resolvedTitleLineHeight}
      titleSize={resolvedTitleSize}
      titleWeight={resolvedTitleWeight}
      wordGap={tiVideoRows(1)}
    />
  ) : (
    <h1
      style={{
        color: resolvedTitleColor,
        fontFamily: fontHeadline,
        fontSize: resolvedTitleSize,
        fontStyle: "normal",
        fontWeight: resolvedTitleWeight,
        lineHeight: `${resolvedTitleLineHeight}px`,
        margin: 0,
      }}
    >
      {title}
    </h1>
  );

  let logo: React.ReactNode = null;
  if (pictogramSlug) {
    let slideProgress = 1;
    if (secondaryPictogramSlug && secondaryPictogramDelaySec != null) {
      const delayFrames = Number(secondaryPictogramDelaySec) * Number(fps);
      const slideDurationFrames = Number(fps) * 0.8;
      if (Number(frame) < delayFrames) {
        slideProgress = 0;
      } else {
        slideProgress = Math.min(1, (Number(frame) - delayFrames) / slideDurationFrames);
      }
    }
    const easeOut = 1 - Math.pow(1 - slideProgress, 3);
    
    const gapOffset = tiVideoRows(1); // 24px default gap
    const initialTranslateX = (Number(pictogramSize) + gapOffset) / 2;

    logo = (
      <div
        style={{
          position: "relative",
          width: Number(pictogramSize),
          height: Number(pictogramSize),
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: secondaryPictogramSlug ? `translateX(${-(easeOut) * initialTranslateX}px)` : undefined,
          }}
        >
          <ThreatIntelligencePictogramVideo
            alt={typeof title === "string" ? title : String(pictogramSlug)}
            frame={Number(frame)}
            fps={Number(fps)}
            size={Number(pictogramSize)}
            slug={String(pictogramSlug)}
          />
        </div>
        {secondaryPictogramSlug ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              opacity: easeOut,
              transform: `translateX(${easeOut * initialTranslateX + (1 - easeOut) * (initialTranslateX + 100)}px)`,
            }}
          >
            <ThreatIntelligencePictogramVideo
              alt={typeof title === "string" ? title : String(secondaryPictogramSlug)}
              frame={Number(frame)}
              fps={Number(fps)}
              size={Number(pictogramSize)}
              slug={String(secondaryPictogramSlug)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const eyebrowNode =
    eyebrow && eyebrowRule ? (
      <EyebrowWithRules
        label={String(eyebrow)}
        letterSpacing={Number(eyebrowLetterSpacing)}
        weight={Number(eyebrowWeight)}
        fontSize={Number(eyebrowSize)}
      />
    ) : eyebrow ? (
      <PlainEyebrow label={String(eyebrow)} letterSpacing={Number(eyebrowLetterSpacing)} weight={Number(eyebrowWeight)} />
    ) : null;

  const textColumn = (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
      {mastheadEyebrowNode}
      {eyebrowNode}
      {titleNode}
      {subtitle ? (
        <p
          style={{
            color: resolvedSubtitleColor,
            fontFamily: fontSubhead,
            fontSize: Number(subtitleSize),
            fontStyle: "normal",
            fontWeight: 400,
            lineHeight: `${Number(subtitleLineHeight)}px`,
            margin: `${gap}px 0 0`,
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );

  const justifyContent =
    verticalAlign === "top" ? "flex-start" : verticalAlign === "bottom" ? "flex-end" : "center";

  const outerStyle: React.CSSProperties = {
    alignItems: horizontalAlign === "left" && logo ? "center" : "stretch",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: horizontalAlign === "left" && logo ? "row" : "column",
    gap: horizontalAlign === "left" && logo ? columnGap : 0,
    height: "100%",
    justifyContent,
    padding,
    width: "100%",
  };

  if (horizontalAlign === "center") {
    return (
      <div style={{ ...outerStyle, alignItems: "center", textAlign: "center" }}>
        <div style={{ maxWidth: tiVideoCenterMaxWidth(padding), width: "100%" }}>
          {mastheadEyebrowNode}
          {eyebrowNode}
          {titleNode}
          {subtitle ? (
            <p
              style={{
                color: resolvedSubtitleColor,
                fontFamily: fontSubhead,
                fontSize: Number(subtitleSize),
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: `${Number(subtitleLineHeight)}px`,
                margin: `${gap}px auto 0`,
                maxWidth: tiVideoCenterMaxWidth(padding) - padding * 2,
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      {logo}
      {textColumn}
    </div>
  );
}

function tiVideoCenterMaxWidth(padding: number): number {
  return 1280 - padding * 2;
}
