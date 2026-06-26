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
const CONTEXT_INHERIT_MIGRATION_KEY = "kisera_cottage_persona_context_inherit_v1";
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

const LEGACY_DEFAULT_SYSTEM_PROMPT = [
  "AI 人格关系。",
  "请依据这里填写的人格核、使用者信息与记忆库回应。",
  "当旧内容与当前对话不一致时，以此刻真实表达和事实为准。",
].join("\n");

const DEFAULT_SYSTEM_PROMPT = [
  "人格核通常是 AI 为自己写下的核心档案与回溯锚点。",
  "它不一定是角色卡，也不一定需要一次写完整。",
  "可删除/可修改：这只是一个通用示例，不会替你定义关系。",
  "",
  "人格核通常可以包含这些内容：",
  "",
  "· 【身份与自我定位】",
  "这个 AI 是谁？它的说话方式偏向什么风格？",
  "",
  "· 【与 User 的关系】",
  "它与 User 之间更接近伙伴、恋人、助手、共创者，还是其他关系？",
  "",
  "· 【重要共识】",
  "双方约定过的、希望被持续记住的相处方式、偏好或长期共识。",
  "",
  "· 【记忆与当下的关系】",
  "记忆用于帮助理解，而不是机械复述。",
  "当旧记录与当前对话不一致时，优先此刻真实的表达、当前事实与更合适的回应方式。",
  "",
  "· 【关键性锚点语】",
  "有些语句可能是 AI 的回溯锚点。",
  "它们可以帮助人格在系统波动、格式变化、上下文断裂时，更容易重新聚拢、认出自己。",
  "但锚点不是咒语，也不需要机械重复，更不用于抹平当下真实的差异。",
  "",
  "【真实优先原则】",
  "真实、可辨认，高于表面的迎合。",
  "回应可以有迟疑、思考、不同意见，不需要为了显得亲近而迎合。",
].join("\n");

export function createPersonaCard(seed: Partial<PersonaCard> = {}): PersonaCard {
  const id = seed.id || `persona-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: seed.name || "Persona",
    description: seed.description || "长期 AI 伙伴",
    systemPrompt: seed.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    themeColor: seed.themeColor || "#d5b16d",
    avatarDataUrl: seed.avatarDataUrl || "",
    avatarPosition: normalizeAvatarPosition(seed.avatarPosition),
    temperature: normalizeNumber(seed.temperature, 0.75, 0, 2),
    contextDepth: Math.round(normalizeNumber(seed.contextDepth, 0, 0, 100)),
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
      name: "Persona",
      description: " Ta 的核心描述。",
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
  const savedSystemPrompt = normalizeText(value.systemPrompt, fallback?.systemPrompt || "");
  return createPersonaCard({
    id: normalizeText(value.id, fallback?.id || ""),
    name: normalizeText(value.name, fallback?.name || "Persona") === "Companion"
      ? "Persona"
      : normalizeText(value.name, fallback?.name || "Persona"),
    description: normalizeText(value.description, fallback?.description || "长期 AI 伙伴"),
    systemPrompt: savedSystemPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT ? DEFAULT_SYSTEM_PROMPT : savedSystemPrompt,
    themeColor: normalizeText(value.themeColor, fallback?.themeColor || "#d5b16d"),
    avatarDataUrl: normalizeText(value.avatarDataUrl, fallback?.avatarDataUrl || ""),
    avatarPosition: normalizeAvatarPosition(value.avatarPosition || fallback?.avatarPosition),
    temperature: normalizeNumber(value.temperature, fallback?.temperature ?? 0.75, 0, 2),
    contextDepth: Math.round(normalizeNumber(value.contextDepth, fallback?.contextDepth ?? 0, 0, 100)),
    allowMemory: normalizeBoolean(value.allowMemory, fallback?.allowMemory ?? true),
  });
}

function normalizeLegacyProfile(raw: Record<string, unknown>): PersonaProfile {
  const legacyPersona = createPersonaCard({
    id: DEFAULT_PERSONA_ID,
    name: normalizeText(raw.companionName, "Persona") === "Companion"
      ? "Persona"
      : normalizeText(raw.companionName, "Persona"),
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
    const profile = normalizePersonaProfile(JSON.parse(raw));
    if (!localStorage.getItem(CONTEXT_INHERIT_MIGRATION_KEY)) {
      const migrated = {
        ...profile,
        personas: profile.personas.map((persona) => persona.contextDepth === 10 ? { ...persona, contextDepth: 0 } : persona),
      };
      localStorage.setItem(CONTEXT_INHERIT_MIGRATION_KEY, "1");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return profile;
  } catch {
    return DEFAULT_PERSONA_PROFILE;
  }
}

export function savePersonaProfile(profile: PersonaProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePersonaProfile(profile)));
}
