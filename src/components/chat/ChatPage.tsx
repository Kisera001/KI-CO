import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Camera,
  Check,
  Copy,
  Database,
  Edit2,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type {
  CompanionAdapters,
  ConversationAttachment,
  ConversationMessage,
  ConversationRecord,
  UplinkSettings,
} from "../../types";
import type { AvatarPosition, PersonaProfile } from "../../storage/personaProfile";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  replaceConversationMessages,
} from "../../storage/conversations";
import { selectCacheFriendlyWindow } from "../../utils/contextWindow";
import { MarkdownText } from "../MarkdownText";

interface ChatPageProps {
  adapters: CompanionAdapters;
  uplinkSettings: UplinkSettings;
  personaProfile?: PersonaProfile;
  initialConversationId?: string;
  onClose?: () => void;
}

const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_MAX_LINES = 3;
const MAX_ATTACHMENTS = 4;
const MAX_FILE_SIZE_MB = 3;
const INITIAL_VISIBLE_MESSAGE_COUNT = 50;
const OLDER_MESSAGE_LOAD_STEP = 50;

interface MessageSearchHit {
  messageId: string;
  role: ConversationMessage["role"];
  createdAt: string;
  preview: string;
}

interface ConversationSearchGroup {
  conversation: ConversationRecord;
  hits: MessageSearchHit[];
  latestHitAt: number;
}

type PendingAttachment = ConversationAttachment;

function createEmptyWatchContext() {
  return {
    title: "Long conversation",
    currentTime: 0,
    duration: 0,
    sourceType: "local-file" as const,
    subtitleWindow: { previous: [], next: [] },
  };
}

function formatConversationDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSearchPreview(text: string, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return text.slice(0, 100);

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index < 0) return text.slice(0, 100);

  const start = Math.max(0, index - 34);
  const end = Math.min(text.length, index + query.length + 46);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function splitHighlightedText(text: string, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerQuery, cursor);

  while (index >= 0) {
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), match: false });
    }
    parts.push({ text: text.slice(index, index + query.length), match: true });
    cursor = index + query.length;
    index = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }

  return parts.length ? parts : [{ text, match: false }];
}

function createAttachmentId(prefix = "attachment") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function isTextLikeFile(file: File) {
  return /^text\//i.test(file.type)
    || /\.(txt|md|json|csv|log|js|jsx|ts|tsx|py|c|cpp|h|css|html|xml|yaml|yml)$/i.test(file.name);
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(String(reader.result ?? ""));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxSize = 768;
        let { width, height } = img;

        if (width > height && width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        } else if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }

        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));

        if (!ctx) {
          resolve(String(reader.result ?? ""));
          return;
        }

        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const qualities = [0.72, 0.62, 0.52];
        const targetBytes = 350 * 1024;
        let best = canvas.toDataURL("image/jpeg", qualities[0]);
        for (const quality of qualities) {
          const candidate = canvas.toDataURL("image/jpeg", quality);
          best = candidate;
          if (Math.ceil((candidate.length * 3) / 4) <= targetBytes) break;
        }
        resolve(best);
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function roleLabel(role: ConversationMessage["role"]) {
  return role === "user" ? "你" : "陪看伙伴";
}

function roleInitial(role: ConversationMessage["role"]) {
  return role === "user" ? "S" : "C";
}

function getInitial(name: string, fallback: string) {
  return name.trim().slice(0, 1).toUpperCase() || fallback;
}

function getAvatarImageStyle(position: AvatarPosition) {
  return {
    objectPosition: `${position.x}% ${position.y}%`,
    transformOrigin: `${position.x}% ${position.y}%`,
    transform: `scale(${position.scale})`,
  };
}

