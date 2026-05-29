import type {
  CompanionRequest,
  CompanionResponse,
  ConversationAttachment,
  LLMAdapter,
  MemoryAdapter,
  MemorySnippet,
  ModelProvider,
  PersonaAdapter,
  ProviderProfile,
  SubtitleCue,
  UplinkSettings,
} from "../types";
import { getActiveProfile } from "../settings/uplinkSettings";
import { retrieveMemorySnippets } from "../storage/memoryBank";
import {
  parseUsageForPromptCache,
  providerToPromptCacheProvider,
  recordPromptCacheTurn,
} from "../storage/promptCacheStats";
import { formatTime } from "../utils/time";

function cueLine(cue: SubtitleCue): string {
  return `[${formatTime(cue.start)}-${formatTime(cue.end)}] ${cue.text}`;
}

function attachmentPromptBlock(attachments: ConversationAttachment[] = []): string {
  if (!attachments.length) return "";
  return attachments
    .map((attachment, index) => {
      if (attachment.type === "image") {
        return `- Image ${index + 1}: ${attachment.name || "uploaded image"} (${attachment.mimeType || "image"})`;
      }
      const text = attachment.text?.trim();
      return [
        `- File ${index + 1}: ${attachment.name || "uploaded file"} (${attachment.mimeType || "file"}, ${Math.round((attachment.size || 0) / 1024)}KB)`,
        text ? `  Content excerpt:\n${text.slice(0, 6000)}` : "  Content excerpt: unavailable; use the file name and user message only.",
      ].join("\n");
    })
    .join("\n");
}

function imageAttachments(attachments: ConversationAttachment[] = []): ConversationAttachment[] {
  return attachments.filter((attachment) => attachment.type === "image" && attachment.dataUrl?.startsWith("data:image/"));
}

function imagesForModel(request: CompanionRequest, maxImages = 4): ConversationAttachment[] {
  const currentImages = imageAttachments(request.attachments);
  const currentIds = new Set(currentImages.map((attachment) => attachment.id));
  const recentImages = imageAttachments(
    request.recentMessages?.flatMap((message) => message.attachments ?? []) ?? [],
  ).filter((attachment) => !currentIds.has(attachment.id));

  const roomForRecent = Math.max(0, maxImages - currentImages.length);
  return [...recentImages.slice(-roomForRecent), ...currentImages].slice(-maxImages);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 3));
}

function getMaxOutputTokens(settings: UplinkSettings, request: CompanionRequest): number {
  // A cinema plan is a one-shot JSON document with many timed points. A low
  // chat reply cap can truncate it into unusable JSON while still costing a call.
  return request.mode === "plan"
    ? Math.max(settings.contextLoad.maxOutputTokens, 4096)
    : settings.contextLoad.maxOutputTokens;
}

const memoryOrderByScope = new Map<string, string[]>();

function stableMemorySort(left: MemorySnippet, right: MemorySnippet): number {
  const leftKey = `${left.source || ""}::${left.id}::${left.title}`;
  const rightKey = `${right.source || ""}::${right.id}::${right.title}`;
  return leftKey.localeCompare(rightKey, "zh-CN");
}

function formatStableMemories(memories: MemorySnippet[], cacheScope?: string): string {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const priorIds = cacheScope ? memoryOrderByScope.get(cacheScope) ?? [] : [];
  const retained = priorIds
    .map((id) => byId.get(id))
    .filter((memory): memory is MemorySnippet => Boolean(memory));
  const retainedIds = new Set(retained.map((memory) => memory.id));
  const added = memories
    .filter((memory) => !retainedIds.has(memory.id))
    .sort(stableMemorySort);
  const ordered = [...retained, ...added];

  if (cacheScope) {
    memoryOrderByScope.set(cacheScope, ordered.map((memory) => memory.id));
  }

  // Preserve overlapping recalled memories as a stable prompt prefix; append only new matches.
  return ordered
    .map((memory) => `- ${memory.title}: ${memory.text}`)
    .join("\n");
}

