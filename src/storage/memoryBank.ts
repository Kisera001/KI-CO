import type { MemorySnippet } from "../types";

export interface LocalRetrievalCandidate {
  id: string;
  title: string;
  tags: string[];
  score: number;
  matchedTokens: string[];
  updatedAt: string;
  selected: boolean;
}

export interface LocalRetrievalStats {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
  cacheSize: number;
  lastCacheKey?: string;
}

export interface LocalRetrievalDebugResult {
  query: string;
  normalizedQuery: string;
  cacheKey: string;
  cacheHit: boolean;
  elapsedMs: number;
  totalEntries: number;
  candidateCount: number;
  tokens: string[];
  candidates: LocalRetrievalCandidate[];
  snippets: MemorySnippet[];
  stats: LocalRetrievalStats;
  explanation: string[];
}

export interface ContextRetrievalTurn {
  id: string;
  timestamp: number;
  query: string;
  cacheHit: boolean;
  elapsedMs: number;
  totalEntries: number;
  candidateCount: number;
  snippets: MemorySnippet[];
  estimatedTokens: number;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  aliases: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
  sourceType?: string;
  sourceId?: string;
  sourceTitle?: string;
}

export interface MemoryImportStats {
  entries: MemoryEntry[];
  added: number;
  merged: number;
}

const STORAGE_KEY = "kisera_cinema_memory_bank_v2";
const LEGACY_STORAGE_KEYS = ["kisera_cinema_memory_bank_v1"];
const RETRIEVAL_STATS_KEY = "kisera_cottage_local_retrieval_cache_stats_v1";
const CONTEXT_RETRIEVAL_HISTORY_KEY = "kisera_cottage_context_retrieval_history_v1";
const CONTEXT_RETRIEVAL_UPDATE_EVENT = "kisera-cottage-context-retrieval-updated";
const CONTEXT_RETRIEVAL_HISTORY_LIMIT = 30;
const MAX_TAGS = 16;
const MAX_ALIASES = 48;
const retrievalCache = new Map<string, Omit<LocalRetrievalDebugResult, "cacheHit" | "elapsedMs" | "stats">>();

