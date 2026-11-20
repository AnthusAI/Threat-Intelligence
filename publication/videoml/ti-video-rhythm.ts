/** Video canvas rhythm: 24px rows on the 720px-tall 1280×720 frame (30 rows). */

export const TI_VIDEO_RHYTHM_UNIT = 6;
export const TI_VIDEO_COPY_ROW_MULTIPLE = 4;
export const TI_VIDEO_ROW_HEIGHT = TI_VIDEO_RHYTHM_UNIT * TI_VIDEO_COPY_ROW_MULTIPLE;
export const TI_VIDEO_PAINT_BUFFER = 3;

export function tiVideoRows(rows: number): number {
  return rows * TI_VIDEO_ROW_HEIGHT;
}

export const TI_VIDEO_LAYOUT = {
  padding: tiVideoRows(4),
  gap: tiVideoRows(1),
  columnGap: tiVideoRows(2),
  eyebrowSize: tiVideoRows(1),
  titleSize: tiVideoRows(3),
  titleSizeBriefing: tiVideoRows(2),
  titleSizeTeaser: tiVideoRows(2),
  subtitleSize: tiVideoRows(1),
  subtitleSizeClosing: tiVideoRows(2),
  closingTitleSize: tiVideoRows(4),
  pictogramSize: tiVideoRows(18),
  pictogramSizeBriefing: tiVideoRows(15),
  pictogramSizeEdition: tiVideoRows(18),
  titleLineHeight: tiVideoRows(3),
  subtitleLineHeight: tiVideoRows(2),
  eyebrowRuleHeight: tiVideoRows(1),
  eyebrowMarginBottom: tiVideoRows(1),
} as const;

export function tiVideoRhythmCssVars(): Record<string, string> {
  return {
    "--ti-rhythm": `${TI_VIDEO_RHYTHM_UNIT}px`,
    "--ti-row-height": `${TI_VIDEO_ROW_HEIGHT}px`,
    "--ti-paint-buffer": `${TI_VIDEO_PAINT_BUFFER}px`,
    "--ti-paint-height": `${TI_VIDEO_ROW_HEIGHT + TI_VIDEO_PAINT_BUFFER}px`,
  };
}
