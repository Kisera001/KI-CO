import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Database,
  Download,
  Gauge,
  ListChecks,
  PlugZap,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CottageDivider, CottageStar } from "./CottageGlyphs";
import {
  clearContextRetrievalHistory,
  clearLocalRetrievalCache,
  clearObsidianDocs,
  clearVectorIndex,
  downloadVectorIndexBackup,
  getContextRetrievalHistory,
  getEmbeddingRuntimeStatus,
  getLocalRetrievalCacheStats,
  getObsidianDiagnostics,
  getObsidianDocMeta,
  getVectorBuildStatus,
  getVectorIndexGuideStatus,
  getVectorOnDemandStatus,
  importObsidianDocs,
  importVectorIndexBackup,
  rebuildVectorIndex,
  retrieveMemorySnippetsDetailed,
  subscribeContextRetrievalHistory,
  subscribeVectorStore,
  type ContextRetrievalTurn,
  type LocalRetrievalDebugResult,
  type SourceDoc,
} from "../storage/memoryBank";
import {
  clearPromptCacheStats,
  getPromptCacheStats,
  subscribePromptCacheStats,
} from "../storage/promptCacheStats";
import type { MemoryRetrievalSettings, MemorySnippet, ObsidianScopeMode, UplinkSettings, VectorProvider } from "../types";
import { getActivePersona, loadPersonaProfile } from "../storage/personaProfile";

interface VectorLabPageProps {
  settings: UplinkSettings;
  onChange: (settings: UplinkSettings) => void;
}

type PanelKey = "retrievalConfig" | "obsidianBridge" | "indexStatus" | "searchTest" | "retrievalExplain" | "cacheStats";
type RetrievalPresetId = "budget" | "balanced" | "recall";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:3210";
const BRIDGE_URL_KEY = "kisera_cottage_obsidian_bridge_url_v1";
const OBSIDIAN_ROOT_KEY = "kisera_cottage_obsidian_root_path_v1";
const OBSIDIAN_SELECTED_FOLDERS_KEY = "kisera_cottage_obsidian_selected_folders_v1";
const SOURCE_LABELS: Record<string, string> = {
  "memory-bank": "记忆库",
  obsidian_note: "Obsidian",
  chronicle: "时光回廊",
  latest_style_example: "风格样本",
  raw_memory: "原对话",
};

const RETRIEVAL_PRESETS: Array<{
  id: RetrievalPresetId;
  label: string;
  description: string;
  values: Pick<
    MemoryRetrievalSettings,
    "memoryRetrievalMode" | "vectorTopK" | "vectorScoreThreshold" | "vectorRerank" | "vectorCrossEncoderRerank" | "rawMemoryDeepDiveEnabled" | "rawMemoryWindowLimit" | "vectorContextBudgetChars"
  >;
}> = [
  {
    id: "budget",
    label: "节能",
    description: "混合检索 + 高阈值 + 少召回，关闭 raw 深潜。",
    values: {
      memoryRetrievalMode: "hybrid",
      vectorTopK: 3,
      vectorScoreThreshold: 0.25,
      vectorRerank: false,
      vectorCrossEncoderRerank: false,
      rawMemoryDeepDiveEnabled: false,
      rawMemoryWindowLimit: 1,
      vectorContextBudgetChars: 1800,
    },
  },
  {
    id: "balanced",
    label: "均衡",
    description: "混合检索 + 重排与精排，8 条召回、0.1 阈值，关闭 raw 深潜。",
    values: {
      memoryRetrievalMode: "hybrid",
      vectorTopK: 8,
      vectorScoreThreshold: 0.1,
      vectorRerank: true,
      vectorCrossEncoderRerank: true,
      rawMemoryDeepDiveEnabled: false,
      rawMemoryWindowLimit: 2,
      vectorContextBudgetChars: 2500,
    },
  },
  {
    id: "recall",
    label: "高召回",
    description: "向量优先 + 低阈值 + 重排，尽量提高命中。",
    values: {
      memoryRetrievalMode: "vector",
      vectorTopK: 8,
      vectorScoreThreshold: 0,
      vectorRerank: true,
      vectorCrossEncoderRerank: true,
      rawMemoryDeepDiveEnabled: true,
      rawMemoryWindowLimit: 4,
      vectorContextBudgetChars: 4000,
    },
  },
];

const MODE_OPTIONS: Array<{ value: MemoryRetrievalSettings["memoryRetrievalMode"]; label: string; description: string }> = [
  { value: "local", label: "Local / 本地", description: "只用关键词和标签匹配，最低成本。" },
  { value: "vector", label: "Vector / 向量", description: "语义优先，适合表达不完全一致的召回。" },
  { value: "hybrid", label: "Hybrid / 混合", description: "本地 + 向量融合，推荐日常使用。" },
];

const PROVIDER_OPTIONS: Array<{ value: VectorProvider; label: string; description: string }> = [
  { value: "none", label: "来自: 无 (none)", description: "不走远程向量服务，使用本地向量模拟。" },
  { value: "local", label: "来自: 本地 (local)", description: "浏览器本地向量，不消耗 API。" },
  { value: "openai", label: "来自: OpenAI/中转站", description: "保留 OpenAI 兼容 embedding 配置。" },
  { value: "gemini", label: "来自: Gemini 官方", description: "保留 Gemini embedding 配置。" },
];

const OBSIDIAN_SCOPE_OPTIONS: Array<{ value: ObsidianScopeMode; label: string; description: string }> = [
  { value: "all", label: "全部", description: "检索全部已同步 Obsidian 内容。" },
  { value: "persona", label: "Persona", description: "偏人格/风格/锚点相关内容。" },
  { value: "book", label: "Book", description: "偏作品、创作和资料内容。" },
  { value: "custom", label: "自定义", description: "按自定义关键词过滤路径/标题。" },
];

interface ObsidianFolderRow {
  path: string;
  label: string;
  fileCount: number;
}

interface ObsidianFolderTreeNode {
  path: string;
  name: string;
  fileCount: number;
  totalFiles: number;
  children: ObsidianFolderTreeNode[];
}

