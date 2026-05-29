export type SourceType = "local-file" | "web-url";

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface SubtitleWindow {
  active?: SubtitleCue;
  previous: SubtitleCue[];
  next: SubtitleCue[];
}

export interface WatchRecord {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceLabel: string;
  currentTime: number;
  duration: number;
  updatedAt: string;
  thumbnailDataUrl?: string;
  subtitleFileName?: string;
  subtitleCount?: number;
  subtitleOffsetSeconds?: number;
  webUrl?: string;
  webOriginalUrl?: string;
  webEmbedUrl?: string;
  webPlatform?: "bilibili";
  webMode?: "embed" | "page";
  companionPlan?: CompanionPlanPoint[];
  companionMode?: string;
  companionDensity?: string;
  triggeredPlanIds?: string[];
}

export interface WatchContext {
  title: string;
  currentTime: number;
  duration: number;
  sourceType: SourceType;
  activeSubtitle?: SubtitleCue;
  subtitleWindow: SubtitleWindow;
  screenshotDataUrl?: string;
}

export interface MemorySnippet {
  id: string;
  title: string;
  text: string;
  score?: number;
  source?: string;
}

export type ModelProvider = "openrouter" | "claude" | "gemini" | "glm" | "deepseek";
export type ThemePreset = "black-gold" | "white-gold" | "pink-mocha";
export type FontStylePreset = "system" | "soft";
export type FontSizePreset = "small" | "standard" | "large";

export interface ModelPreset {
  id: string;
  name: string;
}

export interface ProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ContextLoadSettings {
  maxOutputTokens: number;
  shortTermMessageLimit: number;
  memorySnippetLimit: number;
  subtitleBefore: number;
  subtitleAfter: number;
  attachScreenshot: boolean;
}

export interface VisualAtmosphereSettings {
  theme: ThemePreset;
  backgroundFit: "cover" | "contain";
  customBackgroundDataUrl: string;
  fontStyle: FontStylePreset;
  fontSize: FontSizePreset;
  showBilingualLabels: boolean;
  showStatusStrip: boolean;
  showButtonLabels: boolean;
  metaShowName: boolean;
  metaShowTime: boolean;
  metaShowDate: boolean;
  metaShowModel: boolean;
  metaShowTokens: boolean;
}

export interface UplinkSettings {
  activeProvider: ModelProvider;
  temperature: number;
  stream: boolean;
  profiles: Record<ModelProvider, ProviderProfile>;
  contextLoad: ContextLoadSettings;
  visual: VisualAtmosphereSettings;
}

export interface ConversationTurn {
  role: "user" | "companion";
  text: string;
  attachments?: ConversationAttachment[];
}

export interface PersonaAdapter {
  getPersonaCore(): Promise<string>;
  getUserContext?(): Promise<string>;
}

export interface MemoryAdapter {
  retrieveRelevant(query: string, limit?: number): Promise<MemorySnippet[]>;
}

export interface CompanionRequest {
  mode?: "cinema" | "chat" | "plan" | "watchPrompt";
  cacheScope?: string;
  userMessage: string;
  attachments?: ConversationAttachment[];
  watch: WatchContext;
  personaCore: string;
  userContext?: string;
  memories: MemorySnippet[];
  recentMessages?: ConversationTurn[];
  onStreamUpdate?: (text: string) => void;
}

export interface CompanionResponse {
  text: string;
  promptPreview?: string;
  modelUsed?: string;
  tokenCount?: number;
}

export interface LLMAdapter {
  complete(request: CompanionRequest): Promise<CompanionResponse>;
}

export interface CompanionAdapters {
  persona: PersonaAdapter;
  memory: MemoryAdapter;
  llm: LLMAdapter;
}

export interface CompanionPlanPoint {
  id: string;
  time: number;
  subtitle?: string;
  companionHint: string;
  type?: "emotion" | "observe" | "question" | "memory";
  priority?: "high" | "medium" | "low";
  delivery?: "auto" | "hint" | "manual";
}

export interface ConversationMessage {
  id: string;
  role: "user" | "companion";
  text: string;
  createdAt: string;
  attachments?: ConversationAttachment[];
  modelUsed?: string;
  tokenCount?: number;
}

export interface ConversationAttachment {
  id: string;
  type: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  text?: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  linkedWatchTitle?: string;
  linkedWatchRecordId?: string;
}
