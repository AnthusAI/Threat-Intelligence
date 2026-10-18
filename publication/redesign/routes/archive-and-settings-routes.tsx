import type { Metadata } from "next";
import Link from "next/link";
import { loadArchiveEditionPreviews } from "@anthusai/papyrus/lib/archive-data";
import { formatLongEditionDate } from "../edition-front-page-model";
import { ArrowIcon } from "../edition-front-page";
import { loadLatestEditionNavigation } from "../edition-navigation";
import { PUBLICATION_NAME } from "../publication-identity";
import { ReaderAccountPill } from "../reader-account-pill";
import { ReaderSiteShell } from "../reader-site-shell";
import { ThemeSwitch } from "../theme-switch";

export const ARCHIVE_METADATA: Metadata = {
  title: `Archive | ${PUBLICATION_NAME}`,
  description: `Every published edition of ${PUBLICATION_NAME}.`,
};

export const SETTINGS_METADATA: Metadata = {
  title: `Settings | ${PUBLICATION_NAME}`,
  description: `Reader theme and account settings for ${PUBLICATION_NAME}.`,
};

async function loadArchivePage(cursor: string | undefined) {
  try {
    return await loadArchiveEditionPreviews({ nextToken: cursor ?? null });
  } catch (error) {
    console.warn("Archive editions are unavailable.", error);
    return { previews: [], nextCursor: null };
  }
}

export async function ArchiveRoute({ cursor }: { cursor?: string }) {
  const [navigation, archivePage] = await Promise.all([loadLatestEditionNavigation(), loadArchivePage(cursor)]);
  return (
    <ReaderSiteShell deskLinks={navigation?.deskLinks ?? []}>
      <section aria-labelledby="ti-archive-title" className="ti-page-intro">
        <p className="ti-kicker">
          <span className="ti-kicker__signal">Archive</span>
          <span>Previous editions</span>
        </p>
        <h1 className="ti-page-intro__title" id="ti-archive-title">
          Archive
        </h1>
      </section>
      {archivePage.previews.length === 0 ? (
        <p className="ti-empty-state">No editions are available right now.</p>
      ) : (
        <ul className="ti-archive-list">
          {archivePage.previews.map((preview) => (
            <li key={preview.href}>
              <Link className="ti-archive-entry" href={preview.href}>
                <time className="ti-archive-entry__date" dateTime={preview.edition.editionDate}>
                  {preview.edition.editionDate.replace(/-/g, ".")}
                </time>
                <span className="ti-archive-entry__copy">
                  <span className="ti-archive-entry__title">Edition · {formatLongEditionDate(preview.edition.editionDate)}</span>
                  {preview.edition.description ? (
                    <span className="ti-archive-entry__description">{preview.edition.description}</span>
                  ) : null}
                </span>
                <ArrowIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {archivePage.nextCursor ? (
        <p className="ti-article__back">
          <Link className="ti-secondary-button" href={`/archive?cursor=${encodeURIComponent(archivePage.nextCursor)}`}>
            Older editions
          </Link>
        </p>
      ) : null}
    </ReaderSiteShell>
  );
}

export async function SettingsRoute() {
  const navigation = await loadLatestEditionNavigation();
  return (
    <ReaderSiteShell deskLinks={navigation?.deskLinks ?? []}>
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
