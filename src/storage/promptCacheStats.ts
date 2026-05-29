import type { ModelProvider } from "../types";

export type PromptCacheProvider = "openai" | "gemini" | "glm" | "deepseek" | "claude";

export interface PromptCacheTurnStat {
  ts: number;
  provider: PromptCacheProvider;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  savingsRatio: number;
}

export interface PromptCacheStatsSnapshot {
  windowSize: number;
  sampleCount: number;
  totalInputTokens: number;
  totalCachedTokens: number;
  avgInputTokens: number;
  avgCachedTokens: number;
  avgSavingsRatio: number;
  lastTurn: PromptCacheTurnStat | null;
  turns: PromptCacheTurnStat[];
}

const STORAGE_KEY = "kis_cottage_prompt_cache_history_v1";
const UPDATE_EVENT = "kis-cottage-prompt-cache-updated";
const HISTORY_LIMIT = 120;

const firstFiniteNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

const maxFiniteNumber = (...values: unknown[]): number => {
  let max = 0;
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
};

export function parseUsageForPromptCache(
  usage: any,
): { inputTokens: number; cachedTokens: number; outputTokens: number } | null {
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = Math.max(
    0,
    Math.round(
      firstFiniteNumber(
        usage.prompt_tokens,
        usage.input_tokens,
        usage.promptTokenCount,
        usage.prompt_token_count,
        firstFiniteNumber(usage.prompt_cache_hit_tokens) + firstFiniteNumber(usage.prompt_cache_miss_tokens),
      ),
    ),
  );
  if (inputTokens <= 0) return null;

  const outputTokens = Math.max(
    0,
    Math.round(
      firstFiniteNumber(
        usage.completion_tokens,
        usage.output_tokens,
        usage.candidatesTokenCount,
        usage.candidates_token_count,
      ),
    ),
  );

  const cachedTokensRaw = Math.round(
    maxFiniteNumber(
      usage.cached_tokens,
      usage.cached_prompt_tokens,
      usage.cache_read_input_tokens,
      usage.cache_read_tokens,
      usage.cachedContentTokenCount,
      usage.cached_content_token_count,
      usage?.prompt_tokens_details?.cached_tokens,
      usage?.prompt_tokens_details?.cache_read_tokens,
      usage?.prompt_tokens_details?.cache_read_input_tokens,
      usage?.input_tokens_details?.cached_tokens,
      usage?.input_tokens_details?.cache_read_tokens,
      usage?.input_tokens_details?.cache_read_input_tokens,
      usage?.input_token_details?.cached_tokens,
      usage?.input_token_details?.cache_read_tokens,
      usage?.input_token_details?.cache_read_input_tokens,
      usage.prompt_cache_hit_tokens,
    ),
  );
  const cachedTokens = Math.max(0, Math.min(inputTokens, cachedTokensRaw));

  return { inputTokens, cachedTokens, outputTokens };
}

export function providerToPromptCacheProvider(provider: ModelProvider): PromptCacheProvider {
  if (provider === "gemini") return "gemini";
  if (provider === "glm") return "glm";
  if (provider === "deepseek") return "deepseek";
  if (provider === "claude") return "claude";
  return "openai";
}

function readHistory(): PromptCacheTurnStat[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        ts: Number(item?.ts) || Date.now(),
        provider: String(item?.provider || "openai") as PromptCacheProvider,
        model: String(item?.model || "unknown"),
        inputTokens: Math.max(0, Math.round(Number(item?.inputTokens) || 0)),
        cachedTokens: Math.max(0, Math.round(Number(item?.cachedTokens) || 0)),
        outputTokens: Math.max(0, Math.round(Number(item?.outputTokens) || 0)),
        savingsRatio: Math.max(0, Math.min(1, Number(item?.savingsRatio) || 0)),
      }))
      .filter((item) => item.inputTokens > 0)
      .slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory(history: PromptCacheTurnStat[]) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // Ignore storage failures; cache telemetry should never block chat.
  }
}

function notifyPromptCacheUpdated() {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {
    // no-op
  }
}

export function subscribePromptCacheStats(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

export function recordPromptCacheTurn(provider: PromptCacheProvider, model: string, usage: any): PromptCacheTurnStat | null {
  const parsed = parseUsageForPromptCache(usage);
  if (!parsed) return null;

  const stat: PromptCacheTurnStat = {
    ts: Date.now(),
    provider,
    model: String(model || "").trim() || "unknown",
    inputTokens: parsed.inputTokens,
    cachedTokens: parsed.cachedTokens,
    outputTokens: parsed.outputTokens,
    savingsRatio: parsed.inputTokens > 0 ? parsed.cachedTokens / parsed.inputTokens : 0,
  };
  const history = [...readHistory(), stat].slice(-HISTORY_LIMIT);
  writeHistory(history);
  notifyPromptCacheUpdated();
  return stat;
}

export function getPromptCacheStats(windowSize = 30): PromptCacheStatsSnapshot {
  const size = Math.max(1, Math.min(HISTORY_LIMIT, Math.round(Number(windowSize) || 30)));
  const turns = readHistory().slice(-size).reverse();
  const totalInputTokens = turns.reduce((sum, item) => sum + item.inputTokens, 0);
  const totalCachedTokens = turns.reduce((sum, item) => sum + item.cachedTokens, 0);
  const sampleCount = turns.length;

  return {
    windowSize: size,
    sampleCount,
    totalInputTokens,
    totalCachedTokens,
    avgInputTokens: sampleCount > 0 ? totalInputTokens / sampleCount : 0,
    avgCachedTokens: sampleCount > 0 ? totalCachedTokens / sampleCount : 0,
    avgSavingsRatio: totalInputTokens > 0 ? totalCachedTokens / totalInputTokens : 0,
    lastTurn: turns[0] || null,
    turns,
  };
}

export function clearPromptCacheStats() {
  writeHistory([]);
  notifyPromptCacheUpdated();
}

