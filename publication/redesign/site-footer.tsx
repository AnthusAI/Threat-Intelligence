import Link from "next/link";
import { BrandWebMark } from "./brand-web-mark";
import { ReaderAccountPill } from "./reader-account-pill";
import { PUBLICATION_TAGLINE } from "./publication-identity";

export function SiteFooter() {
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
          <ul className="ti-site-footer__utility-links">
            <li>
              <Link href="/">Posts</Link>
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
    </footer>
  );
}
