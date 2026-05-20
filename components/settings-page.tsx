"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReaderAuthControl } from "./reader-auth-control";
import { loadReaderSessionSnapshot, type ReaderAuthSnapshot } from "./reader-auth-state";
import {
  DEFAULT_READER_SETTINGS,
  PRESENTATION_OPTIONS,
  THEME_OPTIONS,
  applyReaderTheme,
  readLocalReaderSettings,
  resolveReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
  type ReaderSettingsSource,
} from "./reader-settings";

type SaveStatus =
  | { state: "loading"; message: string }
  | { state: "saved"; message: string }
  | { state: "error"; message: string };

export function SettingsPage() {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [authState, setAuthState] = useState<ReaderAuthSnapshot>({ status: "loading", label: "Checking sign-in" });
  const [source, setSource] = useState<ReaderSettingsSource>("local");
  const [status, setStatus] = useState<SaveStatus>({ state: "loading", message: "Loading settings" });
  const [pending, setPending] = useState(false);
  const userEditedRef = useRef(false);

  const refreshSettings = useCallback(async () => {
    userEditedRef.current = false;
    const localSettings = readLocalReaderSettings();
    setSettings(localSettings);
    applyReaderTheme(localSettings.theme);
    setSource("local");
    setStatus({ state: "saved", message: "Saved in this browser" });
    try {
      const [session, resolution] = await Promise.all([
        loadReaderSessionSnapshot(),
        resolveReaderSettings(),
      ]);
      setAuthState(session.auth);
      if (userEditedRef.current) return;
      setSettings(resolution.settings);
      setSource(resolution.source);
      applyReaderTheme(resolution.settings.theme);
      setStatus({
        state: "saved",
        message: resolution.source === "cloud" ? "Synced to your account" : "Saved in this browser",
      });
    } catch {
      const localSettings = readLocalReaderSettings();
      setSettings(localSettings);
      applyReaderTheme(localSettings.theme);
      setStatus({ state: "error", message: "Settings sync failed. Browser settings are still active." });
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const updateSettings = async (nextSettings: ReaderSettings) => {
    userEditedRef.current = true;
    setSettings(nextSettings);
    applyReaderTheme(nextSettings.theme);
    setPending(true);
    setStatus({ state: "loading", message: "Saving settings" });
    try {
      const resolution = await saveReaderSettings(nextSettings);
      setSettings(resolution.settings);
      setSource(resolution.source);
      const session = await loadReaderSessionSnapshot();
      setAuthState(session.auth);
      setStatus({
        state: "saved",
        message: resolution.source === "cloud" ? "Synced to your account" : "Saved in this browser",
      });
    } catch {
      setStatus({ state: "error", message: "Cloud sync failed. Browser settings were saved." });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link className="settings-header__home" href="/">Papyrus</Link>
        <div className="settings-header__auth">
          <ReaderAuthControl authState={authState} showIdentity />
        </div>
      </header>

      <section className="settings-panel" aria-labelledby="reader-settings-title">
        <p className="settings-panel__eyebrow">Reader Settings</p>
        <h1 id="reader-settings-title">Settings</h1>
        <div className="settings-status" data-settings-state={status.state} aria-live="polite">
          <span>{status.message}</span>
          {status.state === "error" ? (
            <button className="settings-status__retry" onClick={() => void refreshSettings()} type="button">
              Retry
            </button>
          ) : null}
        </div>

        <section className="settings-section" aria-labelledby="settings-format-title">
          <div className="settings-section__heading">
            <p id="settings-format-title">Format</p>
            <span>{source === "cloud" ? "Account preference" : "Browser preference"}</span>
          </div>
          <div className="format-triptych" role="radiogroup" aria-labelledby="settings-format-title">
            {PRESENTATION_OPTIONS.map((option) => {
              const selected = settings.presentation === option.value;
              return (
                <button
                  aria-checked={selected}
                  className="format-card"
                  data-selected={selected ? "true" : "false"}
                  disabled={pending}
                  key={option.value}
                  onClick={() => void updateSettings({ ...settings, presentation: option.value })}
                  role="radio"
                  type="button"
                >
                  <span className="format-card__label">{option.label}</span>
                  <span className="format-card__description">{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-theme-title">
          <div className="settings-section__heading">
            <p id="settings-theme-title">Theme</p>
            <span>Display preference</span>
          </div>
          <div className="theme-control" role="radiogroup" aria-labelledby="settings-theme-title">
            {THEME_OPTIONS.map((option) => {
              const selected = settings.theme === option.value;
              return (
                <button
                  aria-checked={selected}
                  className="theme-control__button"
                  data-selected={selected ? "true" : "false"}
                  disabled={pending}
                  key={option.value}
                  onClick={() => void updateSettings({ ...settings, theme: option.value })}
                  role="radio"
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
