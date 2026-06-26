import type { ConversationRecord, ModelProvider, UplinkSettings, WatchRecord } from "../types";
import { normalizeUplinkSettings } from "../settings/uplinkSettings";
import {
  exportConversationRecords,
  importConversationRecords,
  inspectConversationImport,
  type ConversationImportConflictMode,
  type ConversationImportInspection,
} from "./conversations";
import {
  exportVectorIndexBackup,
  importMemoryJson,
  importVectorIndexBackup,
  listMemoryEntries,
  type MemoryEntry,
  type VectorIndexBackup,
} from "./memoryBank";
import { normalizePersonaProfile, type PersonaProfile } from "./personaProfile";
import { exportWatchRecords, importWatchRecords } from "./watchRecords";
import {
  exportChronicles,
  getChroniclePreferences,
  getContinuityLine,
  importChronicles,
  listMemorySeeds,
  saveChroniclePreferences,
  saveContinuityLine,
  saveMemorySeeds,
  type ChronicleEntry,
  type ChroniclePreferences,
  type ContinuityLine,
  type MemorySeed,
} from "./chronicles";
import {
  exportSessionContinuity,
  importSessionContinuity,
  type SessionContinuityStore,
} from "../services/sessionStateService";

const FULL_SCHEMA = "kisera_cottage_full_backup_v1";
const SETTINGS_SCHEMA = "kisera_cottage_settings_backup_v1";
const LEGACY_APP_NAME_HINT = /sanctuary/i;

export interface CottageFullBackup {
  meta: {
    schema: typeof FULL_SCHEMA;
    version: "1.0";
    appName: "Kisera Cottage";
    exportedAt: string;
  };
  settings: UplinkSettings;
  personaProfile: PersonaProfile;
  conversations: ConversationRecord[];
  memories: MemoryEntry[];
  chronicles: ChronicleEntry[];
  memorySeeds: MemorySeed[];
  chroniclePreferences?: ChroniclePreferences;
  continuityLine?: ContinuityLine;
  sessionContinuity?: SessionContinuityStore;
  watchRecords: WatchRecord[];
  vectorIndex?: VectorIndexBackup;
}

export interface CottageSettingsBackup {
  meta: {
    schema: typeof SETTINGS_SCHEMA;
    version: "1.0";
    appName: "Kisera Cottage";
    exportedAt: string;
  };
  settings: UplinkSettings;
  personaProfile: PersonaProfile;
}

export interface CottageImportResult {
  kind: "full" | "settings";
  settings: UplinkSettings;
  personaProfile: PersonaProfile;
  report: string;
}

