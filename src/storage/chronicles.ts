const CHRONICLE_KEY = "kisera_cottage_chronicles_v1";
const CHRONICLE_PREFS_KEY = "kisera_cottage_chronicle_preferences_v1";
const CHRONICLE_SEEDS_KEY = "kisera_cottage_memory_seeds_v1";
const CONTINUITY_KEY = "kisera_cottage_continuity_line_v1";
const CHRONICLE_EVENT = "kisera-cottage-chronicles-updated";

export interface ChronicleEntry {
  id: string;
  title: string;
  diaryTitle?: string;
  content: string;
  dateRange: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  starred: boolean;
  mode: "auto" | "manual";
  triggerKeywords: string[];
  facts: string[];
  sessionId?: string;
  sessionTitle?: string;
  personaId?: string;
  personaName?: string;
  roundCount?: number;
}

export interface ChroniclePreferences {
  autoEnabled: boolean;
  summaryFrequency: number;
  includeContinuityLine: boolean;
  enableMemoryRecall: boolean;
  recentDays: 3 | 7 | 14;
}

export interface MemorySeed {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  importance: number;
  sourceChronicleIds: string[];
  status: "pending" | "stored" | "ignored";
  createdAt: number;
}

export interface ContinuityLine {
  content: string;
  recentDays: 3 | 7 | 14;
  sourceChronicleIds: string[];
  pinned: Array<{ id: string; content: string; createdAt: number }>;
  updatedAt: number;
}

const DEFAULT_PREFERENCES: ChroniclePreferences = {
  autoEnabled: true,
  summaryFrequency: 20,
  includeContinuityLine: true,
  enableMemoryRecall: true,
  recentDays: 7,
};

function emitUpdate() {
  window.dispatchEvent(new CustomEvent(CHRONICLE_EVENT));
}

function uniqueStrings(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, max);
}

function normalizeEntry(raw: Partial<ChronicleEntry>, index = 0): ChronicleEntry | null {
  const content = String(raw?.content || "").trim();
  if (!content) return null;
  const createdAt = Number(raw?.createdAt) || Date.now();
  const mode = raw?.mode === "manual" || String(raw?.title || "").includes("手动") ? "manual" : "auto";
  return {
    id: String(raw?.id || `chronicle-${createdAt}-${index}`),
    title: String(raw?.title || raw?.diaryTitle || "未命名日记").trim(),
    diaryTitle: String(raw?.diaryTitle || "").trim() || undefined,
    content,
    dateRange: String(raw?.dateRange || new Date(createdAt).toLocaleDateString()).trim(),
    createdAt,
    updatedAt: Number(raw?.updatedAt) || createdAt,
    isActive: raw?.isActive !== false,
    starred: !!raw?.starred,
    mode,
    triggerKeywords: uniqueStrings(raw?.triggerKeywords),
    facts: uniqueStrings(raw?.facts, 20),
    sessionId: raw?.sessionId ? String(raw.sessionId) : undefined,
    sessionTitle: raw?.sessionTitle ? String(raw.sessionTitle) : undefined,
    personaId: raw?.personaId ? String(raw.personaId) : undefined,
    personaName: raw?.personaName ? String(raw.personaName) : undefined,
    roundCount: Number(raw?.roundCount) || undefined,
  };
}

function saveChronicles(entries: ChronicleEntry[]) {
  localStorage.setItem(CHRONICLE_KEY, JSON.stringify(entries));
  emitUpdate();
}

export function listChronicles(): ChronicleEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHRONICLE_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map((entry, index) => normalizeEntry(entry, index))
      .filter(Boolean)
      .sort((a, b) => b!.createdAt - a!.createdAt) as ChronicleEntry[];
  } catch {
    return [];
  }
}

