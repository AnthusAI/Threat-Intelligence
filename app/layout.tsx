import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import { AmplifyClientProvider } from "../components/amplify-client-provider";
import "./globals.css";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
});

const faviconVersion = "20260517-1";

export const metadata: Metadata = {
  title: "Papyrus",
  description: "A Pretext-powered responsive newspaper layout lab.",
  icons: {
    icon: [
      { url: `/icon-light.png?v=${faviconVersion}`, type: "image/png" },
      { url: `/icon.png?v=${faviconVersion}`, type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={playfairDisplay.variable}>
        <Script id="papyrus-favicon-color-scheme" strategy="beforeInteractive">
          {`(() => {
  const version = "${faviconVersion}";
  const lightHref = "/icon-light.png?v=" + version;
  const darkHref = "/icon-dark.png?v=" + version;

  const getLink = () => {
    const existingTagged = document.querySelector('link[rel="icon"][data-papyrus-theme-icon="true"]');
    if (existingTagged) return existingTagged;

    const existingPng = document.querySelector('link[rel="icon"][type="image/png"]');
    if (existingPng) {
      existingPng.setAttribute("data-papyrus-theme-icon", "true");
      return existingPng;
    }

    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.setAttribute("data-papyrus-theme-icon", "true");
    document.head.appendChild(link);
    return link;
  };

  const iconLink = getLink();
  const apply = (isDark) => {
    const nextHref = isDark ? darkHref : lightHref;
    if (iconLink.getAttribute("href") !== nextHref) {
      iconLink.setAttribute("href", nextHref);
    }
  };

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  apply(media.matches);

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", (event) => apply(event.matches));
  } else if (typeof media.addListener === "function") {
    media.addListener((event) => apply(event.matches));
  }
})();`}
        </Script>
        <AmplifyClientProvider>{children}</AmplifyClientProvider>
      </body>
    </html>
  );
}