type LegacyBackupPayload = {
  meta?: {
    version?: string;
    exportedAt?: number;
    appName?: string;
  };
  config?: Record<string, any>;
  sessions?: any[];
  memories?: any[];
  chronicles?: any[];
  vectorIndex?: unknown;
  continuity?: {
    sessionStateCards?: Record<string, any>;
    continuitySystem?: Record<string, any>;
    memorySeeds?: any[];
  };
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeSettings(settings: UplinkSettings): UplinkSettings {
  const safe = cloneValue(settings);
  (Object.keys(safe.profiles) as ModelProvider[]).forEach((provider) => {
    safe.profiles[provider].apiKey = "";
  });
  if (safe.memoryRetrieval) {
    safe.memoryRetrieval.vectorOpenAIApiKey = "";
  }
  return safe;
}

function keepLocalKeys(imported: UplinkSettings, current: UplinkSettings): UplinkSettings {
  const next = cloneValue(imported);
  (Object.keys(next.profiles) as ModelProvider[]).forEach((provider) => {
    next.profiles[provider].apiKey = current.profiles[provider]?.apiKey || "";
  });
  if (next.memoryRetrieval && current.memoryRetrieval) {
    next.memoryRetrieval.vectorOpenAIApiKey = current.memoryRetrieval.vectorOpenAIApiKey || "";
  }
  return next;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isLegacyFullBackup(value: unknown): value is LegacyBackupPayload {
  const payload = asObject(value);
  const meta = asObject(payload.meta);
  return Array.isArray(payload.sessions)
    && typeof payload.config === "object"
    && ((typeof meta.appName === "string" && LEGACY_APP_NAME_HINT.test(meta.appName)) || "memories" in payload || "chronicles" in payload);
}

function toIso(value: unknown, fallback = Date.now()): string {
  const time = typeof value === "number"
    ? value
    : typeof value === "string"
      ? new Date(value).getTime()
      : fallback;
  return new Date(Number.isFinite(time) && time > 0 ? time : fallback).toISOString();
}

function toTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function normalizeAttachment(raw: any, index: number) {
  const content = typeof raw?.content === "string" ? raw.content : "";
  if (raw?.type !== "image" || !content.startsWith("data:image")) return null;
  const mimeType = content.match(/^data:([^;]+);/)?.[1] || "image/jpeg";
  return {
    id: String(raw.id || `import-image-${Date.now()}-${index}`),
    type: "image" as const,
    name: String(raw.name || raw.metadata?.source || `image-${index + 1}.jpg`),
    mimeType,
    size: Math.max(0, Math.round((content.length * 3) / 4)),
    dataUrl: content,
  };
}

function normalizeConversationMessage(raw: any, index: number) {
  const text = String(raw?.content ?? raw?.text ?? "").trim();
  const attachments = Array.isArray(raw?.attachments)
    ? raw.attachments.map((attachment: any, attachmentIndex: number) => normalizeAttachment(attachment, attachmentIndex)).filter(Boolean)
    : [];
  if (!text && attachments.length === 0) return null;
  const timestamp = raw?.timestamp ?? raw?.createdAt ?? raw?.time;
  return {
    id: String(raw?.id || `import-message-${Date.now()}-${index}`),
    role: raw?.role === "user" ? "user" as const : "companion" as const,
    text,
    createdAt: toIso(timestamp),
    attachments: attachments.length ? attachments : undefined,
    modelUsed: typeof raw?.modelUsed === "string" ? raw.modelUsed : undefined,
  };
}

function normalizeConversationRecord(raw: any, index: number): ConversationRecord | null {
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.map((message: any, messageIndex: number) => normalizeConversationMessage(message, messageIndex)).filter(Boolean)
    : [];
  const createdAt = toIso(raw?.createdAt, Date.now() + index);
  const updatedAt = toIso(raw?.lastModified ?? raw?.updatedAt ?? raw?.createdAt, Date.now() + index);
  return {
    id: String(raw?.id || `import-session-${Date.now()}-${index}`),
    title: String(raw?.title || `导入窗口 ${index + 1}`),
    createdAt,
    updatedAt,
    messages: messages as ConversationRecord["messages"],
  };
}

function normalizePersonaPosition(position: any, scale?: unknown) {
  return {
    x: typeof position?.x === "number" ? position.x : 50,
    y: typeof position?.y === "number" ? position.y : 50,
    scale: typeof position?.scale === "number"
      ? position.scale
      : typeof scale === "number"
        ? scale
        : 1,
  };
}

function normalizeLegacyPersonaProfile(config: Record<string, any>): PersonaProfile {
  const user = asObject(config.user);
  const personas = Array.isArray(config.personas) ? config.personas : [];
  const rawProfile = {
    userName: String(user.name || "User"),
    userAvatarDataUrl: String(user.avatar || ""),
    userAvatarPosition: normalizePersonaPosition(user.avatarPosition, user.avatarScale),
    showAvatars: user.showAvatars !== false,
    activePersonaId: String(config.activePersonaId || personas[0]?.id || ""),
    personas: personas.map((persona: any, index: number) => ({
      id: String(persona?.id || `persona-${index + 1}`),
      name: String(persona?.name || "Persona"),
      description: String(persona?.description || "长期 AI 伙伴"),
      systemPrompt: String(persona?.systemPrompt || ""),
      themeColor: String(persona?.themeColor || "#d5b16d"),
      avatarDataUrl: String(persona?.avatar || ""),
      avatarPosition: normalizePersonaPosition(persona?.avatarPosition, persona?.avatarScale),
      temperature: Number(persona?.temperature) || 0.75,
      contextDepth: Number(persona?.contextDepth) || 0,
      allowMemory: persona?.allowMemory !== false,
    })),
  };
  return normalizePersonaProfile(rawProfile);
}

function normalizeLegacySettings(config: Record<string, any>, currentSettings: UplinkSettings): UplinkSettings {
  const llm = asObject(config.llm);
  const appearance = asObject(config.appearance);
  const next = cloneValue(currentSettings);

  const activeProvider = String(llm.activeProvider || "");
  if (activeProvider === "glm" || activeProvider === "gemini") next.activeProvider = activeProvider;
  else if (activeProvider === "openai") next.activeProvider = "openrouter";

  if (typeof llm.historyDepth === "number") {
    next.contextLoad.shortTermMessageLimit = Math.max(0, Math.min(100, Math.round(llm.historyDepth)));
  }
  if (typeof llm.maxOutputTokens === "number") {
    next.contextLoad.maxOutputTokens = Math.max(256, Math.round(llm.maxOutputTokens));
  }
  if (llm.memoryRetrievalMode === "local" || llm.memoryRetrievalMode === "vector" || llm.memoryRetrievalMode === "hybrid") {
    next.memoryRetrieval.memoryRetrievalMode = llm.memoryRetrievalMode;
  }
  if (typeof llm.vectorTopK === "number") next.memoryRetrieval.vectorTopK = Math.max(1, Math.round(llm.vectorTopK));
  if (typeof llm.vectorScoreThreshold === "number") next.memoryRetrieval.vectorScoreThreshold = llm.vectorScoreThreshold;
  if (typeof llm.vectorRerank === "boolean") next.memoryRetrieval.vectorRerank = llm.vectorRerank;
  if (typeof llm.vectorCrossEncoderRerank === "boolean") next.memoryRetrieval.vectorCrossEncoderRerank = llm.vectorCrossEncoderRerank;
  if (typeof llm.vectorContextBudgetChars === "number") next.memoryRetrieval.vectorContextBudgetChars = Math.max(500, Math.round(llm.vectorContextBudgetChars));

  if (appearance.fontSize === "sm") next.visual.fontSize = "small";
  else if (appearance.fontSize === "lg") next.visual.fontSize = "large";
  else if (appearance.fontSize === "base") next.visual.fontSize = "standard";
  if (appearance.fontFamily === "serif") next.visual.fontStyle = "soft";
  next.visual.metaShowName = Boolean(appearance.metaShowName);
  next.visual.metaShowTime = Boolean(appearance.metaShowTime);
  next.visual.metaShowDate = appearance.metaShowDate !== false;
  next.visual.metaShowModel = Boolean(appearance.metaShowModel);
  next.visual.metaShowTokens = appearance.metaShowTokens !== false;

  return keepLocalKeys(normalizeUplinkSettings(next), currentSettings);
}

function normalizeLegacyMemorySeeds(seeds: unknown): MemorySeed[] {
  if (!Array.isArray(seeds)) return [];
  return seeds
    .map((seed, index) => {
      const raw = asObject(seed);
      const content = String(raw.content || "").trim();
      if (!content) return null;
      const sourceChronicleIds = Array.isArray(raw.sourceChronicleIds)
        ? raw.sourceChronicleIds.map(String)
        : raw.sourceChronicleId
          ? [String(raw.sourceChronicleId)]
          : [];
      const createdAt = toTimestamp(raw.createdAt);
      return {
        id: String(raw.id || `seed-${createdAt}-${index}`),
        title: String(raw.title || raw.sourceTitle || "未命名回忆"),
        content,
        date: String(raw.date || new Date(createdAt).toISOString().slice(0, 10)),
        tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 5) : [],
        importance: Math.max(1, Math.min(5, Number(raw.importance) || 4)),
        sourceChronicleIds,
        status: raw.status === "stored" || raw.status === "ignored" ? raw.status : "pending" as const,
        createdAt,
      };
    })
    .filter(Boolean) as MemorySeed[];
}

function normalizeLegacySessionContinuity(value: unknown): SessionContinuityStore {
  const source = asObject(value);
  const cards: SessionContinuityStore["cards"] = {};
  Object.entries(asObject(source.sessionStateCards)).forEach(([sessionId, cardValue]) => {
    const card = asObject(cardValue);
    cards[sessionId] = {
      sessionId,
      enabled: card.enabled !== false,
      visibleToPersona: (card.visibleToPersona ?? card.visibleToAi ?? card["visibleTo" + "So" + "lan"]) !== false,
      content: String(card.content || ""),
      lastMessageCount: Number(card.lastMessageCount) || 0,
      createdAt: Number(card.createdAt) || Date.now(),
      updatedAt: Number(card.updatedAt) || Date.now(),
    };
  });

  const continuitySystem = asObject(source.continuitySystem);
  const handoffs: SessionContinuityStore["handoffs"] = {};
  Object.values(asObject(continuitySystem.handoffs)).forEach((handoffValue) => {
    const handoff = asObject(handoffValue);
    const targetSessionId = String(handoff.targetSessionId || "");
    const sourceSessionId = String(handoff.sourceSessionId || "");
    if (!targetSessionId || !sourceSessionId) return;
    handoffs[targetSessionId] = {
      id: String(handoff.id || `handoff-${targetSessionId}`),
      sourceSessionId,
      targetSessionId,
      content: String(handoff.content || ""),
      includeContinuityLine: handoff.includeContinuityLine !== false,
      createdAt: Number(handoff.createdAt) || Date.now(),
      expiresAt: Number(handoff.expiresAt) || Date.now() + 24 * 60 * 60 * 1000,
      usedAt: Number(handoff.usedAt) || undefined,
    };
  });

  return { cards, handoffs };
}

function normalizeLegacyContinuityLine(value: unknown, activePersonaId: string): ContinuityLine | null {
  const continuitySystem = asObject(value);
  const preferences = asObject(continuitySystem.preferences);
  const lines = asObject(continuitySystem.lines);
  const selected = asObject(lines[activePersonaId] || Object.values(lines)[0]);
  const content = String(selected.content || "").trim();
  if (!content) return null;
  const recentDays = Number(selected.recentDays || preferences.recentDays);
  return {
    content,
    recentDays: recentDays === 3 || recentDays === 14 ? recentDays : 7,
    sourceChronicleIds: Array.isArray(selected.sourceChronicleIds) ? selected.sourceChronicleIds.map(String).slice(0, 40) : [],
    pinned: Array.isArray(selected.pinned) ? selected.pinned.slice(0, 3) : [],
    updatedAt: Number(selected.updatedAt) || Date.now(),
  };
}

export function createFullBackup(settings: UplinkSettings, personaProfile: PersonaProfile): CottageFullBackup {
  return {
    meta: {
      schema: FULL_SCHEMA,
      version: "1.0",
      appName: "Kisera Cottage",
      exportedAt: new Date().toISOString(),
    },
    settings: safeSettings(settings),
    personaProfile: cloneValue(personaProfile),
    conversations: exportConversationRecords(),
    memories: listMemoryEntries(),
    chronicles: exportChronicles(),
    memorySeeds: listMemorySeeds(true),
    chroniclePreferences: getChroniclePreferences(),
    continuityLine: getContinuityLine(),
    sessionContinuity: exportSessionContinuity(),
    watchRecords: exportWatchRecords(),
    vectorIndex: exportVectorIndexBackup(),
  };
}

export function createSettingsBackup(settings: UplinkSettings, personaProfile: PersonaProfile): CottageSettingsBackup {
  return {
    meta: {
      schema: SETTINGS_SCHEMA,
      version: "1.0",
      appName: "Kisera Cottage",
      exportedAt: new Date().toISOString(),
    },
    settings: safeSettings(settings),
    personaProfile: cloneValue(personaProfile),
  };
}

export function downloadBackup(filename: string, payload: CottageFullBackup | CottageSettingsBackup): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parsePayload(text: string): CottageFullBackup | CottageSettingsBackup | LegacyBackupPayload {
  const payload = JSON.parse(text) as {
    meta?: { schema?: unknown };
    settings?: unknown;
    personaProfile?: unknown;
  };
  if (isLegacyFullBackup(payload)) return payload;
  if (!payload || typeof payload !== "object" || !payload.meta || !payload.settings || !payload.personaProfile) {
    throw new Error("不是有效的 KI-CO / 羁星小屋备份文件。");
  }
  const schema = payload.meta.schema;
  if (schema !== FULL_SCHEMA && schema !== SETTINGS_SCHEMA) {
    throw new Error("备份版本无法识别，请选择由开源小屋或原版小屋导出的 JSON 文件。");
  }
  return payload as unknown as CottageFullBackup | CottageSettingsBackup;
}

export function inspectBackupConversations(text: string): ConversationImportInspection | null {
  const payload = parsePayload(text);
  if (isLegacyFullBackup(payload)) {
    const converted = (payload.sessions || [])
      .map((session, index) => normalizeConversationRecord(session, index))
      .filter(Boolean) as ConversationRecord[];
    return inspectConversationImport(converted);
  }
  return payload.meta.schema === FULL_SCHEMA && Array.isArray((payload as CottageFullBackup).conversations)
    ? inspectConversationImport((payload as CottageFullBackup).conversations)
    : null;
}

function importLegacyBackup(
  payload: LegacyBackupPayload,
  currentSettings: UplinkSettings,
  conflictMode: ConversationImportConflictMode,
): CottageImportResult {
  const config = asObject(payload.config);
  const importedSettings = normalizeLegacySettings(config, currentSettings);
  const personaProfile = normalizeLegacyPersonaProfile(config);
  const convertedConversations = (payload.sessions || [])
    .map((session, index) => normalizeConversationRecord(session, index))
    .filter(Boolean) as ConversationRecord[];

  const conversationReport = importConversationRecords(convertedConversations, conflictMode);
  const memoryReport = importMemoryJson(JSON.stringify(Array.isArray(payload.memories) ? payload.memories : []));
  const chronicleReport = importChronicles(Array.isArray(payload.chronicles) ? payload.chronicles : []);

  const continuity = asObject(payload.continuity);
  const continuitySystem = asObject(continuity.continuitySystem);
  const preferences = asObject(continuitySystem.preferences);
  if ("includeContinuityLine" in preferences || "enableMemoryRecall" in preferences || "recentDays" in preferences) {
    saveChroniclePreferences({
      includeContinuityLine: preferences.includeContinuityLine !== false,
      enableMemoryRecall: preferences.enableMemoryRecall !== false,
      recentDays: preferences.recentDays === 3 || preferences.recentDays === 14 ? preferences.recentDays : 7,
    });
  }
  const continuityLine = normalizeLegacyContinuityLine(continuitySystem, personaProfile.activePersonaId);
  if (continuityLine) saveContinuityLine(continuityLine);

  const memorySeeds = normalizeLegacyMemorySeeds(continuity.memorySeeds);
  if (memorySeeds.length) saveMemorySeeds(memorySeeds);

  const sessionContinuityReport = importSessionContinuity(
    normalizeLegacySessionContinuity(continuity),
    conversationReport.idMap,
  );
  const vectorReport = payload.vectorIndex
    ? importVectorIndexBackup(JSON.stringify(payload.vectorIndex))
    : { indexCount: 0, obsidianDocCount: 0 };

  return {
    kind: "full",
    settings: importedSettings,
    personaProfile,
    report: [
      "已按原版小屋备份格式恢复。",
      `对话：新增 ${conversationReport.added} 条，合并 ${conversationReport.merged} 条，副本 ${conversationReport.copied} 条，复用相同 ${conversationReport.reusedIdentical} 条。`,
      `记忆库：新增 ${memoryReport.added} 条，合并 ${memoryReport.merged} 条。`,
      `时光回廊：新增 ${chronicleReport.added} 篇，合并 ${chronicleReport.merged} 篇。`,
      `窗口接续：恢复状态卡 ${sessionContinuityReport.cards} 张，接续便签 ${sessionContinuityReport.handoffs} 条。`,
      `生活线：${continuityLine ? "已恢复" : "未发现可恢复内容"}；回忆种子：${memorySeeds.length} 条。`,
      `向量索引：vectors ${vectorReport.indexCount} 条，Obsidian ${vectorReport.obsidianDocCount} 条。`,
      "API Key 不随备份传输；当前设备已填写的 Key 会继续保留。",
    ].join("\n"),
  };
}

export function importBackup(
  text: string,
  currentSettings: UplinkSettings,
  conflictMode: ConversationImportConflictMode = "merge",
): CottageImportResult {
  const payload = parsePayload(text);
  if (isLegacyFullBackup(payload)) {
    return importLegacyBackup(payload, currentSettings, conflictMode);
  }
  const importedSettings = keepLocalKeys(normalizeUplinkSettings(payload.settings), currentSettings);
  const personaProfile = normalizePersonaProfile(payload.personaProfile);

  if (payload.meta.schema === SETTINGS_SCHEMA) {
    return {
      kind: "settings",
      settings: importedSettings,
      personaProfile,
      report: "系统配置与人格核已恢复。API Key 保留当前设备本地填写的内容。",
    };
  }

  const fullPayload = payload as CottageFullBackup;
  const conversationReport = importConversationRecords(
    Array.isArray(fullPayload.conversations) ? fullPayload.conversations : [],
    conflictMode,
  );
  const memoryReport = importMemoryJson(JSON.stringify(Array.isArray(fullPayload.memories) ? fullPayload.memories : []));
  const chronicleReport = importChronicles(Array.isArray(fullPayload.chronicles) ? fullPayload.chronicles : []);
  if (Array.isArray(fullPayload.memorySeeds)) saveMemorySeeds(fullPayload.memorySeeds);
  if (fullPayload.chroniclePreferences) saveChroniclePreferences(fullPayload.chroniclePreferences);
  if (fullPayload.continuityLine) saveContinuityLine(fullPayload.continuityLine);
  const sessionContinuityReport = fullPayload.sessionContinuity
    ? importSessionContinuity(fullPayload.sessionContinuity, conversationReport.idMap)
    : { cards: 0, handoffs: 0 };
  const watchReport = importWatchRecords(Array.isArray(fullPayload.watchRecords) ? fullPayload.watchRecords : []);
  const vectorReport = fullPayload.vectorIndex
    ? importVectorIndexBackup(JSON.stringify(fullPayload.vectorIndex))
    : { indexCount: 0, obsidianDocCount: 0 };

  return {
    kind: "full",
    settings: importedSettings,
    personaProfile,
    report: [
      "恢复成功。",
      `对话：新增 ${conversationReport.added} 条，合并 ${conversationReport.merged} 条，副本 ${conversationReport.copied} 条，复用相同 ${conversationReport.reusedIdentical} 条。`,
      `记忆库：新增 ${memoryReport.added} 条，合并 ${memoryReport.merged} 条。`,
      `时光回廊：新增 ${chronicleReport.added} 篇，合并 ${chronicleReport.merged} 篇。`,
      `窗口接续：恢复状态卡 ${sessionContinuityReport.cards} 张，接续便签 ${sessionContinuityReport.handoffs} 条。`,
      `片单：新增 ${watchReport.added} 条，更新 ${watchReport.merged} 条。`,
      `向量索引：vectors ${vectorReport.indexCount} 条，Obsidian ${vectorReport.obsidianDocCount} 条。`,
      "设置与人格核已恢复；API Key 不随备份传输。",
    ].join("\n"),
  };
}
