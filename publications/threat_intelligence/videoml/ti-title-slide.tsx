import React from "react";
import { ThreatIntelligencePictogramVideo } from "./pictogram-video";
import { TI_VIDEO_LAYOUT } from "./ti-video-rhythm";

export type TiTitleSlideProps = Record<string, unknown> & {
  pictogramSlug?: string;
  pictogramSize?: number;
  frame?: number;
  fps?: number;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
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
          background: "var(--background, #191918)",
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

export function TiTitleSlide(props: TiTitleSlideProps) {
  const {
    pictogramSlug,
    pictogramSize = TI_VIDEO_LAYOUT.pictogramSize,
    frame = 0,
    fps = 30,
    title = "",
    subtitle,
    eyebrow,
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
  } = props;

  const resolvedTitleColor = titleColor || "var(--ti-headline-color, var(--foreground-strong, #eeeeec))";
  const resolvedSubtitleColor = "var(--ti-body-color, var(--color-text-muted, #b5b3ad))";

  const logo = pictogramSlug ? (
    <ThreatIntelligencePictogramVideo
      alt={typeof title === "string" ? title : String(pictogramSlug)}
      frame={Number(frame)}
      fps={Number(fps)}
      size={Number(pictogramSize)}
      slug={String(pictogramSlug)}
    />
  ) : null;

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
      {eyebrowNode}
      <h1
        style={{
          color: resolvedTitleColor,
          fontFamily: fontHeadline,
          fontSize: Number(titleSize),
          fontStyle: "normal",
          fontWeight: Number(titleWeight),
          lineHeight: `${Number(titleLineHeight)}px`,
          margin: 0,
        }}
      >
        {title}
      </h1>
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
          {eyebrowNode}
          <h1
            style={{
              color: resolvedTitleColor,
              fontFamily: fontHeadline,
              fontSize: Number(titleSize),
              fontStyle: "normal",
              fontWeight: Number(titleWeight),
              lineHeight: `${Number(titleLineHeight)}px`,
              margin: 0,
            }}
          >
            {title}
          </h1>
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
