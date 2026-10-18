"use client";

import { useEffect, useState } from "react";
import { readLocalReaderSettings, writeLocalReaderSettings } from "@anthusai/papyrus/components/reader-settings";
import {
  THEME_PREFERENCE_CHANGED_EVENT,
  THEME_PREFERENCE_CHOICES,
  THEME_PREFERENCE_STORAGE_KEY,
  isThemePreference,
  type ThemePreference,
} from "./theme-preference";

function readCurrentThemePreference(): ThemePreference {
  const attributeValue = document.documentElement.getAttribute("data-theme");
  return isThemePreference(attributeValue) ? attributeValue : "system";
}

function storeThemePreference(themePreference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference);
  } catch {}
  document.documentElement.setAttribute("data-theme", themePreference);
  try {
    writeLocalReaderSettings({ ...readLocalReaderSettings(), theme: themePreference });
  } catch {}
  window.dispatchEvent(new Event(THEME_PREFERENCE_CHANGED_EVENT));
}

function ThemePreferenceIcon({ themePreference }: { themePreference: ThemePreference }) {
  if (themePreference === "system") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
        <rect height="9" rx="1.5" width="12" x="2" y="2.5" />
        <path d="M5.5 14h5M8 11.5V14" strokeLinecap="round" />
      </svg>
    );
  }
  if (themePreference === "light") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
      <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
    </svg>
  );
}

export function ThemeSwitch({ showLabels = false, groupLabel = "Theme" }: { showLabels?: boolean; groupLabel?: string }) {
  const [selectedThemePreference, setSelectedThemePreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const synchronizeSelectedThemePreference = () => setSelectedThemePreference(readCurrentThemePreference());
    synchronizeSelectedThemePreference();
    window.addEventListener("storage", synchronizeSelectedThemePreference);
    window.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, synchronizeSelectedThemePreference);
    return () => {
      window.removeEventListener("storage", synchronizeSelectedThemePreference);
      window.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, synchronizeSelectedThemePreference);
    };
  }, []);

  return (
    <div aria-label={groupLabel} className={showLabels ? "ti-theme-switch ti-theme-switch--labelled" : "ti-theme-switch"} role="group">
      {THEME_PREFERENCE_CHOICES.map((choice) => (
        <button
          aria-label={showLabels ? undefined : `${choice.label} theme`}
          aria-pressed={selectedThemePreference === choice.value}
          className="ti-theme-switch__button"
          key={choice.value}
          onClick={() => {
            storeThemePreference(choice.value);
            setSelectedThemePreference(choice.value);
          }}
          title={`${choice.label} theme`}
          type="button"
        >
          <ThemePreferenceIcon themePreference={choice.value} />
          {showLabels ? <span>{choice.label}</span> : null}
        </button>
      ))}
    </div>
  );
}