export function addChronicle(input: Omit<ChronicleEntry, "id" | "updatedAt"> & { id?: string }): ChronicleEntry {
  const entry = normalizeEntry({ ...input, id: input.id || `chronicle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, updatedAt: Date.now() });
  if (!entry) throw new Error("日记内容不能为空。");
  saveChronicles([entry, ...listChronicles()]);
  return entry;
}

export function updateChronicle(id: string, patch: Partial<ChronicleEntry>): ChronicleEntry | null {
  let updated: ChronicleEntry | null = null;
  const next = listChronicles().map((entry) => {
    if (entry.id !== id) return entry;
    updated = normalizeEntry({ ...entry, ...patch, id, updatedAt: Date.now() });
    return updated || entry;
  });
  saveChronicles(next);
  return updated;
}

export function removeChronicle(id: string) {
  saveChronicles(listChronicles().filter((entry) => entry.id !== id));
}

export function importChronicles(value: unknown): { added: number; merged: number; skipped: number } {
  const rows = Array.isArray(value) ? value : Array.isArray((value as any)?.chronicles) ? (value as any).chronicles : [];
  const current = listChronicles();
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const fingerprints = new Set(current.map((entry) => `${entry.title}\n${entry.dateRange}\n${entry.content}`.replace(/\s+/g, " ").toLowerCase()));
  let added = 0;
  let merged = 0;
  let skipped = 0;
  rows.forEach((raw: Partial<ChronicleEntry>, index: number) => {
    const incoming = normalizeEntry(raw, index);
    if (!incoming) { skipped += 1; return; }
    const fingerprint = `${incoming.title}\n${incoming.dateRange}\n${incoming.content}`.replace(/\s+/g, " ").toLowerCase();
    const existing = byId.get(incoming.id);
    if (!existing && fingerprints.has(fingerprint)) { skipped += 1; return; }
    if (!existing) {
      byId.set(incoming.id, incoming);
      fingerprints.add(fingerprint);
      added += 1;
      return;
    }
    byId.set(incoming.id, {
      ...existing,
      ...incoming,
      content: incoming.content.length > existing.content.length ? incoming.content : existing.content,
      triggerKeywords: uniqueStrings([...existing.triggerKeywords, ...incoming.triggerKeywords]),
      facts: uniqueStrings([...existing.facts, ...incoming.facts], 20),
      starred: existing.starred || incoming.starred,
    });
    merged += 1;
  });
  if (added || merged) saveChronicles([...byId.values()]);
  return { added, merged, skipped };
}

export function exportChronicles() {
  return listChronicles();
}

export function getChroniclePreferences(): ChroniclePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(CHRONICLE_PREFS_KEY) || "{}");
    const recentDays = Number(raw.recentDays);
    return {
      ...DEFAULT_PREFERENCES,
      ...raw,
      summaryFrequency: Math.max(5, Math.min(100, Number(raw.summaryFrequency) || 20)),
      recentDays: recentDays === 3 || recentDays === 14 ? recentDays : 7,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveChroniclePreferences(patch: Partial<ChroniclePreferences>): ChroniclePreferences {
  const next = { ...getChroniclePreferences(), ...patch };
  localStorage.setItem(CHRONICLE_PREFS_KEY, JSON.stringify(next));
  emitUpdate();
  return next;
}

export function listMemorySeeds(includeResolved = false): MemorySeed[] {
  try {
    const rows = JSON.parse(localStorage.getItem(CHRONICLE_SEEDS_KEY) || "[]");
    const normalized = (Array.isArray(rows) ? rows : []).map((seed: Partial<MemorySeed>, index: number): MemorySeed => ({
      id: String(seed.id || `seed-${Date.now()}-${index}`),
      title: String(seed.title || "未命名回忆"),
      content: String(seed.content || "").trim(),
      date: String(seed.date || ""),
      tags: uniqueStrings(seed.tags, 5),
      importance: Math.max(1, Math.min(5, Number(seed.importance) || 4)),
      sourceChronicleIds: uniqueStrings(seed.sourceChronicleIds, 12),
      status: seed.status === "stored" || seed.status === "ignored" ? seed.status : "pending",
      createdAt: Number(seed.createdAt) || Date.now(),
    })).filter((seed: MemorySeed) => seed.content);
    return includeResolved ? normalized : normalized.filter((seed: MemorySeed) => seed.status === "pending");
  } catch {
    return [];
  }
}

export function saveMemorySeeds(seeds: MemorySeed[]) {
  localStorage.setItem(CHRONICLE_SEEDS_KEY, JSON.stringify(seeds));
  emitUpdate();
}

export function addMemorySeeds(rows: Array<Omit<MemorySeed, "id" | "status" | "createdAt">>): MemorySeed[] {
  const current = listMemorySeeds(true);
  const fingerprints = new Set(current.map((seed) => seed.content.replace(/\s+/g, " ").toLowerCase()));
  rows.forEach((row, index) => {
    const fingerprint = row.content.replace(/\s+/g, " ").toLowerCase();
    if (!row.content.trim() || fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    current.push({ ...row, id: `seed-${Date.now()}-${index}`, status: "pending", createdAt: Date.now() });
  });
  saveMemorySeeds(current);
  return current.filter((seed) => seed.status === "pending");
}

export function resolveMemorySeed(id: string, status: "stored" | "ignored") {
  saveMemorySeeds(listMemorySeeds(true).map((seed) => seed.id === id ? { ...seed, status } : seed));
}

export function getContinuityLine(): ContinuityLine {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTINUITY_KEY) || "{}");
    return {
      content: String(raw.content || ""),
      recentDays: raw.recentDays === 3 || raw.recentDays === 14 ? raw.recentDays : 7,
      sourceChronicleIds: uniqueStrings(raw.sourceChronicleIds, 40),
      pinned: Array.isArray(raw.pinned) ? raw.pinned.slice(0, 3) : [],
      updatedAt: Number(raw.updatedAt) || 0,
    };
  } catch {
    return { content: "", recentDays: 7, sourceChronicleIds: [], pinned: [], updatedAt: 0 };
  }
}

export function saveContinuityLine(patch: Partial<ContinuityLine>): ContinuityLine {
  const next = { ...getContinuityLine(), ...patch, updatedAt: Date.now() };
  localStorage.setItem(CONTINUITY_KEY, JSON.stringify(next));
  emitUpdate();
  return next;
}

export function subscribeChronicles(listener: () => void): () => void {
  window.addEventListener(CHRONICLE_EVENT, listener);
  return () => window.removeEventListener(CHRONICLE_EVENT, listener);
}
