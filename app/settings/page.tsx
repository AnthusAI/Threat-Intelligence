import type { Metadata } from "next";
import { SettingsPage } from "../../components/settings-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings | Papyrus",
  description: "Reader presentation and theme settings for Papyrus.",
};

export default function Settings() {
  return <SettingsPage />;
}
