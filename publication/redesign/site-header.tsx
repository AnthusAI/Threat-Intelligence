import Link from "next/link";
import { BrandWebMark } from "./brand-web-mark";
import { ReaderAccountPill } from "./reader-account-pill";
import { ThemeSwitch } from "./theme-switch";

export type SiteNavigationLink = { label: string; href: string };

export const PUBLICATION_UTILITY_LINKS: SiteNavigationLink[] = [
  { label: "Posts", href: "/posts" },
  { label: "Archive", href: "/archive" },
];

export function SiteHeader({ deskLinks, homeHref = "/" }: { deskLinks: SiteNavigationLink[]; homeHref?: string }) {
  const primaryLinks = [...deskLinks, ...PUBLICATION_UTILITY_LINKS];
  return (
    <header className="ti-site-header">
      <Link aria-label="Anthus AI Solutions, Threat Intelligence home" className="ti-site-header__brand" href={homeHref}>
        <BrandWebMark />
        <span className="ti-site-header__brand-strong">Anthus</span>
        <span className="ti-site-header__brand-muted">AI Solutions</span>
      </Link>
      <div className="ti-site-header__actions">
        <nav aria-label="Desks" className="ti-site-header__navigation ti-wide-only">
          {primaryLinks.map((link) => (
            <Link className="ti-site-header__navigation-link" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="ti-wide-only">
          <ReaderAccountPill />
        </span>
        <ThemeSwitch />
        <details className="ti-site-header__menu ti-narrow-only">
          <summary className="ti-site-header__menu-toggle">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
            </svg>
            <span>Menu</span>
          </summary>
          <nav aria-label="Desks" className="ti-site-header__menu-panel">
            {primaryLinks.map((link) => (
              <Link className="ti-site-header__menu-link" href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
            <ReaderAccountPill variant="link" />
          </nav>
        </details>
      </div>
    </header>
  );
}
