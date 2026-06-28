"use client";

import { SITE_BRAND } from "../lib/site-brand";

export function BlogPageBackground() {
  if (SITE_BRAND.id !== "threat-intelligence") return null;

  return <div aria-hidden="true" className="blog-page-background" data-blog-page-background="true" />;
}
