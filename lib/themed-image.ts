import type { ArticleImageThemeVariants } from "./articles";

export type ResolvedTheme = "light" | "dark";

export function resolveThemedImageSrc(
  src: string,
  themeVariants: ArticleImageThemeVariants | undefined,
  theme: ResolvedTheme,
): string {
  if (theme === "dark" && themeVariants?.dark?.src) return themeVariants.dark.src;
  if (theme === "dark") return resolveStaticDarkSvgFallback(src) ?? src;
  return src;
}

function resolveStaticDarkSvgFallback(src: string): string | null {
  if (src.startsWith("/seed-art/threat-intelligence/") && !src.endsWith("-dark.svg") && /\.svg(?:\?.*)?$/i.test(src)) {
    return src.replace(/\.svg(?:\?.*)?$/i, (suffix) => `-dark${suffix}`);
  }
  return null;
}
