/**
 * Threat Intelligence body-text font (pairs with Inter 900 headlines).
 */

import { IBM_Plex_Serif } from "next/font/google";

export const tiBodyFont = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-body",
});

/** Family stack for Pretext measurement and CSS fallbacks. */
export const TI_BODY_FONT_FAMILY =
  `${tiBodyFont.style.fontFamily}, Georgia, "Times New Roman", serif`;
