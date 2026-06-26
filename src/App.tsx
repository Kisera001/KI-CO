import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Hourglass, MessageCircle, Settings, SlidersHorizontal, UserRound } from "lucide-react";
import type { ComponentType } from "react";
import { createConfiguredLLMAdapter, createMemoryBankAdapter } from "./adapters/companionAdapters";
import { ChatPage } from "./components/chat/ChatPage";
import { CinemaCompanionRoom } from "./components/CinemaCompanionRoom";
import { CottageLogoMark } from "./components/CottageGlyphs";
import { MemoryBankPage } from "./components/MemoryBankPage";
import { PersonaCorePage } from "./components/PersonaCorePage";
import { SettingsPage } from "./components/SettingsPage";
import { VectorLabPage } from "./components/VectorLabPage";
import { TimeCorridorPage } from "./components/TimeCorridorPage";
import { applyAutomaticVectorProfile, loadUplinkSettings, saveUplinkSettings } from "./settings/uplinkSettings";
import { getActivePersona, loadPersonaProfile, savePersonaProfile, type PersonaProfile } from "./storage/personaProfile";
import type { UplinkSettings } from "./types";

type AppPage = "cinema" | "chat" | "settings" | "persona" | "memory" | "chronicle" | "vector";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const INSTALL_BANNER_DISMISSED_KEY = "ki_co_install_banner_dismissed_v1";

function NavMemoryGlyph({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="3.5" width="14" height="17" rx="2.4" />
      <path d="M8.2 7h7.6" />
      <path d="M8.2 17h7.6" />
      <path d="M12 8.8c.32 1.78 1.4 2.86 3.2 3.2-1.8.34-2.88 1.42-3.2 3.2-.32-1.78-1.4-2.86-3.2-3.2 1.8-.34 2.88-1.42 3.2-3.2Z" />
    </svg>
  );
}

const ROUTE_ITEMS: Array<{ page: AppPage; label: string; icon: ComponentType<{ size?: number; className?: string }> }> = [
  { page: "chat", label: "长对话", icon: MessageCircle },
  { page: "persona", label: "人格核", icon: UserRound },
  { page: "memory", label: "记忆库", icon: NavMemoryGlyph },
  { page: "chronicle", label: "时光回廊", icon: Hourglass },
  { page: "cinema", label: "观影室", icon: Clapperboard },
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
      <span className="cottage-route-brand" aria-hidden="true">
        <CottageLogoMark />
        <span>KI-CO</span>
      </span>
      {ROUTE_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.page}
            type="button"
            className={`${activePage === item.page ? "active" : ""} route-${item.page}`.trim()}
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
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [installHintText, setInstallHintText] = useState("安装到手机后，会优先使用本机缓存打开小屋。API 对话仍需要联网。");
  const activePersona = useMemo(() => getActivePersona(personaProfile), [personaProfile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const dismissed = localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY) === "1";
    const isMobileLike = window.innerWidth < 820 || window.matchMedia("(pointer: coarse)").matches;
    if (dismissed || !isMobileLike) return;

    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isSecureEnough = window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setInstallHintText(isSecureEnough
        ? "安装到手机后，会优先使用本机缓存打开小屋。API 对话仍需要联网。"
        : "当前地址不是 HTTPS，浏览器可能不会允许缓存安装。建议用 HTTPS 预览地址打开。");
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    if (isIos) {
      setInstallHintText("iPhone/iPad 可在 Safari 里点分享，再选择“添加到主屏幕”。");
      setShowInstallBanner(true);
    } else if (!isSecureEnough) {
      setInstallHintText("普通局域网 HTTP 通常不能安装 PWA；需要 HTTPS 或 localhost。");
      setShowInstallBanner(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  async function installPwa() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setShowInstallBanner(false);
      localStorage.removeItem(INSTALL_BANNER_DISMISSED_KEY);
    }
    setInstallPromptEvent(null);
  }

  function dismissInstallBanner() {
    setShowInstallBanner(false);
    localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, "1");
  }

  function setUplinkSettings(nextSettings: UplinkSettings) {
    const linkedSettings = applyAutomaticVectorProfile(nextSettings);
    setUplinkSettingsState(linkedSettings);
    saveUplinkSettings(linkedSettings);
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
      memory: createMemoryBankAdapter(() => activePersona.allowMemory, () => effectiveUplinkSettings),
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
          onOpenChronicle={() => setActivePage("chronicle")}
          onOpenVectorLab={() => setActivePage("vector")}
          onOpenSettings={() => setActivePage("settings")}
          onOpenConversation={(conversationId) => {
            setInitialConversationId(conversationId);
            setActivePage("chat");
          }}
        />
      </div>

      <RouteSwitcher activePage={activePage} theme={uplinkSettings.visual.theme} onSelect={goToPage} />

      {showInstallBanner ? (
        <div className="cottage-install-banner" data-theme={uplinkSettings.visual.theme}>
          <div>
            <strong>手机常住模式</strong>
            <span>{installHintText}</span>
          </div>
          <div className="cottage-install-actions">
            {installPromptEvent ? (
              <button type="button" onClick={installPwa}>安装</button>
            ) : null}
            <button type="button" onClick={dismissInstallBanner}>知道了</button>
          </div>
        </div>
      ) : null}

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

      {activePage === "chronicle" && (
        <TimeCorridorPage
          settings={effectiveUplinkSettings}
          personaProfile={personaProfile}
          llm={adapters.llm}
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
