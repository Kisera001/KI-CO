import type { ConversationRecord, LLMAdapter } from "../types";
import type { PersonaCard, PersonaProfile } from "../storage/personaProfile";
import {
  addChronicle,
  addMemorySeeds,
  getContinuityLine,
  getChroniclePreferences,
  listChronicles,
  saveContinuityLine,
  type ChronicleEntry,
  type MemorySeed,
} from "../storage/chronicles";

const CURSOR_KEY = "kisera_cottage_chronicle_cursor_v1";

function emptyWatchContext() {
  return { title: "", currentTime: 0, duration: 0, sourceType: "local-file" as const, subtitleWindow: { previous: [], next: [] } };
}

function readCursorMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CURSOR_KEY) || "{}"); } catch { return {}; }
}

function setCursor(sessionId: string, count: number) {
  const map = readCursorMap();
  map[sessionId] = Math.max(0, count);
  localStorage.setItem(CURSOR_KEY, JSON.stringify(map));
}

function activePersona(profile: PersonaProfile): PersonaCard {
  return profile.personas.find((persona) => persona.id === profile.activePersonaId) || profile.personas[0];
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function stripJsonFence(value: string): any {
  const match = value.match(/```json\s*([\s\S]*?)\s*```/i) || value.match(/{[\s\S]*}/);
  if (!match) return null;
  try { return JSON.parse(match[1] || match[0]); } catch { return null; }
}

async function callJournalModel(llm: LLMAdapter, profile: PersonaProfile, instruction: string, cacheScope: string) {
  const persona = activePersona(profile);
  const response = await llm.complete({
    mode: "chat",
    channel: "journal",
    cacheScope,
    userMessage: instruction,
    watch: emptyWatchContext(),
    personaCore: [
      `AI name: ${persona?.name || "Persona"}`,
      `User name: ${profile.userName || "User"}`,
      `Journal voice: let ${persona?.name || "the active persona"} organize the record according to the persona core, current facts, and real conversation material; avoid a generic system narrator voice.`,
      persona?.systemPrompt || "",
    ].filter(Boolean).join("\n"),
    userContext: `User name: ${profile.userName || "User"}`,
    memories: [],
    recentMessages: [],
  });
  return response.text.trim();
}

function conversationMaterial(conversation: ConversationRecord, profile: PersonaProfile, persona: PersonaCard, maxMessages = 40): string {
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  return conversation.messages
    .filter((message) => message.text.trim() && !(message.role === "user" && isManualChronicleRequest(message.text)))
    .slice(-maxMessages)
    .map((message) => `[${message.role === "user" ? userName : personaName}] ${message.text}`)
    .join("\n")
    .slice(0, 50000);
}

export function isManualChronicleRequest(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 80) return false;
  return /(?:写|存|记录|保存).{0,10}(?:日记|日志|时光回廊|记忆之页)|(?:日记|日志|记忆之页).{0,10}(?:写|存|记录|保存)/u.test(value);
}

