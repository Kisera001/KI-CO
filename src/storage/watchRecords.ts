import type { WatchRecord } from "../types";
import { slugifyTitle } from "../utils/time";

const STORAGE_KEY = "kisera_cinema_watch_records_v1";

function readRecords(): WatchRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeRecords(records: WatchRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 80)));
}

function getUniqueTitleAndId(title: string, records: WatchRecord[], currentId?: string): { title: string; id: string } {
  const baseTitle = title.trim() || "untitled";
  let nextTitle = baseTitle;
  let nextId = slugifyTitle(nextTitle);
  let suffix = 2;

  while (records.some((record) => record.id === nextId && record.id !== currentId)) {
    nextTitle = `${baseTitle} (${suffix})`;
    nextId = slugifyTitle(nextTitle);
    suffix += 1;
  }

  return { title: nextTitle, id: nextId };
}

export function listWatchRecords(): WatchRecord[] {
  return readRecords().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function exportWatchRecords(): WatchRecord[] {
  return readRecords();
}

export function importWatchRecords(incoming: WatchRecord[]): { added: number; merged: number } {
  const current = readRecords();
  const next = [...current];
  let added = 0;
  let merged = 0;

  incoming.forEach((record) => {
    const index = next.findIndex((item) => item.id === record.id);
    if (index < 0) {
      next.unshift(record);
      added += 1;
      return;
    }
    const existing = next[index];
    next[index] = record.updatedAt >= existing.updatedAt ? { ...existing, ...record } : { ...record, ...existing };
    merged += 1;
  });

  writeRecords(next);
  return { added, merged };
}

export function saveWatchRecord(record: Omit<WatchRecord, "id" | "updatedAt">): WatchRecord {
  const records = readRecords();
  const id = slugifyTitle(record.title);
  const previous = records.find((item) => item.id === id);
  const next: WatchRecord = {
    ...previous,
    ...record,
    thumbnailDataUrl: record.thumbnailDataUrl || previous?.thumbnailDataUrl,
    subtitleFileName: record.subtitleFileName || previous?.subtitleFileName,
    subtitleCount: record.subtitleCount || previous?.subtitleCount,
    subtitleOffsetSeconds: record.subtitleOffsetSeconds ?? previous?.subtitleOffsetSeconds,
    companionPlan: record.companionPlan ?? previous?.companionPlan,
    companionMode: record.companionMode || previous?.companionMode,
    companionDensity: record.companionDensity || previous?.companionDensity,
    triggeredPlanIds: record.triggeredPlanIds ?? previous?.triggeredPlanIds,
    id,
    updatedAt: new Date().toISOString(),
  };
  writeRecords([next, ...records.filter((item) => item.id !== id)]);
  return next;
}

export function renameWatchRecord(id: string, title: string): WatchRecord | undefined {
  const records = readRecords();
  const current = records.find((record) => record.id === id);
  const trimmedTitle = title.trim();
  if (!current || !trimmedTitle) return undefined;

  const unique = getUniqueTitleAndId(trimmedTitle, records, id);
  const renamed: WatchRecord = {
    ...current,
    id: unique.id,
    title: unique.title,
    updatedAt: new Date().toISOString(),
  };

  writeRecords([renamed, ...records.filter((record) => record.id !== id)]);
  return renamed;
}

export function removeWatchRecord(id: string): void {
  writeRecords(readRecords().filter((record) => record.id !== id));
}
