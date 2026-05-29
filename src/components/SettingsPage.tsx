import type { UplinkSettings } from "../types";
import type { PersonaProfile } from "../storage/personaProfile";
import { UplinkSettingsPanel } from "./UplinkSettingsPanel";

interface SettingsPageProps {
  settings: UplinkSettings;
  onChange: (settings: UplinkSettings) => void;
  personaProfile: PersonaProfile;
  onPersonaChange: (profile: PersonaProfile) => void;
  onClose: () => void;
}

export function SettingsPage({ settings, onChange, personaProfile, onPersonaChange }: SettingsPageProps) {
  return (
    <main
      className="cinema-shell settings-route-shell"
      data-theme={settings.visual.theme}
      data-font={settings.visual.fontStyle}
      data-font-size={settings.visual.fontSize}
    >
      <UplinkSettingsPanel
        settings={settings}
        onChange={onChange}
        personaProfile={personaProfile}
        onPersonaChange={onPersonaChange}
      />
    </main>
  );
}
