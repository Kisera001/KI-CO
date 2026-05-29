import { useMemo, useState } from "react";
import { Clapperboard, Database, MessageCircle, Settings, SlidersHorizontal, UserRound } from "lucide-react";
import { createConfiguredLLMAdapter, createMemoryBankAdapter } from "./adapters/companionAdapters";
import { ChatPage } from "./components/chat/ChatPage";
import { CinemaCompanionRoom } from "./components/CinemaCompanionRoom";
import { MemoryBankPage } from "./components/MemoryBankPage";
import { PersonaCorePage } from "./components/PersonaCorePage";
import { SettingsPage } from "./components/SettingsPage";
import { VectorLabPage } from "./components/VectorLabPage";
import { loadUplinkSettings, saveUplinkSettings } from "./settings/uplinkSettings";
import { getActivePersona, loadPersonaProfile, savePersonaProfile, type PersonaProfile } from "./storage/personaProfile";
import type { UplinkSettings } from "./types";

type AppPage = "cinema" | "chat" | "settings" | "persona" | "memory" | "vector";

const ROUTE_ITEMS: Array<{ page: AppPage; label: string; icon: typeof Clapperboard }> = [
  { page: "cinema", label: "观影室", icon: Clapperboard },
  { page: "chat", label: "长对话", icon: MessageCircle },
  { page: "persona", label: "人格核", icon: UserRound },
  { page: "memory", label: "记忆库", icon: Database },
  { page: "vector", label: "调音台", icon: SlidersHorizontal },
  { page: "settings", label: "设置", icon: Settings },
];

function RouteSwitcher({
  activePage,
  theme,
  onSelect,
}: {
  activePage: AppPage;
  theme: UplinkSettings["visual"]["theme"];
  onSelect: (page: AppPage) => void;
}) {
  return (
    <nav className="cottage-route-switcher" data-theme={theme} aria-label="小屋页面切换">
      {ROUTE_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.page}
            type="button"
            className={activePage === item.page ? "active" : ""}
            onClick={() => onSelect(item.page)}
            title={item.label}
            aria-label={item.label}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [personaProfile, setPersonaProfileState] = useState<PersonaProfile>(() => loadPersonaProfile());
  const [uplinkSettings, setUplinkSettingsState] = useState<UplinkSettings>(() => loadUplinkSettings());
  const [activePage, setActivePage] = useState<AppPage>("cinema");
  const [initialConversationId, setInitialConversationId] = useState<string | undefined>(undefined);
  const activePersona = useMemo(() => getActivePersona(personaProfile), [personaProfile]);

  function setUplinkSettings(nextSettings: UplinkSettings) {
    setUplinkSettingsState(nextSettings);
    saveUplinkSettings(nextSettings);
  }

  function setPersonaProfile(nextProfile: PersonaProfile) {
    setPersonaProfileState(nextProfile);
    savePersonaProfile(nextProfile);
  }

  const effectiveUplinkSettings = useMemo<UplinkSettings>(
    () => ({
      ...uplinkSettings,
      temperature: activePersona.temperature,
      contextLoad: {
        ...uplinkSettings.contextLoad,
        shortTermMessageLimit: activePersona.contextDepth > 0
          ? activePersona.contextDepth
          : uplinkSettings.contextLoad.shortTermMessageLimit,
      },
    }),
    [activePersona.contextDepth, activePersona.temperature, uplinkSettings],
  );

  const adapters = useMemo(
    () => ({
      persona: {
        async getPersonaCore() {
          return [
            `Companion name: ${activePersona.name || "Companion"}`,
            `User name: ${personaProfile.userName || "User"}`,
            activePersona.description ? `Persona description: ${activePersona.description}` : "",
            "",
            activePersona.systemPrompt,
          ].filter(Boolean).join("\n");
        },
        async getUserContext() {
          return `User name: ${personaProfile.userName || "User"}`;
        },
      },
      memory: createMemoryBankAdapter(() => activePersona.allowMemory),
      llm: createConfiguredLLMAdapter(() => effectiveUplinkSettings),
    }),
    [activePersona, effectiveUplinkSettings, personaProfile.userName],
  );

  function goToPage(page: AppPage) {
    if (page === "chat") setInitialConversationId(undefined);
    setActivePage(page);
  }

  return (
    <>
      <div style={{ display: activePage === "cinema" ? "block" : "none" }} aria-hidden={activePage !== "cinema"}>
        <CinemaCompanionRoom
          adapters={adapters}
          uplinkSettings={effectiveUplinkSettings}
          onOpenLongChat={() => {
            setInitialConversationId(undefined);
            setActivePage("chat");
          }}
          onOpenPersona={() => setActivePage("persona")}
          onOpenMemory={() => setActivePage("memory")}
          onOpenVectorLab={() => setActivePage("vector")}
          onOpenSettings={() => setActivePage("settings")}
          onOpenConversation={(conversationId) => {
            setInitialConversationId(conversationId);
            setActivePage("chat");
          }}
        />
      </div>

      {activePage !== "cinema" && (
        <RouteSwitcher activePage={activePage} theme={uplinkSettings.visual.theme} onSelect={goToPage} />
      )}

      {activePage === "chat" && (
        <ChatPage
          adapters={adapters}
          uplinkSettings={effectiveUplinkSettings}
          personaProfile={personaProfile}
          initialConversationId={initialConversationId}
          onClose={() => setActivePage("cinema")}
        />
      )}

      {activePage === "settings" && (
        <SettingsPage
          settings={uplinkSettings}
          onChange={setUplinkSettings}
          personaProfile={personaProfile}
          onPersonaChange={setPersonaProfile}
          onClose={() => setActivePage("cinema")}
        />
      )}

      {activePage === "persona" && (
        <PersonaCorePage
          profile={personaProfile}
          settings={uplinkSettings}
          onChange={setPersonaProfile}
          onClose={() => setActivePage("cinema")}
        />
      )}

      {activePage === "memory" && (
        <MemoryBankPage
          settings={uplinkSettings}
          onClose={() => setActivePage("cinema")}
        />
      )}

      {activePage === "vector" && (
        <VectorLabPage
          settings={uplinkSettings}
          onChange={setUplinkSettings}
        />
      )}
    </>
  );
}
