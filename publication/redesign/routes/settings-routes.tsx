import type { Metadata } from "next";
import { PUBLICATION_NAME } from "../publication-identity";
import { ReaderAccountPill } from "../reader-account-pill";
import { ReaderSiteShell } from "../reader-site-shell";
import { ThemeSwitch } from "../theme-switch";

export const SETTINGS_METADATA: Metadata = {
  title: `Settings | ${PUBLICATION_NAME}`,
  description: `Reader theme and account settings for ${PUBLICATION_NAME}.`,
};

export function SettingsRoute() {
  return (
    <ReaderSiteShell>
      <section aria-labelledby="ti-settings-title" className="ti-page-intro">
        <p className="ti-kicker">
          <span className="ti-kicker__signal">Settings</span>
          <span>Reader preferences</span>
        </p>
        <h1 className="ti-page-intro__title" id="ti-settings-title">
          Settings
        </h1>
      </section>
      <div className="ti-settings">
        <section aria-labelledby="ti-settings-theme" className="ti-settings__row">
          <div className="ti-settings__copy">
            <h2 className="ti-settings__label" id="ti-settings-theme">
              Theme
            </h2>
            <p className="ti-settings__hint">System follows your device. Your choice applies on every page of the publication.</p>
          </div>
          <ThemeSwitch groupLabel="Theme" showLabels />
        </section>
        <section aria-labelledby="ti-settings-account" className="ti-settings__row">
          <div className="ti-settings__copy">
            <h2 className="ti-settings__label" id="ti-settings-account">
              Account
            </h2>
            <p className="ti-settings__hint">Editors and contributors sign in here to reach the newsroom.</p>
          </div>
          <ReaderAccountPill />
        </section>
      </div>
    </ReaderSiteShell>
  );
}
