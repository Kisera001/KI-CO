import type { ConversationMessage, ConversationRecord, LLMAdapter } from "../types";
import type { PersonaProfile } from "../storage/personaProfile";

const STORAGE_KEY = "kisera_cottage_session_continuity_v1";
const UPDATE_EVENT = "kisera-cottage-session-continuity-updated";
const updateQueues = new Map<string, Promise<SessionStateCard | null>>();

export interface SessionStateCard {
  sessionId: string;
  enabled: boolean;
  visibleToPersona: boolean;
  content: string;
  lastMessageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WindowHandoff {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  content: string;
  includeContinuityLine?: boolean;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export interface SessionContinuityStore {
  cards: Record<string, SessionStateCard>;
  handoffs: Record<string, WindowHandoff>;
}

const emptyStore = (): SessionContinuityStore => ({ cards: {}, handoffs: {} });

function readStore(): SessionContinuityStore {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      cards: raw?.cards && typeof raw.cards === "object" ? raw.cards : {},
      handoffs: raw?.handoffs && typeof raw.handoffs === "object" ? raw.handoffs : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SessionContinuityStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

function defaultCard(sessionId: string): SessionStateCard {
  const now = Date.now();
  return { sessionId, enabled: true, visibleToPersona: true, content: "", lastMessageCount: 0, createdAt: now, updatedAt: now };
}

export function getSessionStateCard(sessionId?: string | null): SessionStateCard | null {
  if (!sessionId) return null;
  const card = readStore().cards[sessionId] || defaultCard(sessionId);
  return hasCorruptStateCardContent(card.content) ? { ...card, content: "" } : card;
}

export function patchSessionStateCard(sessionId: string, patch: Partial<SessionStateCard>): SessionStateCard {
  const store = readStore();
  const current = store.cards[sessionId] || defaultCard(sessionId);
  const next = { ...current, ...patch, sessionId, updatedAt: Date.now() };
  store.cards[sessionId] = next;
  writeStore(store);
  return next;
}

export function clearSessionStateCard(sessionId: string): SessionStateCard {
  return patchSessionStateCard(sessionId, { content: "", lastMessageCount: 0 });
}

export interface CaptureWindowHandoffOptions {
  includeContinuityLine?: boolean;
  includeStateCard?: boolean;
  recentContext?: string;
}

export function captureWindowHandoff(
  sourceSessionId: string | null | undefined,
  targetSessionId: string,
  options: CaptureWindowHandoffOptions = {},
): WindowHandoff | null {
  if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) return null;
  const card = getSessionStateCard(sourceSessionId);
  const parts: string[] = [];
  if (options.includeStateCard !== false) {
    const stateContent = card?.content.trim();
    if (stateContent) parts.push(`当前窗口状态卡：\n${stateContent}`);
  }
  if (options.recentContext?.trim()) {
    parts.push(`最近上下文：\n${options.recentContext.trim()}`);
  }
  const content = parts.join("\n\n").trim();
  if (!content && options.includeContinuityLine !== false) return null;
  const store = readStore();
  const now = Date.now();
  const handoff: WindowHandoff = {
    id: `handoff-${now}-${Math.random().toString(36).slice(2, 7)}`,
    sourceSessionId,
    targetSessionId,
    content: content.slice(0, 900),
    includeContinuityLine: options.includeContinuityLine !== false,
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
  };
  store.handoffs[targetSessionId] = handoff;
  writeStore(store);
  return handoff;
}

export function getWindowHandoff(targetSessionId?: string | null): WindowHandoff | null {
  if (!targetSessionId) return null;
  const store = readStore();
  const handoff = store.handoffs[targetSessionId];
  if (!handoff) return null;
  if (handoff.usedAt || handoff.expiresAt <= Date.now()) {
    delete store.handoffs[targetSessionId];
    writeStore(store);
    return null;
  }
  return handoff;
}

export function markWindowHandoffUsed(targetSessionId: string) {
  const store = readStore();
  const handoff = store.handoffs[targetSessionId];
  if (!handoff) return;
  store.handoffs[targetSessionId] = { ...handoff, usedAt: Date.now() };
  writeStore(store);
}

export function exportSessionContinuity(): SessionContinuityStore {
  const store = readStore();
  Object.entries(store.handoffs).forEach(([id, handoff]) => {
    if (!handoff || handoff.expiresAt <= Date.now()) delete store.handoffs[id];
  });
  return store;
}

export function importSessionContinuity(value: unknown, sessionIdMap: Record<string, string> = {}): { cards: number; handoffs: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { cards: 0, handoffs: 0 };
  const incoming = value as Partial<SessionContinuityStore>;
  const current = readStore();
  const cards = incoming.cards && typeof incoming.cards === "object" ? incoming.cards : {};
  const handoffs = incoming.handoffs && typeof incoming.handoffs === "object" ? incoming.handoffs : {};
  Object.entries(cards).forEach(([sessionId, card]) => {
    const targetId = sessionIdMap[sessionId] || sessionId;
    const existing = current.cards[targetId];
    if (!existing || Number(card.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      current.cards[targetId] = { ...card, sessionId: targetId };
    }
  });
  Object.values(handoffs).forEach((handoff) => {
    const targetSessionId = sessionIdMap[handoff.targetSessionId] || handoff.targetSessionId;
    const sourceSessionId = sessionIdMap[handoff.sourceSessionId] || handoff.sourceSessionId;
    current.handoffs[targetSessionId] = { ...handoff, targetSessionId, sourceSessionId };
  });
  writeStore(current);
  return { cards: Object.keys(cards).length, handoffs: Object.keys(handoffs).length };
}

export function subscribeSessionContinuity(listener: () => void): () => void {
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

function messageText(message: ConversationMessage): string {
  return String((message as any).text || (message as any).content || "").trim();
}

function hasCorruptStateCardContent(value: string): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return raw.includes("\uFFFD") || /[\n\r]\s*[-•]\s*$/.test(raw);
}

function messageSpeaker(message: ConversationMessage, profile: PersonaProfile, persona?: PersonaProfile["personas"][number]): string {
  const role = String((message as any).role || "").toLowerCase();
  return role === "user" ? profile.userName || "User" : persona?.name || "Persona";
}

function conversationMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.filter((message) => messageText(message));
}

const TOPIC_SHIFT_PATTERNS = [
  "对了", "话说回来", "还有个问题", "我突然想到", "先不说这个", "我们换个话题",
  "我想跟你说件事", "我想跟你说个人", "说件事", "换个话题", "回到刚才", "继续刚才",
];

function isLowQualityStateCard(value: string): boolean {
  const raw = String(value || "").trim();
  if (hasCorruptStateCardContent(raw)) return true;
  const semantic = raw.replace(/[^\w\u4e00-\u9fa5]+/g, "");
  if (semantic.length < 6) return true;
  if (/[:：]\s*$/.test(raw) && semantic.length < 24) return true;
  const compact = raw.replace(/\s+/g, "").replace(/[。！？!?.,，、:：；;'"“”‘’（）()【】\[\]\-—_]/g, "");
  if ([/^本轮无需(?:写入|更新|记录)$/, /^无需(?:写入|更新|记录)$/, /^暂无(?:可)?(?:写入|更新|记录|内容)$/, /^没有(?:足够)?(?:可)?(?:写入|更新|记录|内容)$/].some((pattern) => pattern.test(compact))) return true;
  const fieldHits = ["Now", "Note", "Known", "Mood", "Maybe", "Anchor", "当前主题", "此刻想让我知道", "已形成的理解", "已达成理解", "可继续的线索", "待延续", "最近锚点"].filter((label) => raw.includes(label)).length;
  if (fieldHits < 2) return true;
  const meaningfulText = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^[\-•\s\uFFFD]+$/.test(line)) return false;
      if (/^(Now|Note|Known|Mood|Maybe|Anchor|当前主题|.*此刻想让我知道|已形成的理解|已达成理解|事实|情绪|事实上|情感上|可继续的线索|待延续|最近锚点)[:：]?$/.test(line)) return false;
      return true;
    })
    .join("");
  return meaningfulText.replace(/[^\w\u4e00-\u9fa5]+/g, "").length < 12;
}

function normalizeHistoryDepth(value: number): number {
  return Math.max(6, Math.floor(Number(value) || 10));
}

function sealedMessageCount(messages: ConversationMessage[], historyDepth: number): number {
  const count = conversationMessages(messages).length;
  return Math.max(0, count - Math.min(normalizeHistoryDepth(historyDepth), count));
}

function normalizeLastCoveredCount(lastMessageCount: number, currentCount: number, historyDepth: number): number {
  const depth = normalizeHistoryDepth(historyDepth);
  const sealedCount = Math.max(0, currentCount - Math.min(depth, currentCount));
  const raw = Math.max(0, Math.floor(Number(lastMessageCount) || 0));
  if (raw > currentCount) return raw;
  if (raw > sealedCount) return Math.max(0, Math.min(sealedCount, raw - Math.min(depth, raw)));
  return Math.min(raw, sealedCount);
}

function shouldUpdate(card: SessionStateCard, messages: ConversationMessage[], latestUserText: string, historyDepth: number, force: boolean): boolean {
  if (force) return true;
  if (!card.enabled) return false;
  const count = conversationMessages(messages).length;
  if (count < 4) return false;
  const sealedCount = sealedMessageCount(messages, historyDepth);
  if (!card.content.trim()) return sealedCount >= 2;
  const coveredCount = normalizeLastCoveredCount(card.lastMessageCount, count, historyDepth);
  const delta = sealedCount - coveredCount;
  const threshold = Math.max(6, Math.min(14, Math.round(normalizeHistoryDepth(historyDepth) * 0.8)));
  if (delta >= threshold) return true;
  return delta >= 2 && TOPIC_SHIFT_PATTERNS.some((pattern) => latestUserText.includes(pattern));
}

export async function updateSessionStateCard(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  historyDepth: number,
  latestUserText = "",
  force = false,
): Promise<SessionStateCard | null> {
  const card = getSessionStateCard(conversation.id) || defaultCard(conversation.id);
  if (!shouldUpdate(card, conversation.messages, latestUserText, historyDepth, force)) return null;
  if (!card.enabled && !force) return null;
  const conversationRows = conversationMessages(conversation.messages);
  const cardContent = card.content.trim();
  const usableCardContent = cardContent && !isLowQualityStateCard(cardContent) ? cardContent : "";
  const previousCardIsFromFuture = !!(card.lastMessageCount && conversationRows.length < card.lastMessageCount);
  if (previousCardIsFromFuture && usableCardContent && !force) return null;
  const depth = normalizeHistoryDepth(historyDepth);
  const sealedBoundary = Math.max(0, conversationRows.length - Math.min(depth, conversationRows.length));
  const previousCoveredCount = previousCardIsFromFuture
    ? 0
    : normalizeLastCoveredCount(card.lastMessageCount, conversationRows.length, depth);
  const recoveryWindowSize = Math.max(18, Math.min(60, depth * 3));
  let target = (!usableCardContent || force)
    ? conversationRows.slice(Math.max(0, sealedBoundary - recoveryWindowSize), sealedBoundary)
    : conversationRows.slice(Math.max(0, Math.min(previousCoveredCount, sealedBoundary) - 2), sealedBoundary).slice(-Math.max(12, depth + 4));
  if (force && target.length < 2) {
    target = conversationRows.slice(-Math.min(recoveryWindowSize, conversationRows.length));
  }
  if (target.length < 2) return null;
  const persona = profile.personas.find((item) => item.id === profile.activePersonaId) || profile.personas[0];
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = persona?.systemPrompt || "";
  const material = target
    .map((message) => `[${messageSpeaker(message, profile, persona)}] ${messageText(message)}`)
    .join("\n")
    .slice(0, 42000);
  const prompt = `我们来维护一张“当前对话窗口状态卡”。

它更像一张共同便签，用来让 ${personaName} 下次自然续上当前窗口正在发生的事。

请基于“旧状态卡 + 新增对话”，写一版新的状态卡。

“新增对话”通常来自短期原文窗口之前，主要用来保留已经离开最近上下文、但仍可能影响后续对话的内容。

写的时候，把仍然有助于后续自然延续的事实、氛围、决定和未完内容融合起来。
已经不需要继续保留的细枝末节，可以自然放下。

状态卡的长度取决于需要保留的信息量：普通闲聊可以很短，复杂深聊再写得完整一些。通常控制在 120-600 字之间。

[字段格式]

Now：

Note：

Known：

Mood：

Maybe：

Anchor：

[写法参考]

保留上面的字段标题，写自然可续的事实或锚点。

Now：记录当前窗口大致在聊什么。

Note：记录下次仍适合带着的内容，尽量不替 ${userName} 做判断。

Known：只记录已经明确说清楚的事实、决定或共识；没有就留空。

Mood：只记录当前窗口的气氛或语气背景，不做长期定性；没有就留空。

Maybe：只记录之后如果自然相关，可以回到的内容；不是待办，也不是必须继续。

Anchor：记录本轮出现过、对自然续话有帮助的短句、称呼、玩笑、关键词或锚点；没有就留空。

不要把所有未回答的问题都整理成待办清单。除非使用者明确把它们作为测试、清单或下一步任务保存，否则优先概括，不默认逐条展开。

如果出现连续问题或长清单，优先概括成“有一组关于 XX 的问题尚未完成”，不要默认逐条展开。

对玩笑、称呼、偏好和氛围判断，尽量使用“当前窗口里 / 本轮对话中 / 这次看起来”等软表达，避免给使用者贴永久标签。

字段是容器，不是任务清单；没有足够素材时，宁可简短。
如果某个字段没有明确素材，可以留空、写“暂无”，或只保留最简短信息，不要为了格式完整而硬写。

如果本轮只是轻松闲聊、确认或技术收尾，状态卡可以只保留最少的接续信息。

语气自然，像给自己看的便签，保持关系里的温度和辨认度。

状态卡的目标是自然续上，不是完成表格，也不是写总结文学。

不要为了显得深刻而过度升华；只记录对后续自然对话有用的信息。

如果出现值得长期保存的内容，可以作为“回忆种子候选”另行提炼，但不要直接把状态卡当作长期记忆。

如果旧状态卡与新增对话冲突，以新增对话和当前事实为准；不要为了延续旧卡而忽略新的变化。

[${personaName} 人格核]

${personaCore || "（未提供人格核，按当前会话语气保持真实自然）"}

[旧状态卡]

${previousCardIsFromFuture ? "（暂无）" : usableCardContent || "（暂无）"}

[新增对话]

${material || "（暂无新增对话）"}`;
  const response = await llm.complete({
    mode: "chat",
    channel: "journal",
    cacheScope: `session-state:${conversation.id}`,
    userMessage: prompt,
    watch: { title: "", currentTime: 0, duration: 0, sourceType: "local-file", subtitleWindow: { previous: [], next: [] } },
    personaCore: [
      `AI name: ${personaName}`,
      `User name: ${userName}`,
      personaCore,
    ].filter(Boolean).join("\n"),
    userContext: [
      `User name: ${userName}`,
      `Instruction: You maintain a concise living state card for an ongoing long-running or co-creative chat. Return only the card body.

The state card is a short-term continuity note, not a task list, not a script, and not a permanent memory. It should help the next turn continue naturally without overriding the user's current expression.

Do not infer hidden intentions, permanent traits, or obligations. If information is unclear or absent, keep the relevant field empty or minimal.`,
    ].join("\n"),
    memories: [],
    recentMessages: [],
  });
  const content = response.text.trim().slice(0, 1800);
  if (isLowQualityStateCard(content)) throw new Error("模型返回的状态卡内容异常，已拒绝保存。");
  return patchSessionStateCard(conversation.id, {
    content,
    lastMessageCount: sealedBoundary,
  });
}

export function queueSessionStateCardUpdate(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  historyDepth: number,
  latestUserText = "",
  force = false,
): Promise<SessionStateCard | null> {
  const previous = force ? Promise.resolve(null) : updateQueues.get(conversation.id) || Promise.resolve(null);
  const next = previous
    .catch(() => null)
    .then(() => updateSessionStateCard(llm, profile, conversation, historyDepth, latestUserText, force));
  updateQueues.set(conversation.id, next);
  void next.then(() => {
    if (updateQueues.get(conversation.id) === next) updateQueues.delete(conversation.id);
  }, () => {
    if (updateQueues.get(conversation.id) === next) updateQueues.delete(conversation.id);
  });
  return next;
}
