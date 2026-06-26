import type {
  MemoryRetrievalSettings,
  ModelPreset,
  ModelProvider,
  JournalProvider,
  ObsidianScopeMode,
  ProviderProfile,
  UplinkSettings,
  VectorProvider,
  VisualAtmosphereSettings,
} from "../types";

const STORAGE_KEY = "kisera_cinema_uplink_settings_v2";
const LEGACY_STORAGE_KEY = "kisera_cinema_uplink_settings_v1";
const STREAM_DEFAULT_MIGRATION_KEY = "kisera_cinema_stream_default_enabled_v1";
const BALANCED_RETRIEVAL_MIGRATION_KEY = "kisera_cinema_balanced_retrieval_default_v2";
const BACKGROUND_STAGE_MIGRATION_KEY = "kisera_cinema_stage_background_default_v1";

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
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "z-ai/glm-5", name: "GLM-5" },
    { id: "z-ai/glm-5.2", name: "GLM-5.2" },
    { id: "z-ai/glm-5v-turbo", name: "GLM-5V-Turbo" },
  ],
  claude: [
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
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
    { id: "glm-5.2", name: "GLM-5.2" },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
};

export const JOURNAL_MODEL_PRESETS: Record<ModelProvider, ModelPreset[]> = {
  openrouter: [
    { id: "z-ai/glm-5", name: "GLM-5" },
    { id: "z-ai/glm-5.2", name: "GLM-5.2" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
  claude: [
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  ],
  gemini: [
    { id: "gemini-3.1-flash-preview", name: "Gemini 3.1 Flash" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  glm: [
    { id: "glm-5", name: "GLM-5" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5v-turbo", name: "GLM-5V-Turbo" },
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
    journalModel: "z-ai/glm-5",
  },
  claude: {
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4.5",
    journalModel: "claude-sonnet-4.6",
  },
  gemini: {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.1-pro-preview",
    journalModel: "gemini-3.1-flash-preview",
  },
  glm: {
    apiKey: "",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5v-turbo",
    journalModel: "glm-5",
  },
  deepseek: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    journalModel: "deepseek-v4-pro",
  },
};

const DEFAULT_VISUAL_SETTINGS: VisualAtmosphereSettings = {
  theme: "white-gold",
  backgroundFit: "stage",
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

export const DEFAULT_MEMORY_RETRIEVAL_SETTINGS: MemoryRetrievalSettings = {
  memoryRetrievalMode: "hybrid",
  enableObsidianRetrieval: true,
  vectorOnDemandEnabled: false,
  vectorOnDemandMinItems: 100,
  vectorOnDemandMinChars: 10000,
  vectorOnDemandPromoteMode: "hybrid",
  vectorProvider: "none",
  vectorEmbeddingModel: "",
  vectorOpenAIBaseUrl: "https://openrouter.ai/api/v1",
  vectorOpenAIApiKey: "",
  vectorUseOpenRouterProfile: true,
  vectorTopK: 8,
  vectorScoreThreshold: 0.1,
  vectorRerank: true,
  vectorCrossEncoderRerank: true,
  vectorLiteralExactTitleBoost: 0.24,
  vectorLiteralExactAliasBoost: 0.14,
  vectorLiteralExactBodyBoost: 0.08,
  vectorLiteralTermTitleBoost: 0.028,
  vectorLiteralTermBodyBoost: 0.008,
  vectorLiteralBoostCap: 0.42,
  vectorBuildBatchSize: 3,
  vectorBuildYieldMs: 12,
  rawMemoryDeepDiveEnabled: false,
  rawMemoryWindowLimit: 2,
  vectorContextBudgetChars: 2500,
  latestStyleEnabled: false,
  latestStyleTopK: 2,
  latestStylePathKeyword: "风格样本库",
  obsidianScopeMode: "all",
  obsidianScopeCustom: "",
};

const DEFAULT_OPENROUTER_EMBEDDING_MODEL = "google/gemini-embedding-2";

export const DEFAULT_UPLINK_SETTINGS: UplinkSettings = {
  activeProvider: "openrouter",
  journalProvider: "openrouter",
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
  memoryRetrieval: DEFAULT_MEMORY_RETRIEVAL_SETTINGS,
  visual: DEFAULT_VISUAL_SETTINGS,
};

function normalizeProfile(provider: ModelProvider, raw: Partial<ProviderProfile> | undefined): ProviderProfile {
  const fallback = DEFAULT_PROFILES[provider];
  return {
    ...fallback,
    ...(raw || {}),
    journalModel: String(raw?.journalModel || fallback.journalModel || raw?.model || fallback.model),
  };
}

function normalizeFontStyle(value: unknown): VisualAtmosphereSettings["fontStyle"] {
  return value === "soft" ? "soft" : "system";
}

function normalizeTheme(value: unknown): VisualAtmosphereSettings["theme"] {
  return value === "black-gold" || value === "pink-mocha" || value === "custom" ? value : "white-gold";
}

function normalizeJournalProvider(value: unknown): JournalProvider {
  return value === "active" || value === "openrouter" || value === "claude" || value === "gemini" || value === "glm" || value === "deepseek"
    ? value
    : "openrouter";
}

function normalizeFontSize(value: unknown): VisualAtmosphereSettings["fontSize"] {
  return value === "small" || value === "large" ? value : "standard";
}

function normalizeBackgroundFit(value: unknown): VisualAtmosphereSettings["backgroundFit"] {
  if (value === "cover") return shouldMigrateLegacyCoverBackground() ? "stage" : "cover";
  if (value === "stage" || value === "contain") return value;
  return "stage";
}

function shouldMigrateLegacyCoverBackground(): boolean {
  try {
    if (localStorage.getItem(BACKGROUND_STAGE_MIGRATION_KEY) === "true") return false;
    localStorage.setItem(BACKGROUND_STAGE_MIGRATION_KEY, "true");
    return true;
  } catch {
    return false;
  }
}

function normalizeRetrievalMode(value: unknown): MemoryRetrievalSettings["memoryRetrievalMode"] {
  return value === "vector" || value === "hybrid" ? value : "local";
}

function normalizeVectorProvider(value: unknown): VectorProvider {
  return value === "local" || value === "openai" || value === "gemini" ? value : "none";
}

function normalizeObsidianScopeMode(value: unknown): ObsidianScopeMode {
  return value === "persona" || value === "book" || value === "custom" ? value : "all";
}

function normalizeMemoryRetrievalSettings(raw: Partial<MemoryRetrievalSettings> | null | undefined): MemoryRetrievalSettings {
  const merged = {
    ...DEFAULT_MEMORY_RETRIEVAL_SETTINGS,
    ...(raw || {}),
  };
  const topK = Math.max(1, Math.min(12, Math.floor(Number(merged.vectorTopK) || DEFAULT_MEMORY_RETRIEVAL_SETTINGS.vectorTopK)));
  const latestTopK = Math.max(1, Math.min(5, Math.floor(Number(merged.latestStyleTopK) || DEFAULT_MEMORY_RETRIEVAL_SETTINGS.latestStyleTopK)));
  return {
    ...merged,
    memoryRetrievalMode: normalizeRetrievalMode(merged.memoryRetrievalMode),
    vectorOnDemandPromoteMode: merged.vectorOnDemandPromoteMode === "vector" ? "vector" : "hybrid",
    vectorProvider: normalizeVectorProvider(merged.vectorProvider),
    vectorUseOpenRouterProfile: typeof raw?.vectorUseOpenRouterProfile === "boolean"
      ? raw.vectorUseOpenRouterProfile
      : !String(raw?.vectorOpenAIApiKey || "").trim(),
    vectorTopK: topK,
    vectorScoreThreshold: Math.max(0, Math.min(1, Number(merged.vectorScoreThreshold) || 0)),
    vectorBuildBatchSize: Math.max(1, Math.min(30, Math.floor(Number(merged.vectorBuildBatchSize) || 3))),
    vectorBuildYieldMs: Math.max(0, Math.min(200, Math.floor(Number(merged.vectorBuildYieldMs) || 12))),
    rawMemoryWindowLimit: Math.max(1, Math.min(12, Math.floor(Number(merged.rawMemoryWindowLimit) || 2))),
    vectorContextBudgetChars: Math.max(600, Math.min(12000, Math.floor(Number(merged.vectorContextBudgetChars) || 2500))),
    latestStyleTopK: latestTopK,
    obsidianScopeMode: normalizeObsidianScopeMode(merged.obsidianScopeMode),
    obsidianScopeCustom: String(merged.obsidianScopeCustom || ""),
  };
}

export function applyAutomaticVectorProfile(settings: UplinkSettings): UplinkSettings {
  const openRouterProfile = settings.profiles.openrouter;
  const apiKey = openRouterProfile.apiKey.trim();
  const retrieval = settings.memoryRetrieval;
  if (!retrieval.vectorUseOpenRouterProfile || retrieval.vectorProvider === "gemini") return settings;
  if (!apiKey) {
    if (retrieval.vectorProvider !== "openai" || !retrieval.vectorOpenAIApiKey) return settings;
    return {
      ...settings,
      memoryRetrieval: {
        ...retrieval,
        vectorProvider: "none",
        vectorOpenAIApiKey: "",
      },
    };
  }

  const baseUrl = openRouterProfile.baseUrl.trim() || "https://openrouter.ai/api/v1";
  const currentModel = retrieval.vectorEmbeddingModel.trim();
  const shouldUseOpenRouterDefault = !currentModel
    || currentModel === "openai/text-embedding-3-small"
    || currentModel === "text-embedding-3-small";
  return {
    ...settings,
    memoryRetrieval: {
      ...retrieval,
      vectorProvider: "openai",
      vectorOpenAIBaseUrl: baseUrl,
      vectorOpenAIApiKey: apiKey,
      vectorEmbeddingModel: baseUrl.includes("openrouter.ai") && shouldUseOpenRouterDefault
        ? DEFAULT_OPENROUTER_EMBEDDING_MODEL
        : currentModel || "text-embedding-3-small",
    },
  };
}

function migrateLegacyRetrievalDefault(settings: UplinkSettings): UplinkSettings {
  const retrieval = settings.memoryRetrieval;
  const isLegacyFactoryDefault =
    retrieval.memoryRetrievalMode === "local" &&
    retrieval.vectorProvider === "none" &&
    retrieval.vectorTopK === 3 &&
    retrieval.vectorScoreThreshold === 0 &&
    !retrieval.vectorRerank &&
    !retrieval.rawMemoryDeepDiveEnabled &&
    retrieval.rawMemoryWindowLimit === 2;
  const isPreviousBalancedDefault =
    retrieval.memoryRetrievalMode === "hybrid" &&
    retrieval.vectorTopK === 5 &&
    retrieval.vectorScoreThreshold === 0.15 &&
    retrieval.vectorRerank &&
    !retrieval.vectorCrossEncoderRerank &&
    retrieval.rawMemoryDeepDiveEnabled &&
    retrieval.rawMemoryWindowLimit === 2 &&
    retrieval.vectorContextBudgetChars === 2500;
  if (!isLegacyFactoryDefault && !isPreviousBalancedDefault) return settings;
  return {
    ...settings,
    memoryRetrieval: {
      ...retrieval,
      memoryRetrievalMode: "hybrid",
      vectorTopK: 8,
      vectorScoreThreshold: 0.1,
      vectorRerank: true,
      vectorCrossEncoderRerank: true,
      rawMemoryDeepDiveEnabled: false,
      rawMemoryWindowLimit: 2,
      vectorContextBudgetChars: 2500,
    },
  };
}

export function normalizeUplinkSettings(raw: Partial<UplinkSettings> | null | undefined): UplinkSettings {
  const activeProvider = raw?.activeProvider && raw.activeProvider in DEFAULT_PROFILES ? raw.activeProvider : "openrouter";
  const rawVisual = raw?.visual as Partial<VisualAtmosphereSettings> | undefined;
  const normalized: UplinkSettings = {
    ...DEFAULT_UPLINK_SETTINGS,
    ...(raw || {}),
    stream: typeof raw?.stream === "boolean" ? raw.stream : true,
    activeProvider,
    journalProvider: normalizeJournalProvider((raw as any)?.journalProvider),
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
    memoryRetrieval: normalizeMemoryRetrievalSettings(raw?.memoryRetrieval),
    visual: {
      ...DEFAULT_VISUAL_SETTINGS,
      ...(rawVisual || {}),
      theme: normalizeTheme(rawVisual?.theme),
      backgroundFit: normalizeBackgroundFit(rawVisual?.backgroundFit),
      fontStyle: normalizeFontStyle(rawVisual?.fontStyle),
      fontSize: normalizeFontSize(rawVisual?.fontSize),
    },
  };
  return applyAutomaticVectorProfile(normalized);
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
      let normalized = normalizeUplinkSettings(parsed);
      if (!localStorage.getItem(BALANCED_RETRIEVAL_MIGRATION_KEY)) {
        normalized = applyAutomaticVectorProfile(migrateLegacyRetrievalDefault(normalized));
        localStorage.setItem(BALANCED_RETRIEVAL_MIGRATION_KEY, "1");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      localStorage.setItem(STREAM_DEFAULT_MIGRATION_KEY, "1");
      const normalized = applyAutomaticVectorProfile(migrateLegacyRetrievalDefault(normalizeUplinkSettings({ ...legacy, stream: true })));
      localStorage.setItem(BALANCED_RETRIEVAL_MIGRATION_KEY, "1");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }

    localStorage.setItem(BALANCED_RETRIEVAL_MIGRATION_KEY, "1");
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

export function getJournalProfile(settings: UplinkSettings): { provider: ModelProvider; profile: ProviderProfile } {
  const normalizedProvider = normalizeJournalProvider(settings.journalProvider);
  const provider = normalizedProvider === "active" ? settings.activeProvider : normalizedProvider;
  const profile = settings.profiles[provider] || DEFAULT_PROFILES[provider];
  const model = String(profile.journalModel || DEFAULT_PROFILES[provider].journalModel || profile.model || "").trim();

  return {
    provider,
    profile: {
      ...profile,
      model: model || DEFAULT_PROFILES[provider].model,
      journalModel: model || DEFAULT_PROFILES[provider].journalModel,
    },
  };
}