function MessageAvatar({
  role,
  personaProfile,
}: {
  role: ConversationMessage["role"];
  personaProfile?: PersonaProfile;
}) {
  const activePersona = personaProfile?.personas.find((persona) => persona.id === personaProfile.activePersonaId)
    || personaProfile?.personas[0];
  const isUser = role === "user";
  const image = isUser ? personaProfile?.userAvatarDataUrl : activePersona?.avatarDataUrl;
  const position = isUser ? personaProfile?.userAvatarPosition : activePersona?.avatarPosition;
  const name = isUser ? personaProfile?.userName : activePersona?.name;
  const fallback = isUser ? "U" : "C";

  return (
    <div className="cottage-message-avatar">
      {personaProfile?.showAvatars && image && position ? (
        <img
          src={image}
          alt=""
          style={getAvatarImageStyle(position)}
        />
      ) : (
        getInitial(name || "", roleInitial(role) || fallback)
      )}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function estimateMessageTokens(message: Pick<ConversationMessage, "text" | "attachments">) {
  const attachmentTokens = (message.attachments ?? []).reduce((sum, attachment) => {
    if (attachment.type === "image") return sum + 260;
    return sum + Math.ceil((attachment.text?.length || attachment.name.length) / 3);
  }, 0);
  return Math.max(1, Math.ceil((message.text || "").length / 3) + attachmentTokens);
}

function compactModelName(model = "") {
  return model.split("/").pop() || model || "unknown";
}

function cloneAttachments(attachments: ConversationAttachment[] = []) {
  return attachments.map((attachment) => ({ ...attachment }));
}

export function ChatPage({
  adapters,
  uplinkSettings,
  personaProfile,
  initialConversationId,
}: ChatPageProps) {
  const [conversations, setConversations] = useState<ConversationRecord[]>(() => {
    const stored = listConversations();
    return stored.length ? stored : [createConversation("新的对话")];
  });
  const [activeId, setActiveId] = useState(() => initialConversationId || conversations[0]?.id || "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [revealedSessionId, setRevealedSessionId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState("");
  const [visibleMessageCountByConversation, setVisibleMessageCountByConversation] = useState<Record<string, number>>({});
  const [pendingJumpMessageId, setPendingJumpMessageId] = useState("");
  const [highlightMessageId, setHighlightMessageId] = useState("");

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const attachAreaRef = useRef<HTMLDivElement>(null);
  const preserveScrollHeightRef = useRef<number | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || getConversation(activeId),
    [activeId, conversations],
  );
  const deleteTargetConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === deleteTargetId) || getConversation(deleteTargetId),
    [deleteTargetId, conversations],
  );

  const searchGroups = useMemo<ConversationSearchGroup[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return conversations
      .map((conversation) => {
        const hits = conversation.messages
          .filter((message) => message.text.toLowerCase().includes(query))
          .map<MessageSearchHit>((message) => ({
            messageId: message.id,
            role: message.role,
            createdAt: message.createdAt,
            preview: buildSearchPreview(message.text, searchQuery),
          }))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        if (!hits.length) return null;

        return {
          conversation,
          hits,
          latestHitAt: new Date(hits[0].createdAt).getTime(),
        };
      })
      .filter((group): group is ConversationSearchGroup => Boolean(group))
      .sort((a, b) => b.latestHitAt - a.latestHitAt);
  }, [conversations, searchQuery]);

  const totalSearchHitCount = useMemo(
    () => searchGroups.reduce((sum, group) => sum + group.hits.length, 0),
    [searchGroups],
  );

  const messages = activeConversation?.messages ?? [];
  const visibleMessageCount = visibleMessageCountByConversation[activeId] ?? INITIAL_VISIBLE_MESSAGE_COUNT;
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessageCount);
  const visibleMessages = hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages;

  useEffect(() => {
    if (!initialConversationId) return;
    setActiveId(initialConversationId);
    setConversations(listConversations());
  }, [initialConversationId]);

  useEffect(() => {
    setDraftTitle(activeConversation?.title || "");
  }, [activeConversation?.id, activeConversation?.title]);

  useLayoutEffect(() => {
    const previousHeight = preserveScrollHeightRef.current;
    const node = messageListRef.current;
    if (previousHeight === null || !node) return;
    const delta = node.scrollHeight - previousHeight;
    node.scrollTop += delta;
    preserveScrollHeightRef.current = null;
  }, [activeId, visibleMessageCount]);

  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    const node = messageListRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeId, isSending]);

  useEffect(() => {
    if (!pendingJumpMessageId) return;

    const timeout = window.setTimeout(() => {
      const target = messageRefs.current[pendingJumpMessageId];
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightMessageId(pendingJumpMessageId);
      setPendingJumpMessageId("");

      window.setTimeout(() => {
        setHighlightMessageId((current) => (current === pendingJumpMessageId ? "" : current));
      }, 1800);
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [pendingJumpMessageId, visibleMessages.length, visibleMessageCount, activeId]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    if (!showAttachmentMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && attachAreaRef.current?.contains(target)) return;
      setShowAttachmentMenu(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowAttachmentMenu(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showAttachmentMenu]);

  function resizeComposer(node = composerRef.current) {
    if (!node) return;
    const maxHeight = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES + 18;
    node.style.height = "0px";
    const nextHeight = Math.min(node.scrollHeight, maxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function refresh(nextActiveId = activeId) {
    const nextConversations = listConversations();
    setConversations(nextConversations);
    setActiveId(nextActiveId || nextConversations[0]?.id || "");
  }

  function handleSelectConversation(id: string) {
    setActiveId(id);
    setRevealedSessionId((current) => (current === id ? "" : id));
  }

  function handleJumpToMessage(conversationId: string, messageId: string) {
    const conversation = conversations.find((item) => item.id === conversationId) || getConversation(conversationId);
    if (!conversation) return;

    const targetIndex = conversation.messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return;

    const requiredVisibleCount = Math.min(
      conversation.messages.length,
      Math.max(INITIAL_VISIBLE_MESSAGE_COUNT, conversation.messages.length - targetIndex + 4),
    );

    skipNextAutoScrollRef.current = true;
    setActiveId(conversationId);
    setVisibleMessageCountByConversation((current) => ({
      ...current,
      [conversationId]: Math.max(current[conversationId] ?? 0, requiredVisibleCount),
    }));
    setPendingJumpMessageId(messageId);

    if (window.innerWidth < 760) {
      setSidebarOpen(false);
    }
  }

  function handleLoadOlderMessages() {
    if (!activeId || !messages.length) return;
    const node = messageListRef.current;
    preserveScrollHeightRef.current = node?.scrollHeight ?? null;
    skipNextAutoScrollRef.current = true;
    setVisibleMessageCountByConversation((current) => ({
      ...current,
      [activeId]: Math.min(messages.length, visibleMessageCount + OLDER_MESSAGE_LOAD_STEP),
    }));
  }

  function handleCreateConversation() {
    const next = createConversation("新的对话");
    refresh(next.id);
    setSidebarOpen(true);
  }

  function handleRename() {
    if (!activeConversation) return;
    const renamed = renameConversation(activeConversation.id, draftTitle);
    if (renamed) refresh(renamed.id);
  }

  function handleStartSessionRename(conversation: ConversationRecord) {
    setEditingSessionId(conversation.id);
    setEditingSessionTitle(conversation.title);
    setRevealedSessionId(conversation.id);
  }

  function handleSaveSessionRename(id: string) {
    const renamed = renameConversation(id, editingSessionTitle);
    setEditingSessionId("");
    setEditingSessionTitle("");
    if (renamed) refresh(renamed.id);
  }

  function handleDeleteConversation(id: string) {
    const conversation = getConversation(id);
    if (!conversation) return;

    deleteConversation(id);
    const remaining = listConversations();
    const next = remaining[0] || createConversation("新的对话");
    setDeleteTargetId("");
    setRevealedSessionId("");
    setEditingSessionId("");
    refresh(next.id);
  }

  function clearAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    event.target.value = "";
    if (!files.length) return;

    const remainingSlots = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remainingSlots <= 0) {
      setError(`最多同时携带 ${MAX_ATTACHMENTS} 张图片。`);
      return;
    }

    try {
      const selected = files.slice(0, remainingSlots);
      const attachments = await Promise.all(
        selected.map(async (file) => ({
          id: createAttachmentId("image"),
          type: "image" as const,
          name: file.name || "camera-image.jpg",
          mimeType: "image/jpeg",
          size: file.size,
          dataUrl: await compressImage(file),
        })),
      );
      setPendingAttachments((current) => [...current, ...attachments].slice(0, MAX_ATTACHMENTS));
      setShowAttachmentMenu(false);
    } catch (event) {
      setError(event instanceof Error ? event.message : "图片读取失败。");
    }
  }

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const remainingSlots = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remainingSlots <= 0) {
      setError(`最多同时携带 ${MAX_ATTACHMENTS} 个附件。`);
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots).filter((file) => {
      const isTooLarge = file.size > MAX_FILE_SIZE_MB * 1024 * 1024;
      if (isTooLarge) setError(`文件 ${file.name} 超过 ${MAX_FILE_SIZE_MB}MB，暂时没有附上。`);
      return !isTooLarge;
    });

    try {
      const attachments = await Promise.all(
        acceptedFiles.map(async (file) => ({
          id: createAttachmentId("file"),
          type: "file" as const,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          text: isTextLikeFile(file) ? await readFileAsText(file) : undefined,
          dataUrl: !isTextLikeFile(file) ? await fileToDataUrl(file) : undefined,
        })),
      );
      setPendingAttachments((current) => [...current, ...attachments].slice(0, MAX_ATTACHMENTS));
      setShowAttachmentMenu(false);
    } catch (event) {
      setError(event instanceof Error ? event.message : "文件读取失败。");
    }
  }

  async function requestCompanion(
    userText: string,
    baseMessages: ConversationMessage[],
    attachments: ConversationAttachment[] = [],
    onStreamUpdate?: (text: string) => void,
  ) {
    const [personaCore, userContext, memories] = await Promise.all([
      adapters.persona.getPersonaCore(),
      adapters.persona.getUserContext?.() ?? Promise.resolve(""),
      adapters.memory.retrieveRelevant(userText, uplinkSettings.contextLoad.memorySnippetLimit),
    ]);

    const recentMessages = selectCacheFriendlyWindow(baseMessages, uplinkSettings.contextLoad.shortTermMessageLimit)
      .map((message) => ({
        role: message.role,
        text: message.text,
        attachments: message.attachments,
      }));

    return adapters.llm.complete({
      mode: "chat",
      cacheScope: activeConversation ? `chat:${activeConversation.id}` : "chat:draft",
      userMessage: userText,
      attachments,
      personaCore,
      userContext,
      memories,
      recentMessages,
      onStreamUpdate,
      watch: createEmptyWatchContext(),
    });
  }

  async function submitUserMessage(
    rawText: string,
    rawAttachments: ConversationAttachment[],
    historyPrefix: ConversationMessage[],
    restoreDraftOnError = false,
  ) {
    const text = rawText.trim();
    const attachments = cloneAttachments(rawAttachments);
    if ((!text && !attachments.length) || !activeConversation || isSending) return;

    setIsSending(true);
    setError("");
    setEditingMessageId("");
    setEditingContent("");
    setShowAttachmentMenu(false);

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: text || "请看附件。",
      createdAt: new Date().toISOString(),
      attachments: attachments.length ? attachments : undefined,
      tokenCount: estimateMessageTokens({ text: text || "请看附件。", attachments }),
    };
    const companionMessage: ConversationMessage = {
      id: `companion-${Date.now()}`,
      role: "companion",
      text: "",
      createdAt: new Date().toISOString(),
    };
    const baseMessages = [...historyPrefix, userMessage];
    const optimisticMessages = [...baseMessages, companionMessage];
    replaceConversationMessages(activeConversation.id, optimisticMessages);
    refresh(activeConversation.id);

    try {
      const response = await requestCompanion(userMessage.text, baseMessages, attachments, (streamedText) => {
        replaceConversationMessages(activeConversation.id, [
          ...baseMessages,
          {
            ...companionMessage,
            text: streamedText,
            modelUsed: uplinkSettings.profiles[uplinkSettings.activeProvider]?.model,
            tokenCount: estimateMessageTokens({ text: streamedText }),
          },
        ]);
        refresh(activeConversation.id);
      });
      replaceConversationMessages(activeConversation.id, [
        ...baseMessages,
        {
          ...companionMessage,
          text: response.text,
          modelUsed: response.modelUsed || uplinkSettings.profiles[uplinkSettings.activeProvider]?.model,
          tokenCount: response.tokenCount || estimateMessageTokens({ text: response.text }),
        },
      ]);
      refresh(activeConversation.id);
    } catch (event) {
      replaceConversationMessages(activeConversation.id, historyPrefix);
      if (restoreDraftOnError) {
        setInput(rawText);
        setPendingAttachments(attachments);
      }
      setError(event instanceof Error ? event.message : "对话请求失败。");
      refresh(activeConversation.id);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSend() {
    if (!activeConversation) return;
    const text = input.trim();
    const attachments = pendingAttachments;
    setInput("");
    setPendingAttachments([]);
    await submitUserMessage(text, attachments, activeConversation.messages, true);
  }

  async function handleRegenerateFromMessage(messageId?: string) {
    if (!activeConversation || isSending) return;
    const messages = activeConversation.messages;
    const companionIndex = typeof messageId === "string"
      ? messages.findIndex((message) => message.id === messageId)
      : (() => {
        const indexFromEnd = [...messages].reverse().findIndex((message) => message.role === "companion");
        return indexFromEnd < 0 ? -1 : messages.length - 1 - indexFromEnd;
      })();
    if (companionIndex < 0) return;
    const userIndex = companionIndex - 1;
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== "user") return;
    await submitUserMessage(previousUser.text, previousUser.attachments ?? [], messages.slice(0, userIndex));
  }

  async function handleRegenerate() {
    await handleRegenerateFromMessage();
  }

  function handleStartEdit(message: ConversationMessage) {
    setEditingMessageId(message.id);
    setEditingContent(message.text);
  }

  async function handleSaveEdit(messageId: string) {
    if (!activeConversation || isSending) return;
    const messages = activeConversation.messages;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const originalMessage = messages[index];
    if (originalMessage.role !== "user") return;
    await submitUserMessage(editingContent, originalMessage.attachments ?? [], messages.slice(0, index));
  }

  async function handleCopy(message: ConversationMessage) {
    try {
      await copyText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(""), 1200);
    } catch {
      setError("复制失败，浏览器可能限制了剪贴板权限。");
    }
  }

  const metaShowName = uplinkSettings.visual.metaShowName ?? false;
  const metaShowTime = uplinkSettings.visual.metaShowTime ?? false;
  const metaShowDate = uplinkSettings.visual.metaShowDate ?? true;
  const metaShowModel = uplinkSettings.visual.metaShowModel ?? false;
  const metaShowTokens = uplinkSettings.visual.metaShowTokens ?? true;
  const showMessageHud = metaShowName || metaShowTime || metaShowDate || metaShowModel || metaShowTokens;

  return (
    <main
      className={`cottage-chat-shell ${sidebarOpen ? "has-sidebar" : ""}`}
      data-theme={uplinkSettings.visual.theme}
      data-font={uplinkSettings.visual.fontStyle}
      data-font-size={uplinkSettings.visual.fontSize}
    >
      <div className="cottage-chat-bg" aria-hidden="true" />

      {sidebarOpen && (
        <button
          type="button"
          className="cottage-chat-backdrop"
          aria-label="收起会话列表"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`cottage-chat-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="cottage-sidebar-title">
          <div>
            <p>ARCHIVES</p>
            <h1>长对话</h1>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} title="收起侧边栏">
            <PanelLeftClose size={17} />
          </button>
        </div>

        <div className="cottage-sidebar-actions">
          <button type="button" onClick={handleCreateConversation}>
            <Plus size={15} />
            新对话
          </button>
        </div>

        <div className="cottage-session-search">
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索对话内容..."
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} title="清空搜索">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="cottage-session-list">
          {searchQuery.trim() ? (
            <>
              <div className="cottage-search-summary">
                <strong>{totalSearchHitCount}</strong>
                <span>条匹配 · 按窗口和时间排序</span>
              </div>
              {searchGroups.map((group) => (
                <section key={group.conversation.id} className="cottage-search-group">
                  <button
                    type="button"
                    className="cottage-search-group-head"
                    onClick={() => handleSelectConversation(group.conversation.id)}
                  >
                    <strong>{group.conversation.title}</strong>
                    <span>{group.hits.length} 条 · {formatConversationDate(group.hits[0].createdAt)}</span>
                  </button>
                  <div className="cottage-search-hit-list">
                    {group.hits.map((hit) => (
                      <button
                        key={hit.messageId}
                        type="button"
                        className="cottage-search-hit"
                        onClick={() => handleJumpToMessage(group.conversation.id, hit.messageId)}
                      >
                        <span>
                          <strong>{hit.role === "user" ? "User" : "AI"}</strong>
                          <time>{formatConversationDate(hit.createdAt)}</time>
                        </span>
                        <p>
                          {splitHighlightedText(hit.preview, searchQuery).map((part, index) => (
                            part.match ? (
                              <mark key={`${hit.messageId}-${index}`}>{part.text}</mark>
                            ) : (
                              <span key={`${hit.messageId}-${index}`}>{part.text}</span>
                            )
                          ))}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!searchGroups.length && (
                <div className="cottage-session-empty">没有搜到相关消息</div>
              )}
            </>
          ) : (
            <>
              {conversations.map((conversation) => {
                const isEditingSession = editingSessionId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={`cottage-session-item ${conversation.id === activeId ? "active" : ""} ${revealedSessionId === conversation.id ? "show-actions" : ""}`}
                  >
                    {isEditingSession ? (
                      <input
                        className="cottage-session-rename-input"
                        value={editingSessionTitle}
                        autoFocus
                        onChange={(event) => setEditingSessionTitle(event.target.value)}
                        onBlur={() => handleSaveSessionRename(conversation.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setEditingSessionId("");
                            setEditingSessionTitle("");
                          }
                        }}
                        aria-label="重命名对话"
                      />
                    ) : (
                      <button
                        type="button"
                        className="cottage-session-main"
                        onClick={() => handleSelectConversation(conversation.id)}
                      >
                        <strong>{conversation.title}</strong>
                        <span>
                          {conversation.messages.length} 条 · {formatConversationDate(conversation.updatedAt)}
                        </span>
                      </button>
                    )}
                    <div className="cottage-session-actions">
                      <button type="button" onClick={() => handleStartSessionRename(conversation)} title="重命名">
                        <Edit2 size={13} />
                      </button>
                      <button type="button" onClick={() => setDeleteTargetId(conversation.id)} title="删除">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!conversations.length && (
                <div className="cottage-session-empty">还没有对话窗口</div>
              )}
            </>
          )}
        </div>
      </aside>

      <section className="cottage-chat-main">
        <header className="cottage-chat-hud">
          <button
            type="button"
            className="cottage-sidebar-toggle"
            onClick={() => setSidebarOpen((value) => !value)}
            title="展开会话列表"
          >
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>

          <div className="cottage-chat-title">
            <MessageCircle size={16} />
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={handleRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label="对话标题"
            />
          </div>

          <div className="cottage-chat-actions" aria-hidden="true" />
        </header>

        <div className="cottage-message-scroll" ref={messageListRef}>
          {!messages.length && (
            <div className="cottage-empty-chat">
              <Database size={30} />
              <strong>这里会保存长对话，也会承接每部片子的观影对话。</strong>
              <span>下一步接入轻量人格核和记忆库后，它会更像小屋里的连续窗口。</span>
            </div>
          )}

          {hiddenMessageCount > 0 && (
            <button type="button" className="cottage-load-older" onClick={handleLoadOlderMessages}>
              加载更早消息 · 还有 {hiddenMessageCount} 条
            </button>
          )}

          {visibleMessages.map((message) => (
            <article
              key={message.id}
              ref={(node) => {
                messageRefs.current[message.id] = node;
              }}
              className={`cottage-message-row ${message.role} ${
                isSending && message.role === "companion" && message.id === visibleMessages[visibleMessages.length - 1]?.id
                  ? "is-streaming"
                  : ""
              } ${highlightMessageId === message.id ? "search-highlight" : ""}`}
            >
              <MessageAvatar role={message.role} personaProfile={personaProfile} />
              <div className="cottage-message-stack">
                <div className={`cottage-message-card ${editingMessageId === message.id ? "is-editing" : ""}`}>
                  {!!message.attachments?.length && (
                    <div className="cottage-message-attachments">
                      {message.attachments.map((attachment) => (
                        attachment.type === "image" && attachment.dataUrl ? (
                          <img
                            key={attachment.id}
                            className="cottage-message-image"
                            src={attachment.dataUrl}
                            alt={attachment.name}
                          />
                        ) : (
                          <div key={attachment.id} className="cottage-message-file">
                            <FileText size={16} />
                            <span>{attachment.name}</span>
                            <small>{formatFileSize(attachment.size)}</small>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                  {editingMessageId === message.id ? (
                    <div className="cottage-edit-box">
                      <textarea
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                        rows={Math.min(6, Math.max(2, editingContent.split("\n").length))}
                      />
                      <div className="cottage-edit-actions">
                        <button type="button" onClick={() => void handleSaveEdit(message.id)} disabled={isSending}>
                          发送修改
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMessageId("");
                            setEditingContent("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MarkdownText text={message.text} />
                  )}
                </div>
                {showMessageHud && (
                  <div className="cottage-message-hud">
                    {metaShowName && <span>{roleLabel(message.role)}</span>}
                    {(metaShowDate || metaShowTime) && (
                      <time>
                        {new Date(message.createdAt).toLocaleString([], {
                          month: metaShowDate ? "2-digit" : undefined,
                          day: metaShowDate ? "2-digit" : undefined,
                          hour: metaShowTime ? "2-digit" : undefined,
                          minute: metaShowTime ? "2-digit" : undefined,
                        })}
                      </time>
                    )}
                    {metaShowModel && message.role === "companion" && (
                      <span>{compactModelName(message.modelUsed || uplinkSettings.profiles[uplinkSettings.activeProvider]?.model)}</span>
                    )}
                    {metaShowTokens && <span>TK:{message.tokenCount || estimateMessageTokens(message)}</span>}
                  </div>
                )}
                <div className="cottage-message-actions-bar">
                  <button type="button" onClick={() => handleCopy(message)} title={copiedId === message.id ? "已复制" : "复制"}>
                    {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
                    {copiedId === message.id && <span>已复制</span>}
                  </button>
                  {message.role === "user" ? (
                    <button type="button" onClick={() => handleStartEdit(message)} title="重新编辑">
                      <Edit2 size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRegenerateFromMessage(message.id)}
                      title="重新生成"
                      disabled={isSending}
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}

          {isSending && (
            <div className="cottage-thinking">
              <span>thinking</span>
              <span className="thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        <footer className="cottage-composer">
          {!!pendingAttachments.length && (
            <div className="cottage-attachment-tray">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.id} className="cottage-pending-attachment">
                  {attachment.type === "image" && attachment.dataUrl ? (
                    <img src={attachment.dataUrl} alt={attachment.name} />
                  ) : (
                    <div className="cottage-pending-file">
                      <FileText size={16} />
                      <span>{attachment.name}</span>
                      <small>{formatFileSize(attachment.size)}</small>
                    </div>
                  )}
                  <button
                    type="button"
                    className="cottage-attachment-remove"
                    onClick={() => clearAttachment(attachment.id)}
                    title="移除附件"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="cottage-composer-row">
            <div className="cottage-attach-area" ref={attachAreaRef}>
              <button
                type="button"
                className={`cottage-attach-trigger ${showAttachmentMenu ? "active" : ""}`}
                onClick={() => setShowAttachmentMenu((value) => !value)}
                title="添加附件"
              >
                <Plus size={18} />
              </button>

              {showAttachmentMenu && (
                <div className="cottage-attach-menu">
                  <button type="button" onClick={() => imageInputRef.current?.click()}>
                    <ImageIcon size={15} />
                    图片
                  </button>
                  <button type="button" onClick={() => cameraInputRef.current?.click()}>
                    <Camera size={15} />
                    拍照
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>
                    <FileText size={15} />
                    文件
                  </button>
                </div>
              )}

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleImageSelect}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={handleImageSelect}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv,.log,.js,.jsx,.ts,.tsx,.py,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml"
                multiple
                hidden
                onChange={handleFileSelect}
              />
            </div>

            <div className="cottage-input-wrap">
              <textarea
                ref={composerRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="想聊点什么？"
                rows={1}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                    && (event.ctrlKey || event.metaKey)
                    && !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
            </div>

            <button
              type="button"
              className="cottage-send-button"
              onClick={handleSend}
              disabled={isSending || (!input.trim() && !pendingAttachments.length)}
              title={isSending ? "发送中" : "发送"}
            >
              <Send size={17} />
            </button>
          </div>
        </footer>

        {error && (
          <button type="button" className="cottage-chat-error" onClick={() => setError("")}>
            {error}
          </button>
        )}
      </section>

      {deleteTargetConversation && (
        <div className="cottage-confirm-layer" role="dialog" aria-modal="true" aria-label="确认删除对话">
          <button type="button" className="cottage-confirm-backdrop" onClick={() => setDeleteTargetId("")} aria-label="取消删除" />
          <div className="cottage-confirm-card">
            <strong>删除这个对话窗口？</strong>
            <p>「{deleteTargetConversation.title}」将从本地删除，这个操作无法恢复。</p>
            <div className="cottage-confirm-actions">
              <button type="button" onClick={() => setDeleteTargetId("")}>
                取消
              </button>
              <button type="button" className="danger" onClick={() => handleDeleteConversation(deleteTargetConversation.id)}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
