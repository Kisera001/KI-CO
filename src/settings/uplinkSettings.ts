import type { ModelPreset, ModelProvider, ProviderProfile, UplinkSettings, VisualAtmosphereSettings } from "../types";

const STORAGE_KEY = "kisera_cinema_uplink_settings_v2";
const LEGACY_STORAGE_KEY = "kisera_cinema_uplink_settings_v1";
const STREAM_DEFAULT_MIGRATION_KEY = "kisera_cinema_stream_default_enabled_v1";

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openrouter: "OpenRouter / 中转站",
  claude: "Claude",
  gemini: "Gemini",
  glm: "GLM / 智谱",
  deepseek: "DeepSeek",
};

export const PROVIDER_HINTS: Record<ModelProvider, string> = {
  openrouter: "OpenAI-compatible，适合 OpenRouter 或常见中转站。",
  claude: "Anthropic Messages API，填写 Claude key。",
  gemini: "Google Gemini API，填写 Gemini key。",
  glm: "智谱 GLM 兼容接口。",
  deepseek: "DeepSeek 兼容接口。",
};

export const MODEL_PRESETS: Record<ModelProvider, ModelPreset[]> = {
  openrouter: [
    { id: "openai/gpt-4o-2024-11-20", name: "GPT-4o 2024-11-20" },
    { id: "openai/gpt-4.1", name: "GPT-4.1" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "z-ai/glm-5", name: "GLM-5" },
    { id: "z-ai/glm-5v-turbo", name: "GLM-5V-Turbo" },
  ],
  claude: [
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  ],
  gemini: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "gemini-3.1-flash-preview", name: "Gemini 3.1 Flash" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  glm: [
    { id: "glm-5v-turbo", name: "GLM-5V-Turbo" },
    { id: "glm-5", name: "GLM-5" },
    { id: "glm-5.1", name: "GLM-5.1" },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
};

const DEFAULT_PROFILES: Record<ModelProvider, ProviderProfile> = {
  openrouter: {
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-2024-11-20",
  },
  claude: {
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4.5",
  },
  gemini: {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.1-pro-preview",
  },
  glm: {
    apiKey: "",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5v-turbo",
  },
  deepseek: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
  },
};

const DEFAULT_VISUAL_SETTINGS: VisualAtmosphereSettings = {
  theme: "black-gold",
  backgroundFit: "cover",
  customBackgroundDataUrl: "",
  fontStyle: "system",
  fontSize: "standard",
  showBilingualLabels: true,
  showStatusStrip: true,
  showButtonLabels: true,
  metaShowName: false,
  metaShowTime: false,
  metaShowDate: true,
  metaShowModel: false,
  metaShowTokens: true,
};

export const DEFAULT_UPLINK_SETTINGS: UplinkSettings = {
  activeProvider: "openrouter",
  temperature: 0.72,
  stream: true,
  profiles: DEFAULT_PROFILES,
  contextLoad: {
    maxOutputTokens: 1200,
    shortTermMessageLimit: 15,
    memorySnippetLimit: 4,
    subtitleBefore: 10,
    subtitleAfter: 2,
    attachScreenshot: true,
  },
  visual: DEFAULT_VISUAL_SETTINGS,
};

function normalizeProfile(provider: ModelProvider, raw: Partial<ProviderProfile> | undefined): ProviderProfile {
  return {
    ...DEFAULT_PROFILES[provider],
    ...(raw || {}),
  };
}

function normalizeFontStyle(value: unknown): VisualAtmosphereSettings["fontStyle"] {
  return value === "soft" ? "soft" : "system";
}

function normalizeFontSize(value: unknown): VisualAtmosphereSettings["fontSize"] {
  return value === "small" || value === "large" ? value : "standard";
}

function normalizeBackgroundFit(value: unknown): VisualAtmosphereSettings["backgroundFit"] {
  return value === "contain" ? "contain" : "cover";
}

export function normalizeUplinkSettings(raw: Partial<UplinkSettings> | null | undefined): UplinkSettings {
  const activeProvider = raw?.activeProvider && raw.activeProvider in DEFAULT_PROFILES ? raw.activeProvider : "openrouter";
  const rawVisual = raw?.visual as Partial<VisualAtmosphereSettings> | undefined;
  return {
    ...DEFAULT_UPLINK_SETTINGS,
    ...(raw || {}),
    stream: typeof raw?.stream === "boolean" ? raw.stream : true,
    activeProvider,
    profiles: {
      openrouter: normalizeProfile("openrouter", raw?.profiles?.openrouter),
      claude: normalizeProfile("claude", raw?.profiles?.claude),
      gemini: normalizeProfile("gemini", raw?.profiles?.gemini),
      glm: normalizeProfile("glm", raw?.profiles?.glm),
      deepseek: normalizeProfile("deepseek", raw?.profiles?.deepseek),
    },
    contextLoad: {
      ...DEFAULT_UPLINK_SETTINGS.contextLoad,
      ...(raw?.contextLoad || {}),
      subtitleBefore: DEFAULT_UPLINK_SETTINGS.contextLoad.subtitleBefore,
      subtitleAfter: DEFAULT_UPLINK_SETTINGS.contextLoad.subtitleAfter,
      attachScreenshot: DEFAULT_UPLINK_SETTINGS.contextLoad.attachScreenshot,
    },
    visual: {
      ...DEFAULT_VISUAL_SETTINGS,
      ...(rawVisual || {}),
      backgroundFit: normalizeBackgroundFit(rawVisual?.backgroundFit),
      fontStyle: normalizeFontStyle(rawVisual?.fontStyle),
      fontSize: normalizeFontSize(rawVisual?.fontSize),
    },
  };
}

export function loadUplinkSettings(): UplinkSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!localStorage.getItem(STREAM_DEFAULT_MIGRATION_KEY)) {
        parsed.stream = true;
        localStorage.setItem(STREAM_DEFAULT_MIGRATION_KEY, "1");
      }
      return normalizeUplinkSettings(parsed);
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      localStorage.setItem(STREAM_DEFAULT_MIGRATION_KEY, "1");
      return normalizeUplinkSettings({ ...legacy, stream: true });
    }

    return normalizeUplinkSettings(null);
  } catch {
    return DEFAULT_UPLINK_SETTINGS;
  }
}

export function saveUplinkSettings(settings: UplinkSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getActiveProfile(settings: UplinkSettings): ProviderProfile {
  return settings.profiles[settings.activeProvider];
}