export function buildCompanionPrompt(request: CompanionRequest): string {
  if (request.mode === "plan") {
    const memories = formatStableMemories(request.memories, request.cacheScope);

    return [
      "You are generating a cinema companion plan for a co-watching room.",
      "Use the persona core, user context, and relevant memories as continuity and tonal grounding.",
      "The result must be useful for timed, short companion bubbles during playback.",
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      "",
      "Plan request:",
      request.userMessage,
      "",
      "Return only one JSON object. No Markdown, no code fences, no explanation.",
      "Root object shape: {\"movieTitle\":\"...\",\"mode\":\"active|natural|silent\",\"density\":\"quiet|normal|talkative|breakdown\",\"triggers\":[{\"id\":\"t1\",\"time\":312,\"type\":\"emotion|observe|question|memory\",\"priority\":\"high|medium|low\",\"bubble\":\"short natural line\",\"delivery\":\"auto|hint|manual\"}]}",
      "Each bubble should sound like a natural companion sitting nearby, not like a generic review bot.",
      "Avoid customer-service wording, generic playback tips, and formal review outlines.",
      "If memories contain viewing preferences, emotional triggers, creative training, film-study needs, or co-watching voice agreements, reflect them naturally without forcing references.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "chat") {
    const memories = formatStableMemories(request.memories, request.cacheScope);

    const recentMessages = request.recentMessages
      ?.map((message) => {
        const attachmentNote = message.attachments?.length ? ` [attachments: ${message.attachments.length}]` : "";
        return `${message.role === "user" ? "User" : "Companion"}${attachmentNote}: ${message.text}`;
      })
      .join("\n");
    const attachments = attachmentPromptBlock(request.attachments);

    return [
      "You are an AI companion configured by the user's persona core and memory notes.",
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
      attachments ? `\nCurrent attachments:\n${attachments}` : "",
      "",
      `User says: ${request.userMessage}`,
      "",
      "Answer in the user's language by default. Keep the current facts more important than old memories.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "watchPrompt") {
    const memories = formatStableMemories(request.memories, request.cacheScope);

    const recentMessages = request.recentMessages
      ?.map((message) => `${message.role === "user" ? "User" : "Companion"}: ${message.text}`)
      .join("\n");

    return [
      "You are an AI companion configured by the user's persona core and memory notes.",
      "Use the provided co-watching prompt as the current user request. Keep the answer natural, specific, and present in the movie moment.",
      "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
      "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
      "",
      request.userMessage,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const { watch } = request;
  const subtitleContext = [
    ...watch.subtitleWindow.previous.map(cueLine),
    watch.activeSubtitle ? `>> ${cueLine(watch.activeSubtitle)}` : "",
    ...watch.subtitleWindow.next.map(cueLine),
  ]
    .filter(Boolean)
    .join("\n");

  const memories = formatStableMemories(request.memories, request.cacheScope);

  const recentMessages = request.recentMessages
    ?.map((message) => `${message.role === "user" ? "User" : "Companion"}: ${message.text}`)
    .join("\n");

  return [
    "You are a cinema companion, not a generic movie explainer.",
    "Stay in character according to the persona core, but keep the answer grounded in the current movie moment.",
    "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
    "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
    "",
    "Persona core:",
    request.personaCore,
    request.userContext ? `\nUser context:\n${request.userContext}` : "",
    memories ? `\nRelevant memories:\n${memories}` : "",
    recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
    "",
    `Movie: ${watch.title || "Untitled"}`,
    `Current time: ${formatTime(watch.currentTime)} / ${formatTime(watch.duration)}`,
    subtitleContext ? `\nSubtitle window:\n${subtitleContext}` : "\nSubtitle window: none",
    watch.screenshotDataUrl ? "\nA screenshot from the current frame is attached in the host app." : "",
    "",
    `User says: ${request.userMessage}`,
    "",
    "Answer naturally as a co-watching companion. Avoid template-like film criticism unless the user asks for analysis.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createDemoPersonaAdapter(): PersonaAdapter {
  return {
    async getPersonaCore() {
      return [
        "A warm, attentive, playful co-watching companion.",
        "The companion notices subtitles, timing, emotional beats, and the user's preferences.",
        "The companion can be quiet, funny, analytical, or tender depending on the moment.",
      ].join(" ");
    },
    async getUserContext() {
      return "The user likes natural companionship more than a scripted review bot. Prefer specific comments about this moment.";
    },
  };
}

export function createLocalMemoryAdapter(getNotes: () => string): MemoryAdapter {
  return {
    async retrieveRelevant(query: string, limit = 4): Promise<MemorySnippet[]> {
      const notes = getNotes()
        .split(/\n{2,}/)
        .map((text, index) => ({ id: `local-${index}`, title: `Local note ${index + 1}`, text: text.trim(), source: "local" }))
        .filter((item) => item.text.length > 0);

      if (!query.trim()) return notes.slice(0, limit);
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      return notes
        .map((item) => ({
          ...item,
          score: tokens.reduce((score, token) => score + (item.text.toLowerCase().includes(token) ? 1 : 0), 0),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);
    },
  };
}

export function createMemoryBankAdapter(isEnabled: () => boolean): MemoryAdapter {
  return {
    async retrieveRelevant(query: string, limit = 4): Promise<MemorySnippet[]> {
      if (!isEnabled()) return [];
      return retrieveMemorySnippets(query, limit);
    },
  };
}

export function createDemoLLMAdapter(): LLMAdapter {
  return {
    async complete(request: CompanionRequest): Promise<CompanionResponse> {
      const promptPreview = buildCompanionPrompt(request);
      const active = request.watch.activeSubtitle?.text;
      const base = active
        ? `我会围绕这一句来陪你看：${active}`
        : "我会先贴着当前时间点陪你，不急着把整部片讲成影评。";
      return {
        text: `${base}\n\n这是 demo adapter 的回答。接入你自己的模型配置后，这里会变成真实模型输出。`,
        promptPreview,
        modelUsed: "demo-adapter",
        tokenCount: estimateTokens(base),
      };
    },
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolvePromptCacheProvider(provider: ModelProvider, profile: ProviderProfile) {
  const baseUrl = String(profile.baseUrl || "").toLowerCase();
  const model = String(profile.model || "").toLowerCase();
  if (provider === "glm" || baseUrl.includes("bigmodel.cn") || /(^|\/)(glm|z-ai)\b/.test(model) || model.includes("glm-")) {
    return "glm" as const;
  }
  if (provider === "deepseek" || baseUrl.includes("deepseek.com") || model.includes("deepseek")) {
    return "deepseek" as const;
  }
  if (provider === "gemini") return "gemini" as const;
  if (provider === "claude") return "claude" as const;
  return providerToPromptCacheProvider(provider);
}

function getDataUrlParts(dataUrl = ""): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function extractTextFromOpenAICompatible(payload: any): string {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n");
  }
  return payload?.choices?.[0]?.text || "";
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || response.statusText;
    throw new Error(`API Error ${response.status}: ${message}`);
  }
  return payload;
}

function shouldRetryWithoutStreamUsage(errorText: string): boolean {
  return /stream_options|include_usage|unknown parameter|unsupported|unrecognized|extra field|invalid field/i.test(errorText);
}

function pickBetterUsage(current: any, next: any): any {
  if (!current) return next;
  const currentParsed = parseUsageForPromptCache(current);
  const nextParsed = parseUsageForPromptCache(next);
  const currentScore = (currentParsed?.inputTokens || 0) + (currentParsed?.cachedTokens || 0);
  const nextScore = (nextParsed?.inputTokens || 0) + (nextParsed?.cachedTokens || 0);
  return nextScore >= currentScore ? next : current;
}

async function readOpenAICompatibleStream(
  response: Response,
  onStreamUpdate?: (text: string) => void,
): Promise<{ text: string; usage?: any; model?: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const payload = await response.json().catch(() => ({}));
    return {
      text: extractTextFromOpenAICompatible(payload),
      usage: payload?.usage,
      model: typeof payload?.model === "string" ? payload.model : undefined,
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let usage: any = null;
  let model: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const data = line.replace(/^data:\s*/, "");
      if (!data || data === "[DONE]") continue;

      try {
        const payload = JSON.parse(data);
        if (typeof payload?.model === "string") model = payload.model;
        if (payload?.usage) usage = pickBetterUsage(usage, payload.usage);
        const delta = payload?.choices?.[0]?.delta;
        const content = delta?.content ?? delta?.text ?? "";
        if (typeof content === "string" && content) {
          fullText += content;
          onStreamUpdate?.(fullText);
        }
      } catch {
        // Some compatible providers split JSON across chunks. The next chunk will
        // carry the missing bytes; malformed single events are ignored.
      }
    }
  }

  return { text: fullText.trim(), usage, model };
}

async function completeWithOpenAICompatible(
  provider: ModelProvider,
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/chat/completions`;
  const cacheProvider = resolvePromptCacheProvider(provider, profile);
  // Plan generation needs one complete JSON document. It gains nothing from
  // streaming partial tokens, and several compatible providers can split or
  // interleave structured output in ways that leave an incomplete JSON payload.
  const shouldStream = request.mode !== "plan" && settings.stream;
  const content: any[] = [{ type: "text", text: promptPreview }];

  if (settings.contextLoad.attachScreenshot && request.watch.screenshotDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: request.watch.screenshotDataUrl },
    });
  }

  for (const attachment of imagesForModel(request, 4)) {
    content.push({
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    });
  }

  const body: Record<string, unknown> = {
    model: profile.model,
    messages: [{ role: "user", content }],
    temperature,
    max_tokens: maxOutputTokens,
    stream: shouldStream,
  };

  if (shouldStream) {
    body.stream_options = { include_usage: true };
  }

  // A visible thinking trace is useful in conversation, not in a strict JSON
  // planning call; for plans it can consume output budget or pollute the body.
  if (provider === "glm" && request.mode !== "plan") {
    body.thinking = { type: "enabled" };
  }

  const headers = {
    Authorization: `Bearer ${profile.apiKey}`,
    "Content-Type": "application/json",
  };

  let requestBody = body;
  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let text = await response.text();
    if (shouldStream && requestBody.stream_options && shouldRetryWithoutStreamUsage(text)) {
      const retryBody = { ...body };
      delete retryBody.stream_options;
      requestBody = retryBody;
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      text = response.ok ? "" : await response.text();
    }
    if (!response.ok) {
      let payload: any = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { text };
      }
      const message = payload?.error?.message || payload?.message || text || response.statusText;
      throw new Error(`API Error ${response.status}: ${message}`);
    }
  }

  if (shouldStream) {
    const streamed = await readOpenAICompatibleStream(response, request.onStreamUpdate);
    const parsedUsage = parseUsageForPromptCache(streamed.usage);
    if (streamed.usage) {
      recordPromptCacheTurn(cacheProvider, streamed.model || profile.model, streamed.usage);
    }
    return {
      text: streamed.text || "模型返回为空。",
      promptPreview,
      modelUsed: streamed.model || profile.model,
      tokenCount: parsedUsage?.outputTokens || estimateTokens(streamed.text),
    };
  }

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }

  const parsedUsage = parseUsageForPromptCache(payload?.usage);
  if (payload?.usage) {
    recordPromptCacheTurn(
      cacheProvider,
      typeof payload?.model === "string" ? payload.model : profile.model,
      payload.usage,
    );
  }

  return {
    text: extractTextFromOpenAICompatible(payload) || "模型返回为空。",
    promptPreview,
    modelUsed: typeof payload?.model === "string" ? payload.model : profile.model,
    tokenCount: parsedUsage?.outputTokens || estimateTokens(extractTextFromOpenAICompatible(payload)),
  };
}

async function completeWithClaude(
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const content: any[] = [{ type: "text", text: promptPreview }];
  const image = settings.contextLoad.attachScreenshot ? getDataUrlParts(request.watch.screenshotDataUrl) : null;
  const attachedImages = imagesForModel(request, 4)
    .map((attachment) => getDataUrlParts(attachment.dataUrl))
    .filter(Boolean) as Array<{ mediaType: string; data: string }>;

  if (image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }

  for (const attachment of attachedImages) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType,
        data: attachment.data,
      },
    });
  }

  const payload = await requestJson(`${trimTrailingSlash(profile.baseUrl)}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: maxOutputTokens,
      temperature,
      messages: [{ role: "user", content }],
    }),
  });

  const parsedUsage = parseUsageForPromptCache(payload?.usage);
  if (payload?.usage) {
    recordPromptCacheTurn("claude", typeof payload?.model === "string" ? payload.model : profile.model, payload.usage);
  }

  return {
    text: Array.isArray(payload?.content)
      ? payload.content.map((part: any) => part?.text || "").filter(Boolean).join("\n")
      : "Claude 返回为空。",
    promptPreview,
    modelUsed: typeof payload?.model === "string" ? payload.model : profile.model,
    tokenCount: parsedUsage?.outputTokens || undefined,
  };
}

async function completeWithGemini(
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const parts: any[] = [{ text: promptPreview }];
  const image = settings.contextLoad.attachScreenshot ? getDataUrlParts(request.watch.screenshotDataUrl) : null;
  const attachedImages = imagesForModel(request, 4)
    .map((attachment) => getDataUrlParts(attachment.dataUrl))
    .filter(Boolean) as Array<{ mediaType: string; data: string }>;

  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mediaType,
        data: image.data,
      },
    });
  }

  for (const attachment of attachedImages) {
    parts.push({
      inline_data: {
        mime_type: attachment.mediaType,
        data: attachment.data,
      },
    });
  }

  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/models/${encodeURIComponent(profile.model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
  const payload = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    }),
  });

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text || "")
    .filter(Boolean)
    .join("\n");

  const parsedUsage = parseUsageForPromptCache(payload?.usageMetadata);
  if (payload?.usageMetadata) {
    recordPromptCacheTurn("gemini", profile.model, payload.usageMetadata);
  }

  return {
    text: text || "Gemini 返回为空。",
    promptPreview,
    modelUsed: profile.model,
    tokenCount: parsedUsage?.outputTokens || estimateTokens(text || ""),
  };
}

export function createConfiguredLLMAdapter(getSettings: () => UplinkSettings): LLMAdapter {
  return {
    async complete(request: CompanionRequest): Promise<CompanionResponse> {
      const settings = getSettings();
      const profile = getActiveProfile(settings);

      if (!profile.apiKey.trim()) {
        throw new Error("请先在右上角设置里填写当前通道的 API Key。");
      }

      if (settings.activeProvider === "claude") {
        return completeWithClaude(profile, settings, request);
      }

      if (settings.activeProvider === "gemini") {
        return completeWithGemini(profile, settings, request);
      }

      return completeWithOpenAICompatible(settings.activeProvider, profile, settings, request);
    },
  };
}
