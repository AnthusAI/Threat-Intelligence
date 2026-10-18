export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCE_STORAGE_KEY = "anthus-threat-intelligence-theme";
export const PAPYRUS_READER_SETTINGS_STORAGE_KEY = "papyrus:reader-settings";
export const THEME_PREFERENCE_CHANGED_EVENT = "anthus-threat-intelligence-theme-changed";

export const THEME_PREFERENCE_CHOICES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export const APPLY_STORED_THEME_PREFERENCE_BEFORE_FIRST_PAINT_SCRIPT = `(() => {
  const readStoredThemePreference = () => {
    try {
      const stored = window.localStorage.getItem(${JSON.stringify(THEME_PREFERENCE_STORAGE_KEY)});
      if (stored === "system" || stored === "light" || stored === "dark") return stored;
      const papyrusSettings = JSON.parse(window.localStorage.getItem(${JSON.stringify(PAPYRUS_READER_SETTINGS_STORAGE_KEY)}) || "null");
      const papyrusTheme = papyrusSettings && papyrusSettings.theme;
      if (papyrusTheme === "system" || papyrusTheme === "light" || papyrusTheme === "dark") return papyrusTheme;
    } catch (error) {}
    return "system";
  };
  const applyThemePreference = () => {
    document.documentElement.setAttribute("data-theme", readStoredThemePreference());
  };
  applyThemePreference();
  window.addEventListener("storage", applyThemePreference);
  window.addEventListener(${JSON.stringify(THEME_PREFERENCE_CHANGED_EVENT)}, applyThemePreference);
})();`;
