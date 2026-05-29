import type { ConversationMessage, ConversationRecord } from "../types";
import { slugifyTitle } from "../utils/time";

const STORAGE_KEY = "kisera_cinema_conversations_v1";

export type ConversationImportConflictMode = "merge" | "copy";

export interface ConversationImportInspection {
  total: number;
  identical: number;
  divergentSameId: number;
  reusableEquivalent: number;
  newRecords: number;
}

export interface ConversationImportReport {
  added: number;
  merged: number;
  copied: number;
  reusedIdentical: number;
}

function now() {
  return new Date().toISOString();
}

function createId(prefix = "chat") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readConversations(): ConversationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeConversations(conversations: ConversationRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, 120)));
}

function conversationFingerprint(conversation: ConversationRecord): string {
  return JSON.stringify({
    title: conversation.title,
    linkedWatchTitle: conversation.linkedWatchTitle || "",
    linkedWatchRecordId: conversation.linkedWatchRecordId || "",
    messages: conversation.messages,
  });
}

function mergeConversationMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const messages = new Map<string, ConversationMessage>();
  [...current, ...incoming].forEach((message) => {
    const key = message.id || `${message.role}:${message.createdAt}:${message.text}`;
    const previous = messages.get(key);
    messages.set(key, previous ? {
      ...message,
      ...previous,
      attachments: previous.attachments?.length ? previous.attachments : message.attachments,
    } : message);
  });
  return Array.from(messages.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listConversations(): ConversationRecord[] {
  return readConversations().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function exportConversationRecords(): ConversationRecord[] {
  return readConversations();
}

export function inspectConversationImport(incoming: ConversationRecord[]): ConversationImportInspection {
  const current = readConversations();
  const byId = new Map(current.map((conversation) => [conversation.id, conversation]));
  const currentFingerprints = new Set(current.map(conversationFingerprint));
  const inspection: ConversationImportInspection = {
    total: incoming.length,
    identical: 0,
    divergentSameId: 0,
    reusableEquivalent: 0,
    newRecords: 0,
  };

  incoming.forEach((conversation) => {
    const sameId = byId.get(conversation.id);
    const fingerprint = conversationFingerprint(conversation);
    if (sameId) {
      if (conversationFingerprint(sameId) === fingerprint) inspection.identical += 1;
      else inspection.divergentSameId += 1;
      return;
    }
    if (currentFingerprints.has(fingerprint)) inspection.reusableEquivalent += 1;
    else inspection.newRecords += 1;
  });

  return inspection;
}

export function importConversationRecords(
  incoming: ConversationRecord[],
  conflictMode: ConversationImportConflictMode = "merge",
): ConversationImportReport {
  const current = readConversations();
  const next = [...current];
  const report: ConversationImportReport = {
    added: 0,
    merged: 0,
    copied: 0,
    reusedIdentical: 0,
  };

  incoming.forEach((conversation) => {
    const sameIdIndex = next.findIndex((item) => item.id === conversation.id);
    const fingerprint = conversationFingerprint(conversation);
    if (sameIdIndex >= 0) {
      const existing = next[sameIdIndex];
      if (conversationFingerprint(existing) === fingerprint) {
        report.reusedIdentical += 1;
        return;
      }
      if (conflictMode === "copy") {
        next.unshift({
          ...conversation,
          id: createId("import"),
          title: `${conversation.title} (导入副本)`,
        });
        report.copied += 1;
        return;
      }
      next[sameIdIndex] = {
        ...existing,
        ...conversation,
        id: existing.id,
        createdAt: existing.createdAt < conversation.createdAt ? existing.createdAt : conversation.createdAt,
        updatedAt: existing.updatedAt > conversation.updatedAt ? existing.updatedAt : conversation.updatedAt,
        messages: mergeConversationMessages(existing.messages, conversation.messages),
      };
      report.merged += 1;
      return;
    }

    const equivalent = next.find((item) => conversationFingerprint(item) === fingerprint);
    if (equivalent) {
      report.reusedIdentical += 1;
      return;
    }

    next.unshift(conversation);
    report.added += 1;
  });

  writeConversations(next);
  return report;
}

export function getConversation(id: string): ConversationRecord | undefined {
  return readConversations().find((conversation) => conversation.id === id);
}

export function createConversation(title = "新的对话"): ConversationRecord {
  const createdAt = now();
  const conversation: ConversationRecord = {
    id: createId(),
    title,
    createdAt,
    updatedAt: createdAt,
    messages: [],
  };
  writeConversations([conversation, ...readConversations()]);
  return conversation;
}

export function saveConversation(next: ConversationRecord): ConversationRecord {
  const conversations = readConversations();
  const updated: ConversationRecord = {
    ...next,
    updatedAt: now(),
  };
  writeConversations([updated, ...conversations.filter((item) => item.id !== next.id)]);
  return updated;
}

export function renameConversation(id: string, title: string): ConversationRecord | undefined {
  const current = getConversation(id);
  if (!current) return undefined;
  return saveConversation({ ...current, title: title.trim() || current.title });
}

export function renameWatchConversationLink(oldRecordId: string, oldTitle: string, newRecordId: string, newTitle: string): void {
  const conversations = readConversations();
  const oldTitleKey = slugifyTitle(oldTitle || "");
  let changed = false;
  const next = conversations.map((conversation) => {
    const matchesRecord = conversation.linkedWatchRecordId === oldRecordId;
    const matchesTitle = Boolean(conversation.linkedWatchTitle && slugifyTitle(conversation.linkedWatchTitle) === oldTitleKey);
    if (!matchesRecord && !matchesTitle) return conversation;
    changed = true;
    return {
      ...conversation,
      title: conversation.title.includes(oldTitle) ? conversation.title.replace(oldTitle, newTitle) : conversation.title,
      linkedWatchTitle: newTitle,
      linkedWatchRecordId: newRecordId,
      updatedAt: now(),
    };
  });
  if (changed) writeConversations(next);
}

export function deleteConversation(id: string): void {
  writeConversations(readConversations().filter((conversation) => conversation.id !== id));
}

export function appendConversationMessages(
  conversationId: string,
  messages: Array<Omit<ConversationMessage, "id" | "createdAt">>,
): ConversationRecord | undefined {
  const current = getConversation(conversationId);
  if (!current) return undefined;
  const stampedMessages = messages.map((message) => ({
    ...message,
    id: createId(message.role),
    createdAt: now(),
  }));
  return saveConversation({
    ...current,
    messages: [...current.messages, ...stampedMessages],
  });
}

export function replaceConversationMessages(conversationId: string, messages: ConversationMessage[]): ConversationRecord | undefined {
  const current = getConversation(conversationId);
  if (!current) return undefined;
  return saveConversation({ ...current, messages });
}

export function findWatchConversation(title: string, recordId?: string): ConversationRecord | undefined {
  const watchKey = slugifyTitle(title || "untitled-movie");
  const conversations = readConversations();
  return conversations.find(
    (conversation) =>
      (recordId && conversation.linkedWatchRecordId === recordId)
      || (conversation.linkedWatchTitle && slugifyTitle(conversation.linkedWatchTitle) === watchKey),
  );
}

export function getOrCreateWatchConversation(title: string, recordId?: string): ConversationRecord {
  const existing = findWatchConversation(title, recordId);
  if (existing) return existing;

  const conversations = readConversations();
  const createdAt = now();
  const conversation: ConversationRecord = {
    id: createId("movie"),
    title: title ? `观影 · ${title}` : "观影对话",
    createdAt,
    updatedAt: createdAt,
    messages: [],
    linkedWatchTitle: title,
    linkedWatchRecordId: recordId,
  };
  writeConversations([conversation, ...conversations]);
  return conversation;
}