interface ObsidianBridgeFilesResponse {
  ok: boolean;
  totalFiles: number;
  allFiles?: number;
  folders?: ObsidianFolderRow[];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 10) / 10}%`;
}

function formatScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value >= 10 ? String(Math.round(value)) : value.toFixed(3).replace(/\.?0+$/, "");
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2.6));
}

function excerpt(value: string, max = 160) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function sourceLabel(source = "") {
  return SOURCE_LABELS[source] || source || "本地";
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function readStoredValue(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function readStoredStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function splitFolderPath(folderPath: string): string[] {
  return String(folderPath || "").split("/").map((part) => part.trim()).filter(Boolean);
}

function folderDepth(folderPath: string): number {
  return splitFolderPath(folderPath).length;
}

function buildFolderTree(rows: ObsidianFolderRow[]): ObsidianFolderTreeNode[] {
  const byPath = new Map<string, ObsidianFolderTreeNode>();
  const roots: ObsidianFolderTreeNode[] = [];
  const directCounts = new Map(rows.map((row) => [row.path, Number(row.fileCount || 0)]));

  const ensureNode = (folderPath: string): ObsidianFolderTreeNode => {
    const existing = byPath.get(folderPath);
    if (existing) return existing;
    const parts = splitFolderPath(folderPath);
    const node: ObsidianFolderTreeNode = {
      path: folderPath,
      name: folderPath === "." ? "(root)" : parts.at(-1) || folderPath,
      fileCount: directCounts.get(folderPath) || 0,
      totalFiles: 0,
      children: [],
    };
    byPath.set(folderPath, node);
    if (folderPath === "." || parts.length <= 1) {
      if (folderPath === ".") roots.unshift(node);
      else roots.push(node);
      return node;
    }
    const parent = ensureNode(parts.slice(0, -1).join("/"));
    if (!parent.children.some((child) => child.path === folderPath)) parent.children.push(node);
    return node;
  };

  [...rows].sort((a, b) => folderDepth(a.path) - folderDepth(b.path)).forEach((row) => ensureNode(row.path));
  const sortNodes = (nodes: ObsidianFolderTreeNode[]) => {
    nodes.sort((a, b) => a.path === "." ? -1 : b.path === "." ? 1 : a.path.localeCompare(b.path, "zh-CN"));
    nodes.forEach((node) => sortNodes(node.children));
  };
  const fillTotals = (node: ObsidianFolderTreeNode): number => {
    node.totalFiles = node.fileCount + node.children.reduce((sum, child) => sum + fillTotals(child), 0);
    return node.totalFiles;
  };
  sortNodes(roots);
  roots.forEach(fillTotals);
  return roots;
}

function collectSubtreePaths(node: ObsidianFolderTreeNode): string[] {
  return [node.path, ...node.children.flatMap(collectSubtreePaths)];
}

function hasSelectedAncestor(folderPath: string, selected: Set<string>): boolean {
  if (!folderPath || folderPath === ".") return false;
  const parts = splitFolderPath(folderPath);
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    if (selected.has(parts.slice(0, index).join("/"))) return true;
  }
  return false;
}

function minimizeIncludeFolders(paths: string[]): string[] {
  const selected = new Set<string>();
  [...new Set(paths)].sort((a, b) => folderDepth(a) - folderDepth(b)).forEach((folderPath) => {
    if (!hasSelectedAncestor(folderPath, selected)) selected.add(folderPath);
  });
  return [...selected];
}

function normalizeBridgeBase(raw: string): string {
  const base = String(raw || DEFAULT_BRIDGE_URL).trim() || DEFAULT_BRIDGE_URL;
  const withProtocol = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return withProtocol.replace(/\/+$/, "");
}

async function requestBridgeJson<T>(baseRaw: string, path: string, params: Record<string, string | number | boolean | string[]> = {}): Promise<T> {
  const base = normalizeBridgeBase(baseRaw);
  const url = new URL(`${base}${path}`);
  const isGet = path === "/health";
  if (isGet) {
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }
  const response = await fetch(url.toString(), isGet
    ? undefined
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Bridge request failed: ${response.status}`);
  }
  return payload as T;
}