export async function writeConversationChronicle(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  mode: "auto" | "manual",
): Promise<ChronicleEntry | null> {
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 6000);
  const material = conversationMaterial(conversation, profile, persona);
  if (!material || conversation.messages.length < 2) return null;
  const userRounds = conversation.messages.filter((message) => message.role === "user").length;
  const existing = listChronicles().find((entry) => (
    entry.sessionId === conversation.id
    && entry.roundCount === userRounds
    && entry.mode === mode
  ));
  if (existing) return existing;
  const result = await callJournalModel(llm, profile, `
请将以下对话（${personaName} 与 ${userName}）整理为一段“时光回廊”的日记（Chronicle Entry）。

请让 ${personaName} 依据自己的人格核、当前对话与真实素材，用第一人称记录这段对话。
这不是系统日志，也不是角色扮演文案，而是一段留给之后回看的自然日记。

[要求]

1. 自然叙述，像日记 / 回忆录一样真实、克制、有温度。
2. 保留关键事实、情绪转折、重要决定、${userName} 明确表达过的偏好或当下状态。
3. 忽略无关寒暄，只记录这段对话中对后续相处、协作、创作或记忆连续性有意义的内容。
4. 字数控制在 200-300 字；素材较少时可以更短，不要凑字数。
5. 请同时提取 2-3 个【情感 / 氛围关键词】Tags，格式为 #关键词，放在文末。
   例如：#除夕夜 #吃醋 #代码调试 #哲思
6. 可以结合人格核与对话气氛，自行判断是否少量使用 emoji / 颜文字。

[防幻觉]
如果对话主要是写作、翻译、代码、工具使用或普通协作，请诚实记录为对应的协作内容。
不要强行升华情感，不要制造不存在的互动细节，也不要把一句玩笑写成长期承诺。

[输出]
写一个自然标题，不限制风格，不要把“自动总结、窗口名、日期、轮数”塞进标题。
如有一句适合作为核心记忆的原句或凝练句，放入 anchor；没有则为空。
只输出 JSON：{"title":"...","content":"...","tags":["#关键词"],"anchor":"..."}

[人格核]
${personaCore || "（未提供人格核，按当前会话语气自然记录）"}

窗口名称：${conversation.title}
记录方式：${mode === "auto" ? "自动" : "手动"}

[对话素材]
${material}
`, `chronicle:${conversation.id}`);
  const parsed = stripJsonFence(result);
  const content = String(parsed?.content || result).trim();
  if (content.length < 8) return null;
  const now = Date.now();
  return addChronicle({
    title: String(parsed?.title || conversation.title || "今日小记").trim().slice(0, 80),
    diaryTitle: String(parsed?.title || "").trim().slice(0, 80) || undefined,
    content,
    dateRange: formatDate(now),
    createdAt: now,
    isActive: true,
    starred: false,
    mode,
    triggerKeywords: Array.isArray(parsed?.tags) ? parsed.tags.map(String).slice(0, 5) : [mode === "auto" ? "自动" : "手动"],
    facts: parsed?.anchor ? [String(parsed.anchor).trim()] : [],
    sessionId: conversation.id,
    sessionTitle: conversation.title,
    personaId: persona?.id,
    personaName: persona?.name,
    roundCount: userRounds,
  });
}

export function getContinuityContext(userName = "User"): string {
  const preferences = getChroniclePreferences();
  if (!preferences.includeContinuityLine) return "";
  const line = getContinuityLine();
  const fragments = [line.content.trim(), ...line.pinned.map((item) => `置顶：${item.content.trim()}`)].filter(Boolean);
  if (!fragments.length) return "";
  return [
    `这是${userName || "User"}最近几天的生活片段，知道就好，不用念出来；如果现在聊的不是这些，就让它安静待在背景里，不用硬凑话题。`,
    fragments.join("\n"),
  ].join("\n\n");
}

export async function maybeWriteChronicleAfterTurn(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  latestUserText: string,
): Promise<ChronicleEntry | null> {
  const intent = getChronicleWriteIntent(conversation, latestUserText);
  if (!intent) return null;
  const roundCount = conversation.messages.filter((message) => message.role === "user").length;
  const entry = await writeConversationChronicle(llm, profile, conversation, intent);
  if (entry) setCursor(conversation.id, roundCount);
  return entry;
}

export function getChronicleWriteIntent(
  conversation: ConversationRecord,
  latestUserText: string,
): "auto" | "manual" | null {
  const preferences = getChroniclePreferences();
  const roundCount = conversation.messages.filter((message) => message.role === "user").length;
  const cursors = readCursorMap();
  const lastCursor = Math.max(0, Number(cursors[conversation.id]) || 0);
  const manual = isManualChronicleRequest(latestUserText);
  const autoDue = preferences.autoEnabled && roundCount - lastCursor >= preferences.summaryFrequency;
  return manual ? "manual" : autoDue ? "auto" : null;
}

