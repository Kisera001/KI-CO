const MEMORY_HINT_PATTERN = new RegExp([
  "还记得", "记得吗", "记不记得", "之前", "以前", "上次", "那次", "刚才", "我们说过", "你说过", "我说过",
  "暗号", "锚点", "人格核", "记忆", "回忆", "状态卡", "生活线", "日记", "长期记忆", "小屋", "开源", "项目", "客户", "合同",
  "prompt", "RAG", "cache", "缓存", "API", "模型", "窗口", "搬家", "同步", "迁移",
  "remember", "memory", "previous", "last time", "earlier", "project", "persona", "anchor", "context", "window", "migration",
].join("|"), "i");

const QUESTION_PATTERN = /[?？]|^(为什么|怎么|咋|如何|能不能|可不可以|是不是|要不要|怎么办|which|what|why|how|can|should)\b/i;

// 这些输入通常只是承接、回应或亲昵小动作，不值得为它们单独触发 RAG / embedding。
// 这里匹配的是“去掉标点、emoji、颜文字符号后的规范文本”。
const LOW_SIGNAL_CANONICAL_SET = new Set([
  "嗯", "嗯嗯", "嗯呐", "嗯哼", "唔", "唔唔",
  "哦", "哦哦", "噢", "噢噢", "喔", "喔喔",
  "啊", "啊啊", "诶", "欸", "呃", "额",
  "哈哈", "哈哈哈", "哈哈哈哈", "嘿嘿", "嘿嘿嘿", "嘻嘻", "嘻嘻嘻",
  "hh", "hhh", "hhhh", "haha", "hahaha", "lol", "233", "2333",
  "好", "好的", "好呀", "好哒", "好滴", "好嘞", "行", "可以", "可",
  "收到", "明白", "知道了", "ok", "okay", "yes", "no",
  "继续", "接着", "然后呢", "来吧", "开始吧", "下一步", "再来", "走起",
  "我来了", "来了", "在", "在呢", "冒泡", "早安", "晚安", "辛苦了",
  "亲亲", "亲一口", "抱抱", "抱一下", "贴贴", "摸摸", "啵", "啵啵",
]);

const LOW_SIGNAL_CANONICAL_PATTERNS = [
  /^嗯+$/,
  /^唔+$/,
  /^[哦噢喔]+$/,
  /^[啊诶欸呃额]+$/,
  /^哈{2,}$/,
  /^嘿{2,}$/,
  /^嘻{2,}$/,
  /^h{2,}$/i,
  /^ha(ha)+$/i,
  /^233+$/,
];

function normalizeRecallText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripKaomojiNoise(text: string) {
  return text
    // 去掉常见纯颜文字括号，如 (づ￣3￣)づ / （づ￣3￣）づ；如果括号里有中文或拉丁词，保留。
    .replace(/[（(]([^（）()]*)[）)]/g, (match, inner: string) => /[\p{Script=Han}A-Za-z]/u.test(inner) ? match : "")
    // 去掉颜文字里常见的手势假名残片，避免“亲一口(づ￣3￣)づ”被误判为有效长文本。
    .replace(/[づっツｯノﾉ]/g, "");
}

function canonicalizeLowSignalText(text: string) {
  return stripKaomojiNoise(normalizeRecallText(text))
    .toLowerCase()
    .replace(/[\p{M}\p{P}\p{S}\s]/gu, "")
    .trim();
}

function roughMeaningfulLength(text: string) {
  return canonicalizeLowSignalText(text).length;
}

function isLowSignalText(text: string) {
  const canonical = canonicalizeLowSignalText(text);
  if (!canonical) return true;
  if (LOW_SIGNAL_CANONICAL_SET.has(canonical)) return true;
  return LOW_SIGNAL_CANONICAL_PATTERNS.some((pattern) => pattern.test(canonical));
}

export interface MemoryRecallGateOptions {
  force?: boolean;
  hasAttachments?: boolean;
}

export function shouldRetrieveMemory(query: string, options: MemoryRecallGateOptions = {}) {
  if (options.force) return true;

  const normalized = normalizeRecallText(query);
  if (!normalized) return false;

  if (MEMORY_HINT_PATTERN.test(normalized)) return true;

  const meaningfulLength = roughMeaningfulLength(normalized);
  const isLowSignal = isLowSignalText(normalized);
  if (isLowSignal && meaningfulLength <= 12) return false;

  if (QUESTION_PATTERN.test(normalized) && meaningfulLength >= 8) return true;

  // 附件可能包含新的上下文，但只在用户文字也有一定信息量时才触发记忆召回。
  // 纯附件/短寒暄不强行 RAG，避免远程 embedding 被低语义输入消耗。
  if (options.hasAttachments && meaningfulLength >= 8) return true;

  // 普通聊天里，足够长的输入通常包含可检索意图。
  if (meaningfulLength >= 16) return true;

  // 多个词组成的短句，如“状态卡 缓存”或“电影 镜头”，也保留召回机会。
  const wordLikeParts = normalized.split(/[\s，,。.!！?？、/\\|]+/).filter((part) => roughMeaningfulLength(part) >= 2);
  return wordLikeParts.length >= 3;
}
