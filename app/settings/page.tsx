import { SETTINGS_METADATA, SettingsRoute } from "@/publication/redesign/routes/archive-and-settings-routes";

export const dynamic = "force-dynamic";

export const metadata = SETTINGS_METADATA;

export default function SettingsPage() {
  return <SettingsRoute />;
}
