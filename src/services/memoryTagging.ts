import type { ModelProvider, ProviderProfile, UplinkSettings } from "../types";
import { getActiveProfile } from "../settings/uplinkSettings";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeTag(value: unknown): string {
  return String(value || "")
    .replace(/^#+/, "")
    .replace(/[，,。；;:："'“”‘’[\]{}()（）]/g, " ")
    .trim()
    .replace(/\s+/g, "");
}

function cleanTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(normalizeTag)
        .filter((tag) => tag && tag.length >= 2 && tag.length <= 8)
        .filter((tag) => !["AI", "User", "用户", "使用者", "我们", "你", "我", "他", "她"].includes(tag)),
    ),
  ).slice(0, 3);
}

function parseTagPayload(text: string, expectedCount: number): string[][] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("模型没有返回 JSON 标签数组。");
  const payload = JSON.parse(match[0]);
  if (!Array.isArray(payload)) throw new Error("模型返回格式不是数组。");

  return Array.from({ length: expectedCount }, (_, index) => cleanTagList(payload[index]));
}

function extractOpenAICompatibleText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n");
  }
  return payload?.choices?.[0]?.text || "";
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const rawText = await response.text();
  let payload: any = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { text: rawText };
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || rawText || response.statusText;
    throw new Error(`API Error ${response.status}: ${message}`);
  }

  return payload;
}

function buildTagPrompt(memories: string[]): string {
  return [
    "[任务] 你是系统的记忆归档员。",
    `请分析以下 ${memories.length} 条记忆碎片，并为每一条提取 1-3 个最核心的分类标签。`,
    "",
    "[规则]",
    "1. 标签必须是简短中文名词，优先 2-4 个字。",
    "2. 不要使用人名、代词或 AI/User/用户/我们/你/我 作为标签。",
    "3. 归纳同义词，例如“吃饭/食物/口味”可以归为“饮食”。",
    "4. 只输出 JSON 二维数组，不要 Markdown，不要解释。",
    "",
    "[输出示例]",
    '[["长期项目","创作"],["情绪支持"]]',
    "",
    "[待处理记忆]",
    JSON.stringify(memories),
  ].join("\n");
}

async function generateWithOpenAICompatible(provider: ModelProvider, profile: ProviderProfile, prompt: string): Promise<string> {
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: profile.model,
    messages: [
      { role: "system", content: "You are a JSON generator. Return valid JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.25,
    max_tokens: 900,
    stream: false,
  };

  if (provider === "glm") {
    body.thinking = { type: "disabled" };
  }

  const payload = await requestJson(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return extractOpenAICompatibleText(payload);
}

async function generateWithClaude(profile: ProviderProfile, prompt: string): Promise<string> {
  const payload = await requestJson(`${trimTrailingSlash(profile.baseUrl)}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: 900,
      temperature: 0.25,
      system: "You are a JSON generator. Return valid JSON only.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  return Array.isArray(payload?.content)
    ? payload.content.map((part: any) => part?.text || "").filter(Boolean).join("\n")
    : "";
}

async function generateWithGemini(profile: ProviderProfile, prompt: string): Promise<string> {
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/models/${encodeURIComponent(profile.model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
  const payload = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `You are a JSON generator. Return valid JSON only.\n\n${prompt}` }] }],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 900,
      },
    }),
  });

  return payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text || "")
    .filter(Boolean)
    .join("\n") || "";
}

export async function generateBatchMemoryTags(settings: UplinkSettings, memories: string[]): Promise<string[][]> {
  if (!memories.length) return [];
  const profile = getActiveProfile(settings);
  if (!profile.apiKey.trim()) {
    throw new Error("请先在系统设置里填写当前模型通道的 API Key。");
  }

  const prompt = buildTagPrompt(memories);
  let text = "";

  if (settings.activeProvider === "claude") {
    text = await generateWithClaude(profile, prompt);
  } else if (settings.activeProvider === "gemini") {
    text = await generateWithGemini(profile, prompt);
  } else {
    text = await generateWithOpenAICompatible(settings.activeProvider, profile, prompt);
  }

  return parseTagPayload(text, memories.length);
}
