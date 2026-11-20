import React, { useMemo } from "react";
import { TI_VIDEO_LAYOUT, tiVideoRows } from "./ti-video-rhythm";

export type TiQuoteCardProps = Record<string, unknown> & {
  quote: string;
  attribution?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  padding?: number;
  maxWidth?: number;
  quoteSize?: number;
  quoteLineHeight?: number;
  attributionSize?: number;
};

const fontQuote = "var(--font-headline, Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif)";
const fontAttribution = "var(--font-eyebrow, Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif)";

const QUOTE_CANVAS_HEIGHT = 720;
const QUOTE_CANVAS_WIDTH = 1280;

/** Rough chars-per-line at a given font size on the 1280px canvas. */
function estimateCharsPerLine(fontSize: number, maxWidth: number): number {
  const averageCharWidth = fontSize * 0.52;
  return Math.max(18, Math.floor(maxWidth / averageCharWidth));
}

export function resolveTiQuoteTypography(
  quote: string,
  maxTextWidth: number,
  large = false,
): { fontSize: number; lineHeight: number } {
  const length = quote.trim().length;
  const maxQuoteBlockHeight = large ? tiVideoRows(14) : tiVideoRows(11);

  const candidates = [
    ...(length <= 45 ? [{ fontSize: tiVideoRows(3), lineHeight: tiVideoRows(4) }] : []),
    { fontSize: tiVideoRows(2), lineHeight: tiVideoRows(3) },
    { fontSize: tiVideoRows(1), lineHeight: tiVideoRows(2) },
  ];

  for (const candidate of candidates) {
    const lines = Math.ceil(length / estimateCharsPerLine(candidate.fontSize, maxTextWidth));
    if (lines * candidate.lineHeight <= maxQuoteBlockHeight) {
      return candidate;
    }
  }

  return { fontSize: tiVideoRows(1), lineHeight: tiVideoRows(2) };
}

export function TiQuoteCard(props: TiQuoteCardProps) {
  const {
    quote,
    attribution,
    accentColor = "var(--ti-alarm-red)",
    backgroundColor = "var(--color-surface, #111110)",
    textColor = "var(--ti-headline-color, var(--foreground-strong, #eeeeec))",
    padding = TI_VIDEO_LAYOUT.padding,
    maxWidth = QUOTE_CANVAS_WIDTH - TI_VIDEO_LAYOUT.padding * 2,
    quoteSize,
    quoteLineHeight,
    attributionSize = TI_VIDEO_LAYOUT.eyebrowSize,
  } = props;

  const innerPadding = tiVideoRows(2);
  const textGutter = tiVideoRows(1);
  const accentWidth = tiVideoRows(2);
  const maxTextWidth = maxWidth - innerPadding - textGutter - accentWidth;

  const typography = useMemo(
    () => resolveTiQuoteTypography(String(quote ?? ""), maxTextWidth, !attribution),
    [maxTextWidth, quote, attribution],
  );

  const resolvedQuoteSize = quoteSize ?? typography.fontSize;
  const resolvedQuoteLineHeight = quoteLineHeight ?? typography.lineHeight;

  return (
    <div
      style={{
        alignItems: "center",
        boxSizing: "border-box",
        display: "flex",
        height: QUOTE_CANVAS_HEIGHT,
        justifyContent: "center",
        padding,
        position: "absolute",
        inset: 0,
        width: QUOTE_CANVAS_WIDTH,
      }}
    >
      <div
        style={{
          background: backgroundColor,
          borderRadius: 0,
          boxSizing: "border-box",
          color: textColor,
          maxWidth,
          padding: `${innerPadding}px ${innerPadding}px ${innerPadding}px 0`,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: accentColor,
            bottom: 0,
            left: 0,
            position: "absolute",
            top: 0,
            width: accentWidth,
          }}
        />
        <div
          style={{
            fontFamily: fontQuote,
            fontSize: resolvedQuoteSize,
            fontStyle: "normal",
            fontWeight: 700,
            letterSpacing: -0.02,
            lineHeight: `${resolvedQuoteLineHeight}px`,
            paddingLeft: textGutter + accentWidth,
            whiteSpace: "pre-wrap",
          }}
        >
          “{quote}”
        </div>
        {attribution ? (
          <div
            style={{
              color: "var(--ti-body-color, var(--color-text-muted, #b5b3ad))",
              fontFamily: fontAttribution,
              fontSize: attributionSize,
              fontStyle: "normal",
              fontWeight: 600,
              letterSpacing: "0.09em",
              lineHeight: `${TI_VIDEO_LAYOUT.subtitleLineHeight}px`,
              marginTop: TI_VIDEO_LAYOUT.gap,
              paddingLeft: textGutter + accentWidth,
              textTransform: "uppercase",
            }}
          >
            — {attribution}
          </div>
        ) : null}
      </div>
    </div>
  );
}
