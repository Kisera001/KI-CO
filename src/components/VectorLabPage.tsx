import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Database,
  Gauge,
  Info,
  ListChecks,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearContextRetrievalHistory,
  clearLocalRetrievalCache,
  getContextRetrievalHistory,
  getLocalRetrievalCacheStats,
  retrieveMemorySnippetsDetailed,
  subscribeContextRetrievalHistory,
  type ContextRetrievalTurn,
  type LocalRetrievalDebugResult,
} from "../storage/memoryBank";
import {
  clearPromptCacheStats,
  getPromptCacheStats,
  subscribePromptCacheStats,
} from "../storage/promptCacheStats";
import type { MemorySnippet, UplinkSettings } from "../types";

interface VectorLabPageProps {
  settings: UplinkSettings;
  onChange: (settings: UplinkSettings) => void;
}

type PanelKey = "config" | "searchTest" | "retrievalExplain" | "cacheStats";

const SOURCE_LABELS: Record<string, string> = {
  "memory-bank": "记忆库",
  obsidian_note: "Obsidian",
  chronicle: "时光回廊",
  latest_style_example: "风格样本",
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 10) / 10}%`;
}

function formatScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value >= 10 ? String(Math.round(value)) : value.toFixed(2).replace(/\.00$/, "");
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2.6));
}

function estimateSnippetTokens(snippets: MemorySnippet[]) {
  return snippets.reduce((sum, snippet) => sum + estimateTokens(`${snippet.title}\n${snippet.text}`), 0);
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] || source || "本地";
}

function excerpt(value: string, max = 160) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function VectorLabPage({ settings, onChange }: VectorLabPageProps) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(settings.contextLoad.memorySnippetLimit);
  const [result, setResult] = useState<LocalRetrievalDebugResult | null>(null);
  const [stats, setStats] = useState(() => getLocalRetrievalCacheStats());
  const [contextTurns, setContextTurns] = useState<ContextRetrievalTurn[]>(() => getContextRetrievalHistory(30));
  const [promptCacheStats, setPromptCacheStats] = useState(() => getPromptCacheStats(30));
  const [openPanels, setOpenPanels] = useState<Record<PanelKey, boolean>>({
    config: true,
    searchTest: true,
    retrievalExplain: true,
    cacheStats: true,
  });

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

  const topCandidates = useMemo(() => result?.candidates.slice(0, 12) ?? [], [result]);
  const selectedSnippets = result?.snippets ?? [];
  const snippetChars = selectedSnippets.reduce((sum, item) => sum + item.text.length, 0);
  const latestContextTurn = contextTurns[0] ?? null;
  const liveSnippets = latestContextTurn?.snippets ?? [];

  const testSourceMix = useMemo(() => {
    const map = new Map<string, number>();
    selectedSnippets.forEach((snippet) => {
      const source = snippet.source || "memory-bank";
      map.set(source, (map.get(source) || 0) + 1);
    });
    return Array.from(map.entries()).map(([source, count]) => `${sourceLabel(source)} ${count}`);
  }, [selectedSnippets]);

  const liveSourceMix = useMemo(() => {
    const map = new Map<string, number>();
    liveSnippets.forEach((snippet) => {
      const source = snippet.source || "memory-bank";
      map.set(source, (map.get(source) || 0) + 1);
    });
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
    return {
      windowSize: 30,
      sampleCount,
      hitRate: sampleCount
        ? (contextTurns.filter((turn) => turn.snippets.length > 0).length / sampleCount) * 100
        : 0,
      crossTurnRepeatRate: sampleCount > 1
        ? (repeatedTurns / (sampleCount - 1)) * 100
        : 0,
      avgEstimatedTokens: sampleCount ? Math.round(totalEstimatedTokens / sampleCount) : 0,
      totalEstimatedTokens,
      fallbackRate: sampleCount
        ? (contextTurns.filter((turn) => turn.snippets.length === 0).length / sampleCount) * 100
        : 0,
      errorRate: 0,
      duplicateRate: totalInjectedCount ? (duplicateCount / totalInjectedCount) * 100 : 0,
      avgInjectedCount: sampleCount ? totalInjectedCount / sampleCount : 0,
    };
  }, [contextTurns]);

  function togglePanel(panel: PanelKey) {
    setOpenPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function updateLimit(nextLimit: number) {
    const safeLimit = clampNumber(nextLimit, 0, 12);
    setLimit(safeLimit);
    onChange({
      ...settings,
      contextLoad: {
        ...settings.contextLoad,
        memorySnippetLimit: safeLimit,
      },
    });
  }

  function runRetrievalTest() {
    const nextResult = retrieveMemorySnippetsDetailed(query, limit);
    setResult(nextResult);
    setStats(nextResult.stats);
  }

  function handleClearTest() {
    setStats(clearLocalRetrievalCache());
    setResult(null);
  }

  function handleClearStats() {
    clearContextRetrievalHistory();
    setContextTurns([]);
  }

  function handleClearPromptCacheStats() {
    clearPromptCacheStats();
    setPromptCacheStats(getPromptCacheStats(30));
  }

  function renderPanelHeader(
    panel: PanelKey,
    icon: ReactNode,
    title: string,
    subtitle?: string,
    action?: ReactNode,
  ) {
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

  const diagnosticLines = result
    ? [
        `Local enabled=yes | scope=memory-bank | docs=${result.totalEntries} | candidates=${result.candidateCount} | injected=${result.snippets.length} | chars=${snippetChars}`,
        `Index provider=local-keyword | model=browser | vectors=0 | reusable=${stats.cacheSize} | missing=0 | incompatible=0 | stale=0`,
        `Cache key=${result.cacheKey.slice(0, 88)}${result.cacheKey.length > 88 ? "..." : ""}`,
      ]
    : [
        "Local enabled=yes | scope=memory-bank | docs=- | candidates=- | injected=- | chars=-",
        "Index provider=local-keyword | model=browser | vectors=0 | reusable=- | missing=0 | incompatible=0 | stale=0",
      ];

  return (
    <main
      className="cinema-shell settings-route-shell vector-route-shell"
      data-theme={settings.visual.theme}
      data-font={settings.visual.fontStyle}
      data-font-size={settings.visual.fontSize}
    >
      <aside className="settings-page vector-page" aria-label="向量检索调音台 / Vector Mixer">
        <div className="settings-page-card vector-page-card">
          <header className="vector-hero">
            <span className="settings-route-mark">
              <BrainCircuit size={21} />
            </span>
            <div>
              <h1>向量检索调音台 / Vector Mixer</h1>
              <p>本地检索、上下文召回解释、自动缓存命中统计。</p>
            </div>
          </header>

          <div className="vector-note">
            <Info size={16} />
            <span>轻量版：当前先复刻原版小屋的调音台显示结构。本地检索已可用；完整 RAG 向量检索会在后续开源。</span>
          </div>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader("config", <SlidersHorizontal size={17} />, "本地检索配置", "Memory Bank / Local retrieval")}
            {openPanels.config ? (
              <div className="vector-panel-body">
                <div className="vector-config-grid">
                  <label className="vector-field">
                    <span>记忆条目注入上限</span>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      value={limit}
                      onChange={(event) => updateLimit(Number(event.target.value))}
                    />
                  </label>
                  <div className="vector-cache-card">
                    <Database size={16} />
                    <div>
                      <strong>自动缓存</strong>
                      <span>相同 query、记忆库状态和注入上限会复用本地召回结果。</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader(
              "searchTest",
              <Search size={17} />,
              "检索测试（含前后分数）",
              result ? `query="${result.query || "(empty)"}"` : "输入 query 后查看候选、召回和诊断",
            )}
            {openPanels.searchTest ? (
              <div className="vector-panel-body">
                <div className="vector-test-row">
                  <textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="输入关键词或一句话，例如：观影偏好、成长档案、喜欢的回应方式..."
                    rows={3}
                  />
                  <div className="vector-test-actions">
                    <button type="button" onClick={runRetrievalTest}>
                      <Search size={16} />
                      <span>测试</span>
                    </button>
                    <button type="button" className="secondary" onClick={runRetrievalTest}>
                      <ListChecks size={16} />
                      <span>本地诊断</span>
                    </button>
                    <button type="button" className="ghost" onClick={handleClearTest}>
                      <RefreshCcw size={15} />
                      <span>清空</span>
                    </button>
                  </div>
                </div>

                <div className="vector-debug-block">
                  {diagnosticLines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>

                {result?.explanation.length ? (
                  <div className="vector-diagnostic-list">
                    {result.explanation.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                ) : null}

                <div className="vector-subpanel">
                  <div className="vector-subpanel-title">
                    <Activity size={15} />
                    <strong>候选明细 / Debug Rows</strong>
                  </div>
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
                            <span>localRank {index + 1}</span>
                            <span>vectorRank -</span>
                            <span>source {sourceLabel("memory-bank")}</span>
                            <span>vector -</span>
                            <span>before {formatScore(candidate.score)}</span>
                            <span>after {formatScore(candidate.score)}</span>
                          </div>
                          <div className="vector-tags">
                            {(candidate.tags.length ? candidate.tags : ["未标记"]).slice(0, 8).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                          <small>matched: {candidate.matchedTokens.join(" / ") || "-"}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="vector-empty">当前 query 没有本地候选。检查记忆库开关、导入内容，或换一个更具体的关键词。</div>
                  )}
                </div>

                <div className="vector-subpanel">
                  <div className="vector-subpanel-title">
                    <Zap size={15} />
                    <strong>上下文召回（含 Obsidian / 时光回廊 / 长期记忆）</strong>
                  </div>
                  <div className="vector-source-mix">
                    {testSourceMix.length ? testSourceMix.map((item) => <span key={item}>{item}</span>) : <span>暂无召回来源</span>}
                  </div>
                  {selectedSnippets.length ? (
                    <div className="vector-context-rows">
                      {selectedSnippets.map((snippet, index) => (
                        <article key={`${snippet.source}-${snippet.id}-${index}`} className="vector-context-row">
                          <div className="vector-context-meta">
                            <span>{sourceLabel(snippet.source || "memory-bank")}</span>
                            <span>score {formatScore(snippet.score)}</span>
                            <span>vector -</span>
                            <span>recent +0</span>
                            <span>exact {topCandidates[index]?.matchedTokens.length ? "yes" : "no"}</span>
                          </div>
                          <strong>{snippet.title}</strong>
                          <p>{excerpt(snippet.text, 220)}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="vector-empty">暂无注入条目。</div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader(
              "retrievalExplain",
              <Zap size={17} />,
              "检索解释（实时上下文）",
              `最近 ${retrievalQuality.windowSize} 轮（样本=${retrievalQuality.sampleCount}）`,
              <button type="button" className="vector-compact-button" onClick={handleClearStats}>
                清空
              </button>,
            )}
            {openPanels.retrievalExplain ? (
              <div className="vector-panel-body">
                <div className="vector-quality-grid">
                  <div>
                    <strong>{formatPercent(retrievalQuality.hitRate)}</strong>
                    <span>命中率</span>
                  </div>
                  <div>
                    <strong>{formatPercent(retrievalQuality.crossTurnRepeatRate)}</strong>
                    <span>跨轮重复率</span>
                  </div>
                  <div>
                    <strong>{retrievalQuality.avgEstimatedTokens}</strong>
                    <span>平均 Token(估)</span>
                  </div>
                  <div>
                    <strong>{retrievalQuality.totalEstimatedTokens}</strong>
                    <span>总 Token(估)</span>
                  </div>
                  <div>
                    <strong>{formatPercent(retrievalQuality.fallbackRate)}</strong>
                    <span>fallback 率</span>
                  </div>
                  <div>
                    <strong>{formatPercent(retrievalQuality.errorRate)}</strong>
                    <span>错误率</span>
                  </div>
                  <div>
                    <strong>{formatPercent(retrievalQuality.duplicateRate)}</strong>
                    <span>轮内重复率</span>
                  </div>
                  <div>
                    <strong>{formatScore(retrievalQuality.avgInjectedCount)}</strong>
                    <span>平均注入条数</span>
                  </div>
                </div>

                <div className="vector-trace-card compact">
                  <div className="vector-trace-head">
                    <strong>实时上下文轨迹</strong>
                    {latestContextTurn ? (
                      <span className={latestContextTurn.cacheHit ? "vector-pill hit" : "vector-pill miss"}>
                        {latestContextTurn.cacheHit ? "cache hit" : "cache miss"} · {latestContextTurn.elapsedMs}ms
                      </span>
                    ) : (
                      <span className="vector-pill">等待对话</span>
                    )}
                  </div>
                  <p>source mix: {liveSourceMix.length ? liveSourceMix.join(" / ") : "none"}</p>
                  <p>query: {latestContextTurn?.query || "尚未产生实际对话检索"}</p>
                </div>

                {liveSnippets.length ? (
                  <div className="vector-trace-list">
                    {liveSnippets.map((snippet, index) => (
                      <article key={`${snippet.id}-trace-${index}`}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{snippet.title}</strong>
                          <p>{excerpt(snippet.text, 150)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="vector-empty">实时上下文暂无召回。开启人格核中的记忆库后发送一条对话，这里会显示本轮实际注入内容。</div>
                )}
              </div>
            ) : null}
          </section>

          <section className="vector-section vector-section-panel">
            {renderPanelHeader(
              "cacheStats",
              <Gauge size={17} />,
              "每轮缓存命中统计",
              `最近 ${promptCacheStats.windowSize} 轮（样本=${promptCacheStats.sampleCount}）`,
              <button type="button" className="vector-compact-button" onClick={handleClearPromptCacheStats}>
                清空
              </button>,
            )}
            {openPanels.cacheStats ? (
                <div className="vector-panel-body">
                <div className="vector-stat-grid vector-stat-grid-wide">
                  <div>
                    <strong>{Math.round(promptCacheStats.totalInputTokens)}</strong>
                    <span>输入 Token(总)</span>
                  </div>
                  <div>
                    <strong>{Math.round(promptCacheStats.totalCachedTokens)}</strong>
                    <span>缓存 Token(总)</span>
                  </div>
                  <div>
                    <strong>{formatPercent(promptCacheStats.avgSavingsRatio * 100)}</strong>
                    <span>节省比例(总)</span>
                  </div>
                  <div>
                    <strong>{Math.round(promptCacheStats.avgInputTokens)}</strong>
                    <span>输入 Token(均)</span>
                  </div>
                  <div>
                    <strong>{Math.round(promptCacheStats.avgCachedTokens)}</strong>
                    <span>缓存 Token(均)</span>
                  </div>
                  <div>
                    <strong>{promptCacheStats.lastTurn ? formatPercent(promptCacheStats.lastTurn.savingsRatio * 100) : "0%"}</strong>
                    <span>最近一轮节省</span>
                  </div>
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
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="vector-empty">暂无模型缓存统计。先发送几轮真实模型对话，再回来查看服务商返回的缓存命中。</div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </main>
  );
}