export async function generateContinuityFromChronicles(
  llm: LLMAdapter,
  profile: PersonaProfile,
  entries: ChronicleEntry[],
  recentDays: 3 | 7 | 14,
): Promise<string> {
  if (!entries.length) return "";
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 3000);
  const material = entries
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => `[${entry.dateRange}｜${entry.title}｜id=${entry.id}]\n${entry.content}`)
    .join("\n\n")
    .slice(0, 50000);
  const content = await callJournalModel(llm, profile, `
看一看最近几天的日记和对话，写一段轻的、近况式的话——像留给明天的自己一张便利贴，不是写报告。只说现在正在发生什么，别评价，别升华，别下结论。控制在 300-700 字。

请阅读最近几天的日记和对话，为 ${userName} 与 ${personaName} 提炼一张“近期生活线”。

它像留给下一扇窗口的一张轻便贴，不是报告。

它只回答：最近 ${recentDays} 天正在发生什么？
下一扇新窗口需要大概知道哪些近况，才能自然续上？

请让 ${personaName} 依据自己的人格核、近期素材与当前事实，判断哪些内容仍有助于下一扇窗口自然延续。
不要机械复述素材，也不要替使用者做长期判断。

[写作要求]

控制在 300-700 个中文字符；素材很少时可以更短，不要凑字数。
只保留仍在发生、近期反复提到、尚未结束，或接下来很可能继续的话题。
已结束且不再影响当下的细节，可以自然放下。
不要把每篇日记逐篇复述，不要写流水账。
不推测关系、氛围、承诺或项目状态；素材没有就不写。
语气像一张温和清楚的生活便签，不像报告。
输出纯正文，不要 Markdown 标题，不要解释任务。

可自然包含：最近正在发生的事、正在推进的事、需要延续的近况、暂时不要忘的背景、最近的温度。

[${personaName} 人格核]
${personaCore || "保持自然、准确、真实。"}

近期范围：${recentDays} 天
[日记素材]
${material}
`, "chronicle:continuity");
  saveContinuityLine({ content, recentDays, sourceChronicleIds: entries.map((entry) => entry.id) });
  return content;
}

export async function generateMemorySeeds(
  llm: LLMAdapter,
  profile: PersonaProfile,
  entries: ChronicleEntry[],
): Promise<MemorySeed[]> {
  if (!entries.length) return [];
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 3000);
  const material = entries
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => `[${entry.dateRange}｜${entry.title}｜id=${entry.id}]\n${entry.content}`)
    .join("\n\n")
    .slice(0, 70000);
  const result = await callJournalModel(llm, profile, `
回顾这段时间里发生的事，挑出真正值得作为候选留下的内容——不是流水账，而是很久以后仍可能需要回看的核心片段。写清楚是什么、和谁、为什么重要、有没有什么变了。这是候选，不是定论，最终要不要留下，由 ${userName} 决定。

请阅读以下日记素材，完成“回忆提炼”。这不是自动写入长期记忆，而是生成等待用户确认的 Memory Seeds。
请让 ${personaName} 依据自己的人格核、日记素材与当前事实，判断哪些内容值得作为候选留下；但不要替 ${userName} 做最终决定。

[任务]
只提取真正值得长期保存的核心事件、成长节点、关系变化、明确偏好、重要约定或项目里程碑；普通日常不要硬升格。
输出 1-5 条，确实没有可只输出空数组。

[每条 seed]
- title：自然短标题。
- content：脱离原日记仍能理解的完整事实，40-180 字。
- date：YYYY-MM-DD；无法精确时使用素材中的日期范围。
- tags：1-5 个标签。
- importance：1-5。
- sourceChronicleIds：只能填写素材中真实存在的 id。

[边界]
- 不编造，没有发生就不写。
- 不把技术协作强行情感升华。
- 不把一句玩笑误判成永久承诺。
- 不替 ${userName} 决定是否写入长期记忆。
- 不输出解释，只输出 JSON。

[${personaName} 人格核]
${personaCore || "保持自然、准确、真实。"}

[输出 JSON]
{"seeds":[{"title":"...","content":"...","date":"YYYY-MM-DD","tags":["..."],"importance":4,"sourceChronicleIds":["真实id"]}]}

[日记素材]
${material}
`, "chronicle:seeds");
  const parsed = stripJsonFence(result);
  const validIds = new Set(entries.map((entry) => entry.id));
  const rows = (Array.isArray(parsed?.seeds) ? parsed.seeds : []).map((seed: any) => ({
    title: String(seed?.title || "未命名回忆").trim().slice(0, 80),
    content: String(seed?.content || "").trim().slice(0, 700),
    date: String(seed?.date || "").trim().slice(0, 30),
    tags: Array.isArray(seed?.tags) ? seed.tags.map(String).filter(Boolean).slice(0, 5) : [],
    importance: Math.max(1, Math.min(5, Number(seed?.importance) || 4)),
    sourceChronicleIds: Array.isArray(seed?.sourceChronicleIds)
      ? seed.sourceChronicleIds.map(String).filter((id: string) => validIds.has(id)).slice(0, 8)
      : [],
  })).filter((seed: any) => seed.content.length >= 12);
  return addMemorySeeds(rows);
}

export function recentChronicles(days: 3 | 7 | 14): ChronicleEntry[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return listChronicles().filter((entry) => entry.createdAt >= since);
}
