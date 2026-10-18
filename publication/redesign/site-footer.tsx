import Link from "next/link";
import { BrandWebMark } from "./brand-web-mark";
import { ReaderAccountPill } from "./reader-account-pill";
import { PUBLICATION_TAGLINE } from "./publication-identity";
import type { SiteNavigationLink } from "./site-header";

export function SiteFooter({
  deskLinks,
  editionLineLeft,
  editionLineRight,
}: {
  deskLinks: SiteNavigationLink[];
  editionLineLeft?: string;
  editionLineRight?: string;
}) {
  return (
    <footer className="ti-site-footer">
      <div className="ti-site-footer__columns">
        <div className="ti-site-footer__about">
          <p className="ti-site-footer__brand">
            <BrandWebMark size={24} />
            <span>Anthus Threat Intelligence</span>
          </p>
          <p className="ti-site-footer__description">
            {PUBLICATION_TAGLINE}
            <br />
            Published by Anthus AI Solutions.
          </p>
        </div>
        <nav aria-label="Footer" className="ti-site-footer__links">
          {deskLinks.length > 0 ? (
            <ul className="ti-site-footer__desk-links">
              {deskLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="ti-site-footer__utility-links">
            <li>
              <Link href="/posts">Posts</Link>
            </li>
            <li>
              <Link href="/archive">Archive</Link>
            </li>
            <li>
              <Link href="/settings">Settings</Link>
            </li>
            <li>
              <ReaderAccountPill variant="link" />
            </li>
          </ul>
        </nav>
      </div>
      <p aria-hidden="true" className="ti-site-footer__wordmark">
        Threat Intelligence
      </p>
      {editionLineLeft || editionLineRight ? (
        <div className="ti-site-footer__edition-line">
          <span>{editionLineLeft}</span>
          <span>{editionLineRight}</span>
        </div>
      ) : null}
    </footer>
  );
}
