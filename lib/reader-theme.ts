export type ReaderThemeSetting = "system" | "light" | "dark";

export function applyReaderTheme(theme: ReaderThemeSetting) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.papyrusTheme = theme;
  applyReaderThemeClass(theme);
  updateThemeMeta(theme);
}

function updateThemeMeta(theme: ReaderThemeSetting) {
  const colorScheme = theme === "dark" ? "dark" : theme === "light" ? "light" : "light dark";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"][data-papyrus-theme-meta="true"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "color-scheme";
    meta.setAttribute("data-papyrus-theme-meta", "true");
    document.head.appendChild(meta);
  }
  meta.content = colorScheme;
}

function applyReaderThemeClass(theme: ReaderThemeSetting) {
  if (typeof document === "undefined") return;
  const isDark = resolveReaderThemeIsDark(theme);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("dark-theme", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.classList.toggle("light-theme", !isDark);
}

function resolveReaderThemeIsDark(theme: ReaderThemeSetting) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
