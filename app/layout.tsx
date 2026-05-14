import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Papyrus",
  description: "A Pretext-powered responsive newspaper layout lab.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
