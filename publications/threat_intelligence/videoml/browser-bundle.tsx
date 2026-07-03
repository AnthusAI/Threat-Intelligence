import type React from "react";
import { TiTitleSlide } from "./ti-title-slide";
import { TiQuoteCard } from "./ti-quote-card";

import "babulus-browser-bundle";

declare global {
  interface Window {
    Babulus?: {
      registerComponent: (name: string, component: React.ComponentType<Record<string, unknown>>) => void;
    };
  }
}

// The video render path uses a standalone Playwright HTML shell (no Next.js
// context), so next/font is unavailable. Inject a Google Fonts <link> to load
// Inter at the weights the title slides need (400 for subhead, 900 for
// headline/eyebrow). The shell already loads React from unpkg CDN, so internet
// access is available during rendering.
if (typeof document !== "undefined" && !document.querySelector("link[data-inter-font]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap";
  link.setAttribute("data-inter-font", "true");
  document.head.appendChild(link);
}

const babulus = window.Babulus;
if (!babulus?.registerComponent) {
  throw new Error("Babulus browser bundle did not initialize window.Babulus.registerComponent.");
}

const registerTiComponent = <Props extends Record<string, unknown>>(
  name: string,
  component: React.ComponentType<Props>,
) => {
  babulus.registerComponent(name, component as React.ComponentType<Record<string, unknown>>);
};

registerTiComponent("TiTitleSlide", TiTitleSlide);
registerTiComponent("TiQuoteCard", TiQuoteCard);