export function VectorLabPage({ settings, onChange }: VectorLabPageProps) {
  const retrieval = settings.memoryRetrieval;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LocalRetrievalDebugResult | null>(null);
  const [stats, setStats] = useState(() => getLocalRetrievalCacheStats());
  const [buildStatus, setBuildStatus] = useState(() => getVectorBuildStatus());
  const [obsidianMeta, setObsidianMeta] = useState(() => getObsidianDocMeta());
  const [obsidianDiagnostics, setObsidianDiagnostics] = useState<ReturnType<typeof getObsidianDiagnostics> | null>(null);
  const [contextTurns, setContextTurns] = useState<ContextRetrievalTurn[]>(() => getContextRetrievalHistory(30));
  const [promptCacheStats, setPromptCacheStats] = useState(() => getPromptCacheStats(30));
  const [bridgeUrl, setBridgeUrl] = useState(() => readStoredValue(BRIDGE_URL_KEY, DEFAULT_BRIDGE_URL));
  const [rootPath, setRootPath] = useState(() => readStoredValue(OBSIDIAN_ROOT_KEY, ""));
  const [bridgeInfo, setBridgeInfo] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReadingFolders, setIsReadingFolders] = useState(false);
  const [obsidianFolders, setObsidianFolders] = useState<ObsidianFolderRow[]>([]);
  const [obsidianSelectedFolders, setObsidianSelectedFolders] = useState<string[]>(() => readStoredStringArray(OBSIDIAN_SELECTED_FOLDERS_KEY));
  const [obsidianExpandedFolders, setObsidianExpandedFolders] = useState<Record<string, boolean>>({});
  const [vectorBudgetInput, setVectorBudgetInput] = useState("");
  const [indexNotice, setIndexNotice] = useState("");
  const initialIndexGuide = getVectorIndexGuideStatus(settings);
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>({
    retrievalConfig: true,
    obsidianBridge: false,
    indexStatus: initialIndexGuide.needsRebuild,
    searchTest: false,
    retrievalExplain: false,
    cacheStats: false,
  });

  useEffect(() => {
    localStorage.setItem(BRIDGE_URL_KEY, bridgeUrl);
  }, [bridgeUrl]);

  useEffect(() => {
    localStorage.setItem(OBSIDIAN_ROOT_KEY, rootPath);
  }, [rootPath]);

  useEffect(() => {
    localStorage.setItem(OBSIDIAN_SELECTED_FOLDERS_KEY, JSON.stringify(obsidianSelectedFolders));
  }, [obsidianSelectedFolders]);

  useEffect(() => {
    const refresh = () => setPromptCacheStats(getPromptCacheStats(30));
    refresh();
    return subscribePromptCacheStats(refresh);
  }, []);

  useEffect(() => {
    const refresh = () => setContextTurns(getContextRetrievalHistory(30));
    refresh();
    return subscribeContextRetrievalHistory(refresh);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setBuildStatus(getVectorBuildStatus());
      setObsidianMeta(getObsidianDocMeta());
    };
    refresh();
    return subscribeVectorStore(refresh);
  }, []);

  const onDemandStatus = useMemo(() => getVectorOnDemandStatus(settings), [settings]);
  const embeddingRuntime = useMemo(() => getEmbeddingRuntimeStatus(settings), [settings]);
  const indexGuide = useMemo(() => getVectorIndexGuideStatus(settings), [settings, buildStatus, obsidianMeta]);
  const topCandidates = useMemo(() => result?.candidates.slice(0, 12) ?? [], [result]);
  const selectedSnippets = result?.snippets ?? [];
  const snippetChars = selectedSnippets.reduce((sum, item) => sum + item.text.length, 0);
  const latestContextTurn = contextTurns[0] ?? null;
  const liveSnippets = latestContextTurn?.snippets ?? [];
  const openRouterProfile = settings.profiles.openrouter;
  const hasOpenRouterKey = !!openRouterProfile.apiKey.trim();
  const isOpenRouterLinked = hasOpenRouterKey && retrieval.vectorUseOpenRouterProfile && retrieval.vectorProvider === "openai";
  const obsidianFolderTree = useMemo(() => buildFolderTree(obsidianFolders), [obsidianFolders]);
  const obsidianNodeMap = useMemo(() => {
    const map = new Map<string, ObsidianFolderTreeNode>();
    const walk = (nodes: ObsidianFolderTreeNode[]) => nodes.forEach((node) => {
      map.set(node.path, node);
      walk(node.children);
    });
    walk(obsidianFolderTree);
    return map;
  }, [obsidianFolderTree]);
  const obsidianSelectedSet = useMemo(() => new Set(obsidianSelectedFolders), [obsidianSelectedFolders]);
  const obsidianSelectedFileCount = useMemo(() => {
    const valid = new Set(obsidianFolders.map((row) => row.path));
    return obsidianSelectedFolders
      .filter((folderPath) => valid.has(folderPath))
      .reduce((sum, folderPath) => sum + (obsidianFolders.find((row) => row.path === folderPath)?.fileCount || 0), 0);
  }, [obsidianFolders, obsidianSelectedFolders]);

  const activePresetId = useMemo<RetrievalPresetId | null>(() => {
    const matched = RETRIEVAL_PRESETS.find((preset) =>
      retrieval.memoryRetrievalMode === preset.values.memoryRetrievalMode &&
      retrieval.vectorTopK === preset.values.vectorTopK &&
      retrieval.vectorScoreThreshold === preset.values.vectorScoreThreshold &&
      retrieval.vectorRerank === preset.values.vectorRerank &&
      retrieval.vectorCrossEncoderRerank === preset.values.vectorCrossEncoderRerank &&
      retrieval.rawMemoryDeepDiveEnabled === preset.values.rawMemoryDeepDiveEnabled &&
      retrieval.rawMemoryWindowLimit === preset.values.rawMemoryWindowLimit &&
      retrieval.vectorContextBudgetChars === preset.values.vectorContextBudgetChars
    );
    return matched?.id ?? null;
  }, [retrieval]);

  const sourceMix = useMemo(() => {
    const map = new Map<string, number>();
    selectedSnippets.forEach((snippet) => map.set(snippet.source || "memory-bank", (map.get(snippet.source || "memory-bank") || 0) + 1));
    return Array.from(map.entries()).map(([source, count]) => `${sourceLabel(source)} ${count}`);
  }, [selectedSnippets]);

  const liveSourceMix = useMemo(() => {
    const map = new Map<string, number>();
    liveSnippets.forEach((snippet) => map.set(snippet.source || "memory-bank", (map.get(snippet.source || "memory-bank") || 0) + 1));
    return Array.from(map.entries()).map(([source, count]) => `${sourceLabel(source)} ${count}`);
  }, [liveSnippets]);

  const retrievalQuality = useMemo(() => {
    const sampleCount = contextTurns.length;
    const totalInjectedCount = contextTurns.reduce((sum, turn) => sum + turn.snippets.length, 0);
    const totalEstimatedTokens = contextTurns.reduce((sum, turn) => sum + turn.estimatedTokens, 0);
    const duplicateCount = contextTurns.reduce((sum, turn) => {
      const ids = new Set<string>();
      return sum + turn.snippets.filter((snippet) => {
        if (ids.has(snippet.id)) return true;
        ids.add(snippet.id);
        return false;
      }).length;
    }, 0);
    const repeatedTurns = contextTurns.reduce((sum, turn, index) => {
      const previous = contextTurns[index + 1];
      if (!previous) return sum;
      const previousIds = new Set(previous.snippets.map((snippet) => snippet.id));
      return sum + (turn.snippets.some((snippet) => previousIds.has(snippet.id)) ? 1 : 0);
    }, 0);
    const sourceMix: Record<string, number> = {};
    contextTurns.forEach((turn) => {
      turn.snippets.forEach((snippet) => {
        const key = snippet.source || "memory-bank";
        sourceMix[key] = (sourceMix[key] || 0) + 1;
      });
    });
    return {
      windowSize: 30,
      sampleCount,
      hitRate: sampleCount ? (contextTurns.filter((turn) => turn.snippets.length > 0).length / sampleCount) * 100 : 0,
      crossTurnRepeatRate: sampleCount > 1 ? (repeatedTurns / (sampleCount - 1)) * 100 : 0,
      avgEstimatedTokens: sampleCount ? Math.round(totalEstimatedTokens / sampleCount) : 0,
      totalEstimatedTokens,
      fallbackRate: sampleCount ? (contextTurns.filter((turn) => turn.snippets.length === 0).length / sampleCount) * 100 : 0,
      errorRate: contextTurns.length ? (contextTurns.filter((turn) => !!turn.error).length / contextTurns.length) * 100 : 0,
      duplicateRate: totalInjectedCount ? (duplicateCount / totalInjectedCount) * 100 : 0,
      avgInjectedCount: sampleCount ? totalInjectedCount / sampleCount : 0,
      sourceMix,
    };
  }, [contextTurns]);

  function updateRetrieval(patch: Partial<MemoryRetrievalSettings>) {
    onChange({
      ...settings,
      memoryRetrieval: {
        ...settings.memoryRetrieval,
        ...patch,
      },
    });
  }

  function commitVectorBudgetInput() {
    const parsed = Number(vectorBudgetInput.trim());
    if (Number.isFinite(parsed) && vectorBudgetInput.trim()) {
      updateRetrieval({ vectorContextBudgetChars: clampNumber(Math.round(parsed), 600, 12000) });
    }
    setVectorBudgetInput("");
  }

  function togglePanel(panel: PanelKey) {
    setOpenPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function applyPreset(presetId: RetrievalPresetId) {
    const preset = RETRIEVAL_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    updateRetrieval(preset.values);
  }

  async function runRetrievalTest() {
    const nextResult = await retrieveMemorySnippetsDetailed(query, retrieval.vectorTopK, settings);
    setResult(nextResult);
    setStats(nextResult.stats);
    setObsidianDiagnostics(getObsidianDiagnostics(settings, query));
  }

  function handleClearTest() {
    setStats(clearLocalRetrievalCache());
    setResult(null);
    setObsidianDiagnostics(null);
  }

  function handleClearStats() {
    clearContextRetrievalHistory();
    setContextTurns([]);
  }

  function handleClearPromptCacheStats() {
    clearPromptCacheStats();
    setPromptCacheStats(getPromptCacheStats(30));
  }

  async function handleRebuildIndex() {
    const persona = getActivePersona(loadPersonaProfile());
    const notices: string[] = [];
    if (!persona.systemPrompt.trim()) notices.push("人格核目前为空；它常驻上下文，不参与 embedding，可稍后在人格核页面补写。");
    if (indexGuide.totalDocs === 0) {
      setIndexNotice("目前没有可建立索引的记忆库、Obsidian 或原对话内容。先写入或导入内容后再来建立索引；人格核无需建立索引。");
      setOpenPanels((current) => ({ ...current, indexStatus: true }));
      return;
    }
    if (embeddingRuntime.usesLocalFallback) notices.push("未配置远程 embedding，本次将建立本地 RAG 索引。");
    setIndexNotice(notices.join(" ") || `正在使用 ${embeddingRuntime.model} 建立索引。`);
    setOpenPanels((current) => ({ ...current, indexStatus: true }));
    const nextStatus = await rebuildVectorIndex(settings);
    setBuildStatus(nextStatus);
    setObsidianMeta(getObsidianDocMeta());
    setIndexNotice(nextStatus.state === "error"
      ? `索引构建失败：${nextStatus.error || "请检查 embedding 配置。"}`
      : `${nextStatus.provider === "local" ? "本地 RAG" : "Embedding"} 索引已完成：新建 ${nextStatus.embedded}，复用 ${nextStatus.reused}。`);
  }

  function handleClearIndex() {
    setBuildStatus(clearVectorIndex());
  }

  function handleClearObsidian() {
    clearObsidianDocs();
    setObsidianMeta(getObsidianDocMeta());
    setObsidianDiagnostics(null);
  }

  async function handleHealthCheck() {
    setBridgeError("");
    setBridgeInfo("正在连接 Obsidian Bridge...");
    try {
      const payload = await requestBridgeJson<{ ok: boolean; version?: string }>(bridgeUrl, "/health");
      setBridgeInfo(`连接成功${payload.version ? ` · ${payload.version}` : ""}`);
    } catch (error) {
      setBridgeInfo("");
      setBridgeError(error instanceof Error ? error.message : "连接失败");
    }
  }

  async function handleLoadObsidianFolders() {
    const root = rootPath.trim();
    if (!root) {
      setBridgeError("请先填写 Obsidian 根目录。");
      return;
    }
    setBridgeError("");
    setBridgeInfo("正在读取文件夹...");
    setIsReadingFolders(true);
    try {
      const payload = await requestBridgeJson<ObsidianBridgeFilesResponse>(bridgeUrl, "/api/obsidian/files", { rootPath: root });
      const folders = Array.isArray(payload.folders) ? payload.folders : [];
      const validPaths = new Set(folders.map((folder) => folder.path));
      const persisted = obsidianSelectedFolders.filter((folderPath) => validPaths.has(folderPath));
      setObsidianFolders(folders);
      setObsidianExpandedFolders({});
      setObsidianSelectedFolders(persisted.length ? persisted : folders.map((folder) => folder.path));
      setBridgeInfo(`已读取 ${folders.length} 个目录 · ${Number(payload.allFiles ?? payload.totalFiles)} 个 markdown 文件。`);
    } catch (error) {
      setBridgeInfo("");
      setBridgeError(error instanceof Error ? error.message : "读取文件夹失败");
    } finally {
      setIsReadingFolders(false);
    }
  }

  function toggleObsidianFolder(folderPath: string) {
    const node = obsidianNodeMap.get(folderPath);
    const branchPaths = node ? collectSubtreePaths(node) : [folderPath];
    setObsidianSelectedFolders((current) => {
      const next = new Set(current);
      const allSelected = branchPaths.every((path) => next.has(path));
      branchPaths.forEach((path) => allSelected ? next.delete(path) : next.add(path));
      return [...next];
    });
  }

  async function handleSyncObsidian() {
    setBridgeError("");
    setBridgeInfo("");
    setIsSyncing(true);
    try {
      const root = rootPath.trim();
      if (!root) throw new Error("请先填写 Obsidian 根目录。");
      const validPaths = new Set(obsidianFolders.map((folder) => folder.path));
      const selectedFolders = obsidianSelectedFolders.filter((folderPath) => validPaths.has(folderPath));
      const includeFolders = obsidianFolders.length && selectedFolders.length < obsidianFolders.length
        ? minimizeIncludeFolders(selectedFolders)
        : [];
      if (obsidianFolders.length && !includeFolders.length) throw new Error("请先勾选至少一个要同步的文件夹。");
      const files = await requestBridgeJson<ObsidianBridgeFilesResponse>(bridgeUrl, "/api/obsidian/files", { rootPath: root, includeFolders });
      let offset = 0;
      let totalChunks = 0;
      const docs: Partial<SourceDoc>[] = [];
      const fileLimit = 80;
      while (offset < files.totalFiles) {
        const payload = await requestBridgeJson<{
          ok: boolean;
          chunks: Array<Partial<SourceDoc> & { noteId?: string; chunkId?: string }>;
          nextOffset: number;
          processedFiles: number;
          totalFiles: number;
        }>(bridgeUrl, "/api/obsidian/chunks", {
          rootPath: root,
          fileOffset: offset,
          fileLimit,
          maxChunkChars: 1200,
          chunkOverlap: 120,
          includeFolders,
        });
        payload.chunks.forEach((chunk, index) => {
          const sourceId = String(chunk.sourceId || chunk.noteId || chunk.id || `obsidian-${offset}-${index}`);
          docs.push({
            ...chunk,
            id: String(chunk.id || chunk.chunkId || `obsidian_note:${sourceId}:${index}`),
            sourceType: "obsidian_note",
            sourceId,
            parentId: String(chunk.parentId || sourceId),
          });
        });
        totalChunks += payload.chunks.length;
        offset = payload.nextOffset > offset ? payload.nextOffset : offset + payload.processedFiles;
        setBridgeInfo(`同步中：${Math.min(offset, files.totalFiles)}/${files.totalFiles} 文件 · chunks=${totalChunks}`);
      }
      const report = importObsidianDocs(docs);
      setObsidianMeta(getObsidianDocMeta());
      setBridgeInfo(`同步完成：新增 ${report.added} 条，当前 ${report.total} 条。建议点击“重建索引”。`);
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "同步失败");
    } finally {
      setIsSyncing(false);
    }
  }

  function handleBackupImport(text: string) {
    try {
      const report = importVectorIndexBackup(text);
      setBuildStatus(getVectorBuildStatus());
      setObsidianMeta(getObsidianDocMeta());
      setBridgeInfo(`索引导入完成：vectors=${report.indexCount}，Obsidian=${report.obsidianDocCount}`);
      setBridgeError("");
    } catch (error) {
      setBridgeInfo("");
      setBridgeError(error instanceof Error ? error.message : "导入失败");
    }
  }

  function renderPanelHeader(panel: PanelKey, icon: ReactNode, title: string, subtitle?: string, action?: ReactNode) {
    const isOpen = openPanels[panel];
    return (
      <div className="vector-panel-header">
        <button type="button" className="vector-panel-title" onClick={() => togglePanel(panel)} aria-expanded={isOpen}>
          <span className="vector-panel-icon">{icon}</span>
          <span>
            <strong>{title}</strong>
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </button>
        <div className="vector-panel-actions">
          {action}
          <button type="button" className="vector-icon-button" onClick={() => togglePanel(panel)} aria-label="展开或收起">
            <ChevronDown size={18} className={isOpen ? "vector-chevron open" : "vector-chevron"} />
          </button>
        </div>
      </div>
    );
  }

  function renderObsidianFolderNode(node: ObsidianFolderTreeNode, depth = 0): ReactNode {
    const branchPaths = collectSubtreePaths(node);
    const selectedCount = branchPaths.filter((folderPath) => obsidianSelectedSet.has(folderPath)).length;
    const checked = selectedCount === branchPaths.length;
    const partial = selectedCount > 0 && !checked;
    const expanded = !!obsidianExpandedFolders[node.path];
    return (
      <div key={node.path} className="vector-folder-branch">
        <div className={`vector-folder-row ${checked ? "selected" : partial ? "partial" : ""}`} style={{ marginLeft: depth * 12 }} title={node.path}>
          {node.children.length ? (
            <button type="button" className="vector-folder-chevron" onClick={() => setObsidianExpandedFolders((current) => ({ ...current, [node.path]: !current[node.path] }))} aria-label={expanded ? "折叠" : "展开"}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <span className="vector-folder-chevron" />}
          <input type="checkbox" checked={checked} ref={(input) => { if (input) input.indeterminate = partial; }} onChange={() => toggleObsidianFolder(node.path)} />
          <span>{node.name}</span>
          <small>{node.totalFiles}</small>
        </div>
        {node.children.length && expanded ? node.children.map((child) => renderObsidianFolderNode(child, depth + 1)) : null}
      </div>
    );
  }

  const diagnosticLines = result
    ? [
        `enabled=yes | mode=${retrieval.memoryRetrievalMode} | docs=${result.totalEntries} | candidates=${result.candidateCount} | injected=${result.snippets.length} | chars=${snippetChars}`,
        `Index provider=${retrieval.vectorProvider || "none"} | model=${retrieval.vectorEmbeddingModel || "local-hash-96"} | vectors=${buildStatus.total} | cache=${stats.cacheSize}`,
        `Cache key=${result.cacheKey.slice(0, 88)}${result.cacheKey.length > 88 ? "..." : ""}`,
      ]
    : [
        `enabled=yes | mode=${retrieval.memoryRetrievalMode} | docs=- | candidates=- | injected=- | chars=-`,
        `Index provider=${retrieval.vectorProvider || "none"} | model=${retrieval.vectorEmbeddingModel || "local-hash-96"} | vectors=${buildStatus.total}`,
      ];

  return (
    <main
      className="cinema-shell settings-route-shell vector-route-shell"
      data-theme={settings.visual.theme}
      data-font={settings.visual.fontStyle}
      data-font-size={settings.visual.fontSize}
    >
      <aside className="settings-page vector-page cottage-ritual-page" aria-label="向量检索调音台 / Vector Mixer">
        <div className="settings-page-card vector-page-card">
          <header className="vector-hero">
            <span className="settings-route-mark">
              <BrainCircuit size={21} />
            </span>
            <div>
              <span className="cottage-page-kicker">VECTOR MIXER</span>
              <h1>向量检索调音台</h1>
              <p>真实索引、Obsidian 桥、检索调参、上下文解释与缓存命中。</p>
            </div>
          </header>

          <CottageDivider />

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("retrievalConfig", <SlidersHorizontal size={17} />, "当前检索配置", `记忆条目: ${onDemandStatus.memoryCount}`)}
            {openPanels.retrievalConfig ? (
              <div className="vector-panel-body">
                <div className="vector-debug-block">
                  <p>
                    按需启用：{onDemandStatus.enabled ? "开启" : "关闭"} | 当前模式：{onDemandStatus.effectiveMode}
                    {" | "}总条目：{onDemandStatus.totalCount}/{onDemandStatus.minItems}
                    {" | "}总字数：{onDemandStatus.totalChars}/{onDemandStatus.minChars}
                  </p>
                </div>

                <div className="vector-config-grid vector-choice-grid">
                  {MODE_OPTIONS.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      className={`vector-cache-card vector-mode-card ${retrieval.memoryRetrievalMode === mode.value ? "active" : ""}`}
                      title={mode.description}
                      onClick={() => updateRetrieval({ memoryRetrievalMode: mode.value })}
                    >
                      {retrieval.memoryRetrievalMode === mode.value ? <CottageStar className="vector-choice-star" /> : null}
                      <strong>{mode.label}</strong>
                    </button>
                  ))}
                </div>

                <div className="vector-config-grid vector-choice-grid">
                  {RETRIEVAL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`vector-cache-card vector-preset-card preset-${preset.id} ${activePresetId === preset.id ? "active" : ""}`}
                      title={preset.description}
                      onClick={() => applyPreset(preset.id)}
                    >
                      {activePresetId === preset.id ? <CottageStar className="vector-choice-star" /> : null}
                      <strong>{preset.label}</strong>
                    </button>
                  ))}
                </div>

                <p className="vector-preset-hint">预设说明：建议先使用默认设置。节能控制成本，均衡适合日常，高召回会增加延时与开销。</p>

                <div className={`vector-link-card ${isOpenRouterLinked ? "active" : ""}`}>
                  <div>
                    <strong>{isOpenRouterLinked ? "已接入 OpenRouter" : hasOpenRouterKey ? "OpenRouter 可接入" : "等待 OpenRouter Key"}</strong>
                    <span>{isOpenRouterLinked ? "向量配置跟随系统设置中的接口与 Key。" : hasOpenRouterKey ? "点击后自动填入向量来源、接口与 Key。" : "在系统设置填写 Key 后会自动完成向量配置。"}</span>
                  </div>
                  {hasOpenRouterKey && !isOpenRouterLinked ? (
                    <button type="button" onClick={() => updateRetrieval({ vectorUseOpenRouterProfile: true, vectorProvider: "openai" })}>自动接入</button>
                  ) : null}
                </div>

                <div className={`vector-embedding-hint ${embeddingRuntime.usesLocalFallback ? "fallback" : "connected"}`}>
                  <CottageStar className="vector-embedding-hint-star" />
                  <span>{embeddingRuntime.message}{embeddingRuntime.usesLocalFallback ? " 仍可检索，但语义召回会比真实 embedding 更轻。" : " 首次使用或来源发生变化后，请重建索引。"}</span>
                </div>

                <div className="vector-config-grid">
                  <label className="vector-field">
                    <span>向量来源</span>
                    <select value={retrieval.vectorProvider} onChange={(event) => updateRetrieval({ vectorProvider: event.target.value as VectorProvider, vectorUseOpenRouterProfile: false })}>
                      {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} title={option.description}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="vector-field wide">
                    <span>Embedding 模型</span>
                    <input
                      value={retrieval.vectorEmbeddingModel}
                      onChange={(event) => updateRetrieval({ vectorEmbeddingModel: event.target.value })}
                      placeholder={retrieval.vectorProvider === "gemini" ? "gemini-embedding-2" : "text-embedding-3-small"}
                    />
                  </label>
                </div>

                {retrieval.vectorProvider === "openai" ? (
                  <div className="vector-config-grid">
                    <label className="vector-field wide">
                      <span>OpenAI / 中转站向量接口</span>
                      <input value={retrieval.vectorOpenAIBaseUrl} onChange={(event) => updateRetrieval({ vectorOpenAIBaseUrl: event.target.value, vectorUseOpenRouterProfile: false })} />
                    </label>
                    <label className="vector-field">
                      <span>向量 API Key</span>
                      <input type="password" value={retrieval.vectorOpenAIApiKey} onChange={(event) => updateRetrieval({ vectorOpenAIApiKey: event.target.value, vectorUseOpenRouterProfile: false })} />
                    </label>
                  </div>
                ) : null}

                <div className="vector-compact-control-grid four">
                  <label className="vector-compact-control" title="召回上限：每次检索进入候选范围的目标条数。最终注入数量还会受字数预算、分层配额、阈值和去重影响。推荐 3-8。">
                    <span>召回上限</span>
                    <div><input type="number" min={1} max={12} value={retrieval.vectorTopK} onChange={(event) => updateRetrieval({ vectorTopK: clampNumber(Number(event.target.value), 1, 12) })} /><small>条</small></div>
                  </label>
                  <label className="vector-compact-control" title="阈值：低于该分数的候选会被过滤。越高越严格，误召回更少但更容易漏召回。推荐 0.1-0.25。">
                    <span>阈值</span>
                    <input type="number" step="0.01" value={retrieval.vectorScoreThreshold} onChange={(event) => updateRetrieval({ vectorScoreThreshold: clampNumber(Number(event.target.value), 0, 1) })} />
                  </label>
                  <button type="button" className={`vector-compact-control toggle ${retrieval.vectorRerank ? "active" : ""}`} title="Rerank：对初筛结果再次排序，命中更稳，但会稍微增加延迟和成本。" onClick={() => updateRetrieval({ vectorRerank: !retrieval.vectorRerank })}>
                    <span>重排 {retrieval.vectorRerank ? "开" : "关"}</span><i />
                  </button>
                  <button type="button" className={`vector-compact-control toggle ${retrieval.vectorCrossEncoderRerank ? "active" : ""}`} title="Cross-Encoder 精排：联合理解候选与问题，通常更准确，但会增加一点延迟。" onClick={() => updateRetrieval({ vectorCrossEncoderRerank: !retrieval.vectorCrossEncoderRerank })}>
                    <span>精排 {retrieval.vectorCrossEncoderRerank ? "开" : "关"}</span><i />
                  </button>
                </div>

                <div className="vector-compact-control-grid three">
                  <button type="button" className={`vector-compact-control toggle ${retrieval.rawMemoryDeepDiveEnabled ? "active" : ""}`} title="Raw 深潜：按当前问题扩展原始聊天窗口检索，细节更全，但构建更慢、成本更高。" onClick={() => updateRetrieval({ rawMemoryDeepDiveEnabled: !retrieval.rawMemoryDeepDiveEnabled })}>
                    <span>深潜 {retrieval.rawMemoryDeepDiveEnabled ? "开" : "关"}</span><i />
                  </button>
                  <label className={`vector-compact-control ${retrieval.rawMemoryDeepDiveEnabled ? "" : "disabled"}`} title="深潜窗口数：最多补充多少个历史窗口做 raw 检索。推荐 1-4。">
                    <span>深潜窗口</span>
                    <div><input type="number" min={1} max={12} disabled={!retrieval.rawMemoryDeepDiveEnabled} value={retrieval.rawMemoryWindowLimit} onChange={(event) => updateRetrieval({ rawMemoryWindowLimit: clampNumber(Number(event.target.value), 1, 12) })} /><small>个</small></div>
                  </label>
                  <label className="vector-compact-control" title="注入预算：控制最终送入上下文的最大字符量。推荐 2500-4000；提高后会容纳更多条目。">
                    <span>字数</span>
                    <div><input className="vector-budget-input" type="text" inputMode="numeric" value={vectorBudgetInput === "" ? retrieval.vectorContextBudgetChars : vectorBudgetInput} onChange={(event) => setVectorBudgetInput(event.target.value)} onBlur={commitVectorBudgetInput} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitVectorBudgetInput(); } }} /><small>字</small></div>
                  </label>
                </div>
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("obsidianBridge", <PlugZap size={17} />, "Obsidian Bridge", `docs=${obsidianMeta.count} | chars=${obsidianMeta.totalChars.toLocaleString()}`)}
            {openPanels.obsidianBridge ? (
              <div className="vector-panel-body">
                <p className="vector-soft-hint">可以选择想接入的“外部大脑”，只同步希望小屋能够检索的笔记。</p>
                <div className="vector-config-grid">
                  <label className="vector-field">
                    <span>Bridge 地址</span>
                    <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} placeholder={DEFAULT_BRIDGE_URL} />
                  </label>
                  <label className="vector-field wide">
                    <span>Obsidian 根目录</span>
                    <input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="例如 D:\\Obsidian\\Vault" />
                  </label>
                </div>

                <div className="vector-config-grid vector-scope-grid">
                  {OBSIDIAN_SCOPE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`vector-cache-card vector-scope-card ${retrieval.obsidianScopeMode === option.value ? "active" : ""}`}
                      title={option.description}
                      onClick={() => updateRetrieval({ obsidianScopeMode: option.value })}
                    >
                      <strong>{option.label}</strong>
                    </button>
                  ))}
                </div>
                {retrieval.obsidianScopeMode === "custom" ? (
                  <label className="vector-field">
                    <span>自定义范围关键词</span>
                    <input value={retrieval.obsidianScopeCustom} onChange={(event) => updateRetrieval({ obsidianScopeCustom: event.target.value })} />
                  </label>
                ) : null}

                <div className="vector-test-actions">
                  <button type="button" onClick={handleHealthCheck}><PlugZap size={16} />检查连接</button>
                  <button type="button" onClick={handleLoadObsidianFolders} disabled={isReadingFolders}><Database size={16} />{isReadingFolders ? "读取中" : "读取文件夹"}</button>
                  <button type="button" className="vector-action-primary" onClick={handleSyncObsidian} disabled={isSyncing}><RefreshCcw size={16} />{isSyncing ? "同步中" : "一键同步 Obsidian"}</button>
                  <button type="button" className="secondary" onClick={handleClearObsidian}><CircleSlash size={16} />清空 Obsidian</button>
                </div>
                <div className="vector-folder-picker">
                  <div className="vector-folder-picker-head">
                    <span>文件夹过滤：{obsidianSelectedFolders.length}/{obsidianFolders.length}{obsidianFolders.length ? ` · 预计 ${obsidianSelectedFileCount} 个文件` : ""}</span>
                    <div>
                      <button type="button" disabled={!obsidianFolders.length} onClick={() => setObsidianSelectedFolders(obsidianFolders.map((folder) => folder.path))}>全选</button>
                      <button type="button" disabled={!obsidianFolders.length} onClick={() => setObsidianSelectedFolders([])}>清空</button>
                    </div>
                  </div>
                  {obsidianFolderTree.length ? (
                    <div className="vector-folder-tree">{obsidianFolderTree.map((node) => renderObsidianFolderNode(node))}</div>
                  ) : <p>先点击“读取文件夹”，再选择要接入的外部大脑。</p>}
                </div>
                {bridgeInfo ? <div className="vector-debug-block"><p>{bridgeInfo}</p></div> : null}
                {bridgeError ? <div className="vector-debug-block error"><p>{bridgeError}</p></div> : null}
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("indexStatus", <Wrench size={17} />, "索引状态", indexGuide.needsRebuild ? `待建立 ${indexGuide.totalDocs - indexGuide.reusableCount} 条` : `state=${buildStatus.state} | ${buildStatus.progress}%`)}
            {openPanels.indexStatus ? (
              <div className="vector-panel-body">
                <div className="vector-test-actions">
                  <button type="button" className={`vector-action-primary vector-rebuild-button ${indexGuide.needsRebuild && buildStatus.state !== "running" ? "needs-attention" : ""}`} onClick={handleRebuildIndex} disabled={buildStatus.state === "running"}>
                    <span className="vector-rebuild-particles" aria-hidden="true"><i /><i /><CottageStar /></span>
                    <RefreshCcw size={16} className={buildStatus.state === "running" ? "vector-spin" : ""} />
                    {buildStatus.state === "running" ? `建立中 ${buildStatus.progress}%` : "重建索引"}
                  </button>
                  <button type="button" className="secondary" onClick={() => downloadVectorIndexBackup()}><Download size={16} />导出索引</button>
                  <label className="vector-clear-button">
                    <Upload size={16} />
                    导入索引
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) handleBackupImport(await file.text());
                      }}
                    />
                  </label>
                  <button type="button" className="ghost" onClick={handleClearIndex}><CircleSlash size={16} />清空索引</button>
                </div>
                {indexNotice ? <div className={`vector-index-notice ${buildStatus.state === "error" ? "error" : ""}`}>{indexNotice}</div> : null}
                <div className="vector-debug-block">
                  <p>state={buildStatus.state} | progress={buildStatus.progress}% | processed={buildStatus.processed}/{buildStatus.total} | embedded={buildStatus.embedded} | reused={buildStatus.reused}</p>
                  <p>provider={buildStatus.provider} | model={buildStatus.model}</p>
                  <p>Obsidian docs={obsidianMeta.count} | style={obsidianMeta.styleCount} | chars={obsidianMeta.totalChars.toLocaleString()}</p>
                </div>
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("searchTest", <Search size={17} />, "检索测试（含前后分数）", result ? `query="${result.query || "(empty)"}"` : "输入 query 后查看候选、召回和诊断")}
            {openPanels.searchTest ? (
              <div className="vector-panel-body">
                <div className="vector-test-row">
                  <textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入测试 query..." rows={3} />
                  <div className="vector-test-actions">
                    <button type="button" className="vector-action-primary" onClick={runRetrievalTest}><Search size={16} />测试</button>
                    <button type="button" className="secondary" onClick={() => setObsidianDiagnostics(getObsidianDiagnostics(settings, query))}><ListChecks size={16} />Obsidian诊断</button>
                    <button type="button" className="ghost" onClick={handleClearTest}><RefreshCcw size={15} />清空</button>
                  </div>
                </div>

                <div className="vector-debug-block">{diagnosticLines.map((line) => <p key={line}>{line}</p>)}</div>
                {result?.explanation.length ? <div className="vector-diagnostic-list">{result.explanation.map((line) => <span key={line}>{line}</span>)}</div> : null}
                {obsidianDiagnostics ? (
                  <div className="vector-debug-block">
                    <p>{`Obsidian enabled=${obsidianDiagnostics.enabled ? "yes" : "no"} | scope=${obsidianDiagnostics.scopeMode}${obsidianDiagnostics.scopeCustom ? `:${obsidianDiagnostics.scopeCustom}` : ""} | docs=${obsidianDiagnostics.totalDocs} | scoped=${obsidianDiagnostics.scopedDocs} | candidates=${obsidianDiagnostics.candidateDocs} | styleDocs=${obsidianDiagnostics.styleDocs} | chars=${obsidianDiagnostics.totalChars.toLocaleString()}`}</p>
                    <p>{`Index provider=${obsidianDiagnostics.currentProvider} | model=${obsidianDiagnostics.currentModel} | vectors=${obsidianDiagnostics.indexCount} | reusable=${obsidianDiagnostics.reusableForCurrent} | missing=${obsidianDiagnostics.missingForCurrent} | incompatible=${obsidianDiagnostics.incompatibleForCurrent} | stale=${obsidianDiagnostics.staleForCurrent}`}</p>
                  </div>
                ) : null}

                <div className="vector-subpanel">
                  <div className="vector-subpanel-title"><Activity size={15} /><strong>检索候选（含前后分数）</strong></div>
                  {topCandidates.length ? (
                    <div className="vector-debug-rows">
                      {topCandidates.map((candidate, index) => (
                        <article key={candidate.id} className={`vector-debug-row ${candidate.selected ? "selected" : ""}`}>
                          <div className="vector-debug-row-head">
                            <span>#{index + 1}</span>
                            <strong>{candidate.title}</strong>
                            {candidate.selected ? <CheckCircle2 size={15} /> : <CircleSlash size={15} />}
                          </div>
                          <div className="vector-score-grid">
                            <span>localRank {candidate.localRank ?? "-"}</span>
                            <span>vectorRank {candidate.vectorRank ?? "-"}</span>
                            <span>source {sourceLabel(candidate.source)}</span>
                            <span>vector {formatScore(candidate.vectorScore)}</span>
                            <span>before {formatScore(candidate.fusedScoreBeforeRerank)}</span>
                            <span>after {formatScore(candidate.fusedScoreAfterRerank ?? candidate.score)}</span>
                          </div>
                          <div className="vector-tags">{(candidate.tags.length ? candidate.tags : ["未标记"]).slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}</div>
                          <small>matched: {candidate.matchedTokens.join(" / ") || "-"}</small>
                        </article>
                      ))}
                    </div>
                  ) : <div className="vector-empty">当前 query 没有候选。检查记忆库、Obsidian 同步或换一个更具体的关键词。</div>}
                </div>

                <div className="vector-subpanel">
                  <div className="vector-subpanel-title"><Zap size={15} /><strong>上下文召回（含 Obsidian / 时光回廊 / 长期记忆）</strong></div>
                  <div className="vector-source-mix">{sourceMix.length ? sourceMix.map((item) => <span key={item}>{item}</span>) : <span>暂无召回来源</span>}</div>
                  {selectedSnippets.length ? (
                    <div className="vector-context-rows">
                      {selectedSnippets.map((snippet, index) => (
                        <article key={`${snippet.source}-${snippet.id}-${index}`} className="vector-context-row">
                          <div className="vector-context-meta">
                            <span>{sourceLabel(snippet.source || "memory-bank")}</span>
                            <span>score {formatScore(snippet.score)}</span>
                            <span>token~ {estimateTokens(`${snippet.title}\n${snippet.text}`)}</span>
                          </div>
                          <strong>{snippet.title}</strong>
                          <p>{excerpt(snippet.text, 220)}</p>
                        </article>
                      ))}
                    </div>
                  ) : <div className="vector-empty">暂无注入条目。</div>}
                </div>
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("retrievalExplain", <Zap size={17} />, "检索解释（实时上下文）", `最近 ${retrievalQuality.windowSize} 轮（样本=${retrievalQuality.sampleCount}）`, <button type="button" className="vector-compact-button" onClick={handleClearStats}>清空</button>)}
            {openPanels.retrievalExplain ? (
              <div className="vector-panel-body">
                <div className="vector-quality-grid">
                  <div><strong>{formatPercent(retrievalQuality.hitRate)}</strong><span>命中率</span></div>
                  <div><strong>{formatPercent(retrievalQuality.crossTurnRepeatRate)}</strong><span>跨轮重复率</span></div>
                  <div><strong>{retrievalQuality.avgEstimatedTokens}</strong><span>平均 Token(估)</span></div>
                  <div><strong>{retrievalQuality.totalEstimatedTokens}</strong><span>总 Token(估)</span></div>
                  <div><strong>{formatPercent(retrievalQuality.fallbackRate)}</strong><span>fallback 率</span></div>
                  <div><strong>{formatPercent(retrievalQuality.errorRate)}</strong><span>错误率</span></div>
                  <div><strong>{formatPercent(retrievalQuality.duplicateRate)}</strong><span>轮内重复率</span></div>
                  <div><strong>{formatScore(retrievalQuality.avgInjectedCount)}</strong><span>平均注入条数</span></div>
                </div>
                {Object.keys(retrievalQuality.sourceMix).length ? (
                  <div className="vector-source-mix">
                    {Object.entries(retrievalQuality.sourceMix).map(([source, count]) => <span key={source}>{sourceLabel(source)}:{count}</span>)}
                  </div>
                ) : null}
                <div className="vector-trace-card compact">
                  <div className="vector-trace-head">
                    <strong>实时上下文轨迹</strong>
                    {latestContextTurn ? <span className={latestContextTurn.cacheHit ? "vector-pill hit" : "vector-pill miss"}>{latestContextTurn.cacheHit ? "cache hit" : "cache miss"} · {latestContextTurn.elapsedMs}ms</span> : <span className="vector-pill">等待对话</span>}
                  </div>
                  <p>source mix: {liveSourceMix.length ? liveSourceMix.join(" / ") : "none"}</p>
                  <p>query: {latestContextTurn?.query || "尚未产生实际对话检索"}</p>
                </div>
                {liveSnippets.length ? (
                  <div className="vector-trace-list">
                    {liveSnippets.map((snippet, index) => (
                      <article key={`${snippet.id}-trace-${index}`}>
                        <span>{index + 1}</span>
                        <div><strong>{snippet.title}</strong><p>{excerpt(snippet.text, 150)}</p></div>
                      </article>
                    ))}
                  </div>
                ) : <div className="vector-empty">实时上下文暂无召回。开启人格核中的记忆库后发送一条对话，这里会显示本轮实际注入内容。</div>}
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("cacheStats", <Gauge size={17} />, "每轮缓存命中统计", `最近 ${promptCacheStats.windowSize} 轮（样本=${promptCacheStats.sampleCount}）`, <button type="button" className="vector-compact-button" onClick={handleClearPromptCacheStats}>清空</button>)}
            {openPanels.cacheStats ? (
              <div className="vector-panel-body">
                <div className="vector-stat-grid vector-stat-grid-wide">
                  <div><strong>{Math.round(promptCacheStats.totalInputTokens)}</strong><span>输入 Token(总)</span></div>
                  <div><strong>{Math.round(promptCacheStats.totalCachedTokens)}</strong><span>缓存 Token(总)</span></div>
                  <div><strong>{formatPercent(promptCacheStats.avgSavingsRatio * 100)}</strong><span>节省比例(总)</span></div>
                  <div><strong>{Math.round(promptCacheStats.avgInputTokens)}</strong><span>输入 Token(均)</span></div>
                  <div><strong>{Math.round(promptCacheStats.avgCachedTokens)}</strong><span>缓存 Token(均)</span></div>
                  <div><strong>{promptCacheStats.lastTurn ? formatPercent(promptCacheStats.lastTurn.savingsRatio * 100) : "0%"}</strong><span>最近一轮节省</span></div>
                </div>
                <p className="vector-cache-footnote">按服务商 usage 返回的真实缓存 Token 统计；接口未返回时显示 0。</p>
                {promptCacheStats.turns.length ? (
                  <div className="vector-cache-turns">
                    {promptCacheStats.turns.slice(0, 8).map((turn) => (
                      <article key={`${turn.ts}-${turn.provider}-${turn.model}`}>
                        <div className="vector-cache-turn-line">
                          <span>{timeLabel(turn.ts)}</span>
                          <span>{turn.provider}</span>
                          <span>{turn.model}</span>
                          <span>in={turn.inputTokens}</span>
                          <span>cached={turn.cachedTokens}</span>
                          <span>saved={formatPercent(turn.savingsRatio * 100)}</span>
                          {turn.cacheStrategy ? <span>{turn.cacheStrategy}</span> : null}
                          {turn.cacheablePrefixTokens ? (
                            <span>
                              prefix≈{turn.cacheablePrefixTokens}
                              {turn.cacheablePrefixMinTokens ? ` / min ${turn.cacheablePrefixMinTokens}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <div className="vector-empty">暂无模型缓存统计。先发送几轮真实模型对话，再回来查看服务商返回的缓存命中。</div>}
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </main>
  );
}
