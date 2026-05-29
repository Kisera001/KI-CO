import type { ConversationRecord, ModelProvider, UplinkSettings, WatchRecord } from "../types";
import { normalizeUplinkSettings } from "../settings/uplinkSettings";
import {
  exportConversationRecords,
  importConversationRecords,
  inspectConversationImport,
  type ConversationImportConflictMode,
  type ConversationImportInspection,
} from "./conversations";
import { importMemoryJson, listMemoryEntries, type MemoryEntry } from "./memoryBank";
import { normalizePersonaProfile, type PersonaProfile } from "./personaProfile";
import { exportWatchRecords, importWatchRecords } from "./watchRecords";

const FULL_SCHEMA = "kisera_cottage_full_backup_v1";
const SETTINGS_SCHEMA = "kisera_cottage_settings_backup_v1";

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
  watchRecords: WatchRecord[];
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

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeSettings(settings: UplinkSettings): UplinkSettings {
  const safe = cloneValue(settings);
  (Object.keys(safe.profiles) as ModelProvider[]).forEach((provider) => {
    safe.profiles[provider].apiKey = "";
  });
  return safe;
}

function keepLocalKeys(imported: UplinkSettings, current: UplinkSettings): UplinkSettings {
  const next = cloneValue(imported);
  (Object.keys(next.profiles) as ModelProvider[]).forEach((provider) => {
    next.profiles[provider].apiKey = current.profiles[provider]?.apiKey || "";
  });
  return next;
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
    watchRecords: exportWatchRecords(),
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

function parsePayload(text: string): CottageFullBackup | CottageSettingsBackup {
  const payload = JSON.parse(text) as {
    meta?: { schema?: unknown };
    settings?: unknown;
    personaProfile?: unknown;
  };
  if (!payload || typeof payload !== "object" || !payload.meta || !payload.settings || !payload.personaProfile) {
    throw new Error("不是有效的 Kisera Cottage 备份文件。");
  }
  const schema = payload.meta.schema;
  if (schema !== FULL_SCHEMA && schema !== SETTINGS_SCHEMA) {
    throw new Error("备份版本无法识别，请选择由开源小屋导出的 JSON 文件。");
  }
  return payload as unknown as CottageFullBackup | CottageSettingsBackup;
}

export function inspectBackupConversations(text: string): ConversationImportInspection | null {
  const payload = parsePayload(text);
  return payload.meta.schema === FULL_SCHEMA && Array.isArray((payload as CottageFullBackup).conversations)
    ? inspectConversationImport((payload as CottageFullBackup).conversations)
    : null;
}

export function importBackup(
  text: string,
  currentSettings: UplinkSettings,
  conflictMode: ConversationImportConflictMode = "merge",
): CottageImportResult {
  const payload = parsePayload(text);
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
  const watchReport = importWatchRecords(Array.isArray(fullPayload.watchRecords) ? fullPayload.watchRecords : []);

  return {
    kind: "full",
    settings: importedSettings,
    personaProfile,
    report: [
      "恢复成功。",
      `对话：新增 ${conversationReport.added} 条，合并 ${conversationReport.merged} 条，副本 ${conversationReport.copied} 条，复用相同 ${conversationReport.reusedIdentical} 条。`,
      `记忆库：新增 ${memoryReport.added} 条，合并 ${memoryReport.merged} 条。`,
      `片单：新增 ${watchReport.added} 条，更新 ${watchReport.merged} 条。`,
      "设置与人格核已恢复；API Key 不随备份传输。",
    ].join("\n"),
  };
}
