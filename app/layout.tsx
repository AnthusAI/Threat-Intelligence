import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import Script from "next/script";
import { AmplifyClientProvider } from "../components/amplify-client-provider";
import "./globals.css";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Papyrus",
  description: "A Pretext-powered responsive newspaper layout lab.",
  icons: {
    icon: [
      { url: "/icon-light.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={playfairDisplay.variable}>
        <Script id="papyrus-favicon-color-scheme" strategy="beforeInteractive">
          {`(() => {
  const lightHref = "/icon-light.svg";
  const darkHref = "/icon-dark.svg";

  const getLink = () => {
    const existing = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (existing) return existing;
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
    return link;
  };

  const iconLink = getLink();
  const apply = (isDark) => {
    iconLink.href = isDark ? darkHref : lightHref;
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