export const DEFAULT_MEMORY_ENTRIES: MemoryEntry[] = [
  {
    id: "memory-demo-1",
    title: "记忆库使用示意",
    content: "记忆库复刻，可以复制 GPT/Claude/Gemini 的那些记忆库条目内容，每一个条目最好不要过长，建议 1000 字以内。",
    tags: ["使用说明", "记忆库"],
    aliases: ["GPT记忆", "条目长度", "导入建议"],
    importance: 3,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "memory-demo-2",
    title: "example 示意",
    content: "这里可以记录关系背景、长期偏好和重要节点、锚点、核心事件。长对话与观影室都会按相关性调用。",
    tags: ["长期项目", "记忆库"],
    aliases: ["项目背景", "跨页面记忆", "重要节点"],
    importance: 2,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

const STOP_WORDS = new Set([
  "的",
  "了",
  "和",
  "是",
  "在",
  "就",
  "也",
  "都",
  "一个",
  "一些",
  "使用者",
  "用户",
  "persona",
  "companion",
  "user",
  "ai",
]);

const TAG_KEYWORDS: Array<{ tag: string; terms: string[] }> = [
  { tag: "相处方式", terms: ["喜欢", "不喜欢", "回应", "语气", "陪伴", "自然", "模板"] },
  { tag: "长期项目", terms: ["项目", "计划", "开发", "代码", "开源", "观影室", "小屋"] },
  { tag: "创作设定", terms: ["创作", "角色", "设定", "故事", "小说", "剧本", "画风"] },
  { tag: "观影偏好", terms: ["电影", "字幕", "截图", "陪看", "片单", "视频", "观影"] },
  { tag: "情绪支持", terms: ["难过", "焦虑", "吵架", "家人", "朋友", "压力", "抱"] },
  { tag: "技术偏好", terms: ["bug", "调试", "接口", "api", "模型", "缓存", "向量", "配置"] },
];

function makeId() {
  return `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeDate(value: unknown, fallback = nowIso()) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function normalizeImportance(value: unknown, fallback = 2) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function uniqueClean(values: unknown[], limit: number) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

export function parseTags(value: string): string[] {
  return uniqueClean(value.split(/[,，#\s]+/), MAX_TAGS);
}

function tokenize(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const tokens = new Set<string>();
  normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .forEach((token) => tokens.add(token));

  const cjkOnly = normalized.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let index = 0; index < cjkOnly.length - 1; index += 1) {
    const token = cjkOnly.slice(index, index + 2);
    if (!STOP_WORDS.has(token)) tokens.add(token);
  }

  return Array.from(tokens).slice(0, MAX_ALIASES);
}

function normalizeRetrievalQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readRetrievalStats(): Omit<LocalRetrievalStats, "total" | "hitRate" | "cacheSize"> {
  try {
    const raw = localStorage.getItem(RETRIEVAL_STATS_KEY);
    if (!raw) return { hits: 0, misses: 0 };
    const parsed = JSON.parse(raw);
    return {
      hits: Math.max(0, Number(parsed?.hits) || 0),
      misses: Math.max(0, Number(parsed?.misses) || 0),
      lastCacheKey: typeof parsed?.lastCacheKey === "string" ? parsed.lastCacheKey : undefined,
    };
  } catch {
    return { hits: 0, misses: 0 };
  }
}

function writeRetrievalStats(stats: Omit<LocalRetrievalStats, "total" | "hitRate" | "cacheSize">): void {
  try {
    localStorage.setItem(RETRIEVAL_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Local storage can be unavailable in privacy modes; retrieval still works without persisted stats.
  }
}

function buildRetrievalStats(patch?: Partial<Omit<LocalRetrievalStats, "total" | "hitRate" | "cacheSize">>): LocalRetrievalStats {
  const stored = { ...readRetrievalStats(), ...patch };
  const hits = Math.max(0, stored.hits || 0);
  const misses = Math.max(0, stored.misses || 0);
  const total = hits + misses;
  return {
    hits,
    misses,
    total,
    hitRate: total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
    cacheSize: retrievalCache.size,
    lastCacheKey: stored.lastCacheKey,
  };
}

function persistRetrievalHit(cacheKey: string): LocalRetrievalStats {
  const stats = readRetrievalStats();
  const next = { ...stats, hits: (stats.hits || 0) + 1, lastCacheKey: cacheKey };
  writeRetrievalStats(next);
  return buildRetrievalStats(next);
}

function persistRetrievalMiss(cacheKey: string): LocalRetrievalStats {
  const stats = readRetrievalStats();
  const next = { ...stats, misses: (stats.misses || 0) + 1, lastCacheKey: cacheKey };
  writeRetrievalStats(next);
  return buildRetrievalStats(next);
}

function memorySignature(entries: MemoryEntry[]): string {
  return entries
    .map((entry) => `${entry.id}:${entry.updatedAt}:${entry.content.length}`)
    .join("|");
}

function makeRetrievalCacheKey(entries: MemoryEntry[], query: string, limit: number): string {
  return JSON.stringify({
    mode: "local-memory",
    limit,
    query: normalizeRetrievalQuery(query),
    signature: memorySignature(entries),
  });
}

export function getLocalRetrievalCacheStats(): LocalRetrievalStats {
  return buildRetrievalStats();
}

export function clearLocalRetrievalCache(): LocalRetrievalStats {
  retrievalCache.clear();
  const next = { hits: 0, misses: 0, lastCacheKey: undefined };
  writeRetrievalStats(next);
  return buildRetrievalStats(next);
}

function estimateContextTokens(snippets: MemorySnippet[]): number {
  return snippets.reduce((sum, snippet) => sum + Math.max(1, Math.ceil(`${snippet.title}\n${snippet.text}`.length / 2.6)), 0);
}

function readContextRetrievalHistory(): ContextRetrievalTurn[] {
  try {
    const raw = localStorage.getItem(CONTEXT_RETRIEVAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, CONTEXT_RETRIEVAL_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function recordContextRetrieval(result: LocalRetrievalDebugResult): void {
  const turn: ContextRetrievalTurn = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    query: result.query,
    cacheHit: result.cacheHit,
    elapsedMs: result.elapsedMs,
    totalEntries: result.totalEntries,
    candidateCount: result.candidateCount,
    snippets: result.snippets,
    estimatedTokens: estimateContextTokens(result.snippets),
  };
  try {
    localStorage.setItem(
      CONTEXT_RETRIEVAL_HISTORY_KEY,
      JSON.stringify([turn, ...readContextRetrievalHistory()].slice(0, CONTEXT_RETRIEVAL_HISTORY_LIMIT)),
    );
  } catch {
    // The active conversation still receives retrieved snippets if storage is unavailable.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONTEXT_RETRIEVAL_UPDATE_EVENT));
  }
}

export function getContextRetrievalHistory(limit = CONTEXT_RETRIEVAL_HISTORY_LIMIT): ContextRetrievalTurn[] {
  return readContextRetrievalHistory().slice(0, Math.max(1, limit));
}

export function clearContextRetrievalHistory(): void {
  try {
    localStorage.removeItem(CONTEXT_RETRIEVAL_HISTORY_KEY);
  } catch {
    // Ignore storage errors while clearing diagnostics.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONTEXT_RETRIEVAL_UPDATE_EVENT));
  }
}

export function subscribeContextRetrievalHistory(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(CONTEXT_RETRIEVAL_UPDATE_EVENT, handler);
  return () => window.removeEventListener(CONTEXT_RETRIEVAL_UPDATE_EVENT, handler);
}

function inferTags(content: string, currentTags: string[]) {
  const text = content.toLowerCase();
  const inferred = TAG_KEYWORDS
    .filter((item) => item.terms.some((term) => text.includes(term.toLowerCase())))
    .map((item) => item.tag);
  return uniqueClean([...currentTags.filter((tag) => tag !== "通用"), ...inferred], MAX_TAGS);
}

function buildAliases(content: string, tags: string[], aliases: string[] = []) {
  return uniqueClean([...aliases, ...tags, ...tokenize(content)], MAX_ALIASES);
}

function normalizeEntry(raw: Partial<MemoryEntry> | null | undefined, index = 0): MemoryEntry | null {
  const content = normalizeText(raw?.content).trim();
  if (!content) return null;

  const createdAt = normalizeDate(raw?.createdAt);
  const updatedAt = normalizeDate(raw?.updatedAt, createdAt);
  const title = normalizeText(raw?.title, content.slice(0, 24)).trim() || `记忆 ${index + 1}`;
  const tags = Array.isArray(raw?.tags) ? uniqueClean(raw.tags, MAX_TAGS) : [];
  const aliases = Array.isArray(raw?.aliases) ? uniqueClean(raw.aliases, MAX_ALIASES) : [];

  return {
    id: normalizeText(raw?.id, makeId()),
    title,
    content,
    tags: tags.length ? tags : ["通用"],
    aliases: buildAliases(content, tags, aliases),
    importance: normalizeImportance(raw?.importance, 2),
    createdAt,
    updatedAt,
    sourceType: normalizeText(raw?.sourceType, ""),
    sourceId: normalizeText(raw?.sourceId, ""),
    sourceTitle: normalizeText(raw?.sourceTitle, ""),
  };
}

export function normalizeMemoryEntries(raw: unknown, fallbackToDefault = false): MemoryEntry[] {
  if (!Array.isArray(raw)) return fallbackToDefault ? DEFAULT_MEMORY_ENTRIES : [];
  const entries = raw
    .map((entry, index) => normalizeEntry(entry as Partial<MemoryEntry>, index))
    .filter(Boolean) as MemoryEntry[];
  return entries.length ? entries : fallbackToDefault ? DEFAULT_MEMORY_ENTRIES : [];
}

export function listMemoryEntries(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeMemoryEntries(JSON.parse(raw));

    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const entries = normalizeMemoryEntries(JSON.parse(legacy), true);
        saveMemoryEntries(entries);
        return entries;
      }
    }

    return DEFAULT_MEMORY_ENTRIES;
  } catch {
    return DEFAULT_MEMORY_ENTRIES;
  }
}

export function saveMemoryEntries(entries: MemoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeMemoryEntries(entries)));
}

export function createMemoryEntry(input: { title: string; content: string; tags: string[]; importance?: number }): MemoryEntry {
  const createdAt = nowIso();
  const content = input.content.trim();
  const tags = input.tags.length ? input.tags : ["通用"];
  return {
    id: makeId(),
    title: input.title.trim() || content.slice(0, 24) || "未命名记忆",
    content,
    tags,
    aliases: buildAliases(content, tags),
    importance: input.importance ?? 3,
    createdAt,
    updatedAt: createdAt,
  };
}

export function upsertMemoryEntry(entry: MemoryEntry): void {
  const entries = listMemoryEntries();
  const index = entries.findIndex((item) => item.id === entry.id);
  const normalized = normalizeEntry({ ...entry, updatedAt: nowIso() });
  if (!normalized) return;
  if (index >= 0) entries[index] = normalized;
  else entries.unshift(normalized);
  saveMemoryEntries(entries);
}

export function removeMemoryEntry(id: string): void {
  saveMemoryEntries(listMemoryEntries().filter((entry) => entry.id !== id));
}

export function organizeMemoryEntries(mode: "untagged" | "all"): MemoryEntry[] {
  const entries = listMemoryEntries();
  const next = entries.map((entry) => {
    const shouldOrganize =
      mode === "all" ||
      !entry.tags.length ||
      (entry.tags.length === 1 && entry.tags[0] === "通用");
    if (!shouldOrganize) return entry;

    const tags = inferTags(entry.content, entry.tags);
    const nextTags = tags.length ? tags : entry.tags.length ? entry.tags : ["通用"];
    return {
      ...entry,
      tags: nextTags,
      aliases: buildAliases(entry.content, nextTags, entry.aliases),
      updatedAt: nowIso(),
    };
  });
  saveMemoryEntries(next);
  return next;
}

function scoreEntryWithTokens(entry: MemoryEntry, tokens: string[]): { score: number; matchedTokens: string[] } {
  if (!tokens.length) return { score: 0, matchedTokens: [] };
  const haystack = `${entry.title}\n${entry.tags.join(" ")}\n${entry.aliases.join(" ")}\n${entry.content}`.toLowerCase();
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  return {
    score: matchedTokens.length * 2,
    matchedTokens,
  };
}

function scoreEntry(entry: MemoryEntry, query: string): number {
  return scoreEntryWithTokens(entry, tokenize(query)).score;
}

export function retrieveMemorySnippetsDetailed(query: string, limit = 4): LocalRetrievalDebugResult {
  const startedAt = performance.now();
  const entries = listMemoryEntries();
  const normalizedQuery = normalizeRetrievalQuery(query);
  const cacheKey = makeRetrievalCacheKey(entries, query, limit);
  const cached = retrievalCache.get(cacheKey);

  if (cached) {
    return {
      ...cached,
      cacheHit: true,
      elapsedMs: Math.round(performance.now() - startedAt),
      stats: persistRetrievalHit(cacheKey),
    };
  }

  const tokens = tokenize(normalizedQuery);
  const ranked = entries
    .map((entry) => {
      const { score, matchedTokens } = scoreEntryWithTokens(entry, tokens);
      return { entry, score, matchedTokens };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.entry.updatedAt) - Date.parse(a.entry.updatedAt));

  const candidates: LocalRetrievalCandidate[] = ranked.slice(0, Math.max(limit, 8)).map(({ entry, score, matchedTokens }, index) => ({
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    score,
    matchedTokens,
    updatedAt: entry.updatedAt,
    selected: index < limit,
  }));

  const snippets: MemorySnippet[] = ranked.slice(0, limit).map(({ entry, score }) => ({
    id: entry.id,
    title: entry.tags.length ? `${entry.title} · ${entry.tags.join(" / ")}` : entry.title,
    text: entry.content,
    source: "memory-bank",
    score,
  }));

  const explanation = [
    `本地检索模式：从 ${entries.length} 条记忆库条目里匹配关键词。`,
    tokens.length ? `分词：${tokens.join(" / ")}` : "当前 query 没有可用关键词。",
    `候选：${ranked.length} 条；注入：${snippets.length} 条；上限：${limit} 条。`,
    snippets.length
      ? `最高分：${ranked[0]?.score ?? 0}，来自「${ranked[0]?.entry.title ?? ""}」。`
      : "没有召回条目；可以换更具体的关键词，或检查记忆库是否已导入内容。",
  ];

  const base: Omit<LocalRetrievalDebugResult, "cacheHit" | "elapsedMs" | "stats"> = {
    query,
    normalizedQuery,
    cacheKey,
    totalEntries: entries.length,
    candidateCount: ranked.length,
    tokens,
    candidates,
    snippets,
    explanation,
  };
  retrievalCache.set(cacheKey, base);

  return {
    ...base,
    cacheHit: false,
    elapsedMs: Math.round(performance.now() - startedAt),
    stats: persistRetrievalMiss(cacheKey),
  };
}

export function retrieveMemorySnippets(query: string, limit = 4): MemorySnippet[] {
  const result = retrieveMemorySnippetsDetailed(query, limit);
  recordContextRetrieval(result);
  return result.snippets;
}

export function exportMemoryJson(): string {
  return JSON.stringify(listMemoryEntries(), null, 2);
}

export function importMemoryJson(text: string): MemoryImportStats {
  const payload = JSON.parse(text);
  const incoming = normalizeMemoryEntries(Array.isArray(payload) ? payload : payload?.entries);
  const current = listMemoryEntries();
  const additions: MemoryEntry[] = [];
  const next = [...current];
  const indexById = new Map(next.map((entry, index) => [entry.id, index]));
  let added = 0;
  let merged = 0;

  for (const entry of incoming) {
    const index = indexById.get(entry.id);
    if (index === undefined) {
      additions.push(entry);
      indexById.set(entry.id, next.length + additions.length - 1);
      added += 1;
      continue;
    }

    next[index] = {
      ...next[index],
      ...entry,
      tags: uniqueClean([...(next[index].tags || []), ...entry.tags], MAX_TAGS),
      aliases: buildAliases(entry.content || next[index].content, [...(next[index].tags || []), ...entry.tags], [
        ...(next[index].aliases || []),
        ...entry.aliases,
      ]),
      importance: Math.max(next[index].importance, entry.importance),
      updatedAt: nowIso(),
    };
    merged += 1;
  }

  const mergedEntries = [...additions, ...next];
  saveMemoryEntries(mergedEntries);
  return { entries: mergedEntries, added, merged };
}
