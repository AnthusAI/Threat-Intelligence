import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { APPLY_STORED_THEME_PREFERENCE_BEFORE_FIRST_PAINT_SCRIPT } from "./theme-preference";
import "./theme-tokens.css";
import "./reader-site.css";

const GEIST_FONT_STYLESHEET_HREF =
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap";

export function ReaderSiteShell({
  homeHref = "/",
  children,
}: {
  homeHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="ti-site">
      <script dangerouslySetInnerHTML={{ __html: APPLY_STORED_THEME_PREFERENCE_BEFORE_FIRST_PAINT_SCRIPT }} />
      <link href="https://fonts.googleapis.com" rel="preconnect" />
      <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
      <link href={GEIST_FONT_STYLESHEET_HREF} precedence="default" rel="stylesheet" />
      <a className="ti-skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="ti-container">
        <SiteHeader homeHref={homeHref} />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
