export interface AvatarPosition {
  x: number;
  y: number;
  scale: number;
}

export interface PersonaCard {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  themeColor: string;
  avatarDataUrl: string;
  avatarPosition: AvatarPosition;
  temperature: number;
  contextDepth: number;
  allowMemory: boolean;
}

export interface PersonaProfile {
  userName: string;
  userAvatarDataUrl: string;
  userAvatarPosition: AvatarPosition;
  showAvatars: boolean;
  activePersonaId: string;
  personas: PersonaCard[];
}

const STORAGE_KEY = "kisera_cinema_persona_profile_v3";
const LEGACY_STORAGE_KEYS = [
  "kisera_cinema_persona_profile_v2",
  "kisera_cinema_persona_profile_v1",
];

export const DEFAULT_AVATAR_POSITION: AvatarPosition = {
  x: 50,
  y: 50,
  scale: 1,
};

const DEFAULT_PERSONA_ID = "default-companion";

export function createPersonaCard(seed: Partial<PersonaCard> = {}): PersonaCard {
  const id = seed.id || `persona-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: seed.name || "Companion",
    description: seed.description || "长期 AI 伙伴",
    systemPrompt:
      seed.systemPrompt ||
      [
        "你是由使用者配置的 AI 伙伴。",
        "请依据这里填写的人格核、使用者信息与记忆库回应。",
        "当旧内容与当前对话不一致时，以此刻真实表达和事实为准。",
      ].join("\n"),
    themeColor: seed.themeColor || "#d5b16d",
    avatarDataUrl: seed.avatarDataUrl || "",
    avatarPosition: normalizeAvatarPosition(seed.avatarPosition),
    temperature: normalizeNumber(seed.temperature, 0.75, 0, 2),
    contextDepth: Math.round(normalizeNumber(seed.contextDepth, 10, 0, 100)),
    allowMemory: normalizeBoolean(seed.allowMemory, true),
  };
}

export const DEFAULT_PERSONA_PROFILE: PersonaProfile = {
  userName: "User",
  userAvatarDataUrl: "",
  userAvatarPosition: DEFAULT_AVATAR_POSITION,
  showAvatars: true,
  activePersonaId: DEFAULT_PERSONA_ID,
  personas: [
    createPersonaCard({
      id: DEFAULT_PERSONA_ID,
      name: "Companion",
      description: "一位由你配置、陪你长对话和一起观影的 AI 伙伴。",
    }),
  ],
};

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAvatarPosition(raw: unknown): AvatarPosition {
  const value = raw && typeof raw === "object" ? (raw as Partial<AvatarPosition>) : {};
  return {
    x: normalizeNumber(value.x, DEFAULT_AVATAR_POSITION.x, 0, 100),
    y: normalizeNumber(value.y, DEFAULT_AVATAR_POSITION.y, 0, 100),
    scale: normalizeNumber(value.scale, DEFAULT_AVATAR_POSITION.scale, 0.75, 2.5),
  };
}

function normalizePersonaCard(raw: unknown, fallback?: Partial<PersonaCard>): PersonaCard {
  const value = raw && typeof raw === "object" ? (raw as Partial<PersonaCard>) : {};
  return createPersonaCard({
    id: normalizeText(value.id, fallback?.id || ""),
    name: normalizeText(value.name, fallback?.name || "Companion"),
    description: normalizeText(value.description, fallback?.description || "长期 AI 伙伴"),
    systemPrompt: normalizeText(value.systemPrompt, fallback?.systemPrompt || ""),
    themeColor: normalizeText(value.themeColor, fallback?.themeColor || "#d5b16d"),
    avatarDataUrl: normalizeText(value.avatarDataUrl, fallback?.avatarDataUrl || ""),
    avatarPosition: normalizeAvatarPosition(value.avatarPosition || fallback?.avatarPosition),
    temperature: normalizeNumber(value.temperature, fallback?.temperature ?? 0.75, 0, 2),
    contextDepth: Math.round(normalizeNumber(value.contextDepth, fallback?.contextDepth ?? 10, 0, 100)),
    allowMemory: normalizeBoolean(value.allowMemory, fallback?.allowMemory ?? true),
  });
}

function normalizeLegacyProfile(raw: Record<string, unknown>): PersonaProfile {
  const legacyPersona = createPersonaCard({
    id: DEFAULT_PERSONA_ID,
    name: normalizeText(raw.companionName, "Companion"),
    description: "从旧版配置迁移的人格卡。",
    systemPrompt: normalizeText(raw.personaCore, ""),
    avatarDataUrl: normalizeText(raw.companionAvatarDataUrl, ""),
    avatarPosition: normalizeAvatarPosition(raw.companionAvatarPosition),
    temperature: normalizeNumber(raw.temperature, 0.75, 0, 2),
    contextDepth: Math.round(normalizeNumber(raw.shortTermMessageLimit, 10, 0, 100)),
    allowMemory: normalizeBoolean(raw.allowMemory, true),
  });

  return {
    userName: normalizeText(raw.userName, DEFAULT_PERSONA_PROFILE.userName),
    userAvatarDataUrl: normalizeText(raw.userAvatarDataUrl, ""),
    userAvatarPosition: normalizeAvatarPosition(raw.userAvatarPosition),
    showAvatars: normalizeBoolean(raw.showAvatars, true),
    activePersonaId: legacyPersona.id,
    personas: [legacyPersona],
  };
}

export function normalizePersonaProfile(raw: Partial<PersonaProfile> | null | undefined): PersonaProfile {
  if (!raw || typeof raw !== "object") return DEFAULT_PERSONA_PROFILE;

  const maybeLegacy = raw as Record<string, unknown>;
  if (!Array.isArray(raw.personas) && ("companionName" in maybeLegacy || "personaCore" in maybeLegacy)) {
    return normalizeLegacyProfile(maybeLegacy);
  }

  const personas = Array.isArray(raw.personas)
    ? raw.personas.map((persona, index) =>
        normalizePersonaCard(persona, {
          id: index === 0 ? DEFAULT_PERSONA_ID : undefined,
        }),
      )
    : DEFAULT_PERSONA_PROFILE.personas;

  const safePersonas = personas.length > 0 ? personas : DEFAULT_PERSONA_PROFILE.personas;
  const requestedActiveId = normalizeText(raw.activePersonaId, safePersonas[0]?.id || DEFAULT_PERSONA_ID);
  const activePersonaId = safePersonas.some((persona) => persona.id === requestedActiveId)
    ? requestedActiveId
    : safePersonas[0].id;

  return {
    userName: normalizeText(raw.userName, DEFAULT_PERSONA_PROFILE.userName),
    userAvatarDataUrl: normalizeText(raw.userAvatarDataUrl, ""),
    userAvatarPosition: normalizeAvatarPosition(raw.userAvatarPosition),
    showAvatars: normalizeBoolean(raw.showAvatars, DEFAULT_PERSONA_PROFILE.showAvatars),
    activePersonaId,
    personas: safePersonas,
  };
}

export function getActivePersona(profile: PersonaProfile): PersonaCard {
  return profile.personas.find((persona) => persona.id === profile.activePersonaId) || profile.personas[0] || DEFAULT_PERSONA_PROFILE.personas[0];
}

export function loadPersonaProfile(): PersonaProfile {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!raw) return DEFAULT_PERSONA_PROFILE;
    return normalizePersonaProfile(JSON.parse(raw));
  } catch {
    return DEFAULT_PERSONA_PROFILE;
  }
}

export function savePersonaProfile(profile: PersonaProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePersonaProfile(profile)));
}
