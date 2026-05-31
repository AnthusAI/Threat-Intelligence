import type { ArticleImageThemeVariants } from "./articles";

export type ResolvedTheme = "light" | "dark";

export function resolveThemedImageSrc(
  src: string,
  themeVariants: ArticleImageThemeVariants | undefined,
  theme: ResolvedTheme,
): string {
  if (theme === "dark" && themeVariants?.dark?.src) return themeVariants.dark.src;
  return src;
}
