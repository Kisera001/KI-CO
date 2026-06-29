import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Camera,
  Check,
  Copy,
  Database,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  Upload,
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
  importConversationRecords,
  inspectConversationImport,
  listConversations,
  renameConversation,
  replaceConversationMessages,
} from "../../storage/conversations";
import { selectCacheFriendlyWindow } from "../../utils/contextWindow";
import { shouldRetrieveMemory } from "../../utils/memoryRecallGate";
import { buildTimeAwarenessContext } from "../../utils/timeAwareness";
import { MarkdownText } from "../MarkdownText";
import { getChronicleWriteIntent, getContinuityContext, maybeWriteChronicleAfterTurn } from "../../services/chronicleService";
import { getChroniclePreferences } from "../../storage/chronicles";
import {
  captureWindowHandoff,
  clearSessionStateCard,
  getSessionStateCard,
  getWindowHandoff,
  markWindowHandoffUsed,
  patchSessionStateCard,
  queueSessionStateCardUpdate,
  subscribeSessionContinuity,
} from "../../services/sessionStateService";

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
const CONVERSATION_DRAFT_STORAGE_KEY = "kico_conversation_drafts_v1";
const ACTIVE_CONVERSATION_STORAGE_KEY = "kico_active_conversation_v1";
const STATE_CARD_REFRESH_TIMEOUT_MS = 45000;

function StateCardGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="3.05" y="2.15" width="7.9" height="9.7" rx="0.95" stroke="var(--kx-primary, #dcbda8)" strokeWidth="1.02" transform="rotate(-15 7 7)" fill="none" />
      <path d="M7 3.55C7.1 5.55 8.45 6.9 10.45 7C8.45 7.1 7.1 8.45 7 10.45C6.9 8.45 5.55 7.1 3.55 7C5.55 6.9 6.9 5.55 7 3.55Z" fill="var(--kx-primary-soft, #a694bc)" />
      <line x1="1.15" y1="12.85" x2="12.85" y2="1.15" stroke="var(--kx-primary, #dcbda8)" strokeWidth="0.62" opacity="0.34" />
    </svg>
  );
}

function NewWindowGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="var(--kx-primary, #dcbda8)" strokeWidth="0.85" fill="none" />
      <line x1="7" y1="1" x2="7" y2="13" stroke="var(--kx-primary, #dcbda8)" strokeWidth="0.5" opacity="0.6" />
      <line x1="1" y1="7" x2="13" y2="7" stroke="var(--kx-primary, #dcbda8)" strokeWidth="0.5" opacity="0.6" />
      <path d="M7 1C7 4.3 9.3 6.5 12.5 7C9.3 7.5 7 9.7 7 13C7 9.7 4.7 7.5 1.5 7C4.7 6.5 7 4.3 7 1Z" fill="var(--kx-primary-soft, #a694bc)" />
      <circle cx="7" cy="7" r="1" fill="#fff" />
    </svg>
  );
}

interface MessageSearchHit {
  id: string;
  messageId?: string;
  roleLabel: string;
  createdAt: string;
  preview: string;
}

interface ConversationSearchGroup {
  conversation: ConversationRecord;
  hits: MessageSearchHit[];
  hitCount: number;
  isWatchConversation: boolean;
  lastModifiedAt: number;
  preview: string;
}

function readConversationDrafts(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CONVERSATION_DRAFT_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeConversationDrafts(drafts: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CONVERSATION_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.warn("Failed to persist conversation drafts", error);
  }
}

function readActiveConversationId(conversations: ConversationRecord[]) {
  if (typeof localStorage === "undefined") return "";
  try {
    const id = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) || "";
    return conversations.some((conversation) => conversation.id === id) ? id : "";
  } catch {
    return "";
  }
}

function persistActiveConversationId(conversationId: string) {
  if (typeof localStorage === "undefined" || !conversationId) return;
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
  } catch (error) {
    console.warn("Failed to persist active conversation", error);
  }
}

function readConversationDraft(conversationId: string) {
  return readConversationDrafts()[conversationId] || "";
}

function persistConversationDraft(conversationId: string, draft: string) {
  if (!conversationId) return;
  const drafts = readConversationDrafts();
  if (draft.trim()) drafts[conversationId] = draft;
  else delete drafts[conversationId];
  writeConversationDrafts(drafts);
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
  const source = text.replace(/\s+/g, " ").trim();
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return source.slice(0, 100);

  const lowerText = source.toLowerCase();
  const firstMatch = terms
    .map((term) => ({ term, index: lowerText.indexOf(term) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  if (!firstMatch) return source.slice(0, 100);

  const start = Math.max(0, firstMatch.index - 34);
  const end = Math.min(source.length, firstMatch.index + firstMatch.term.length + 46);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function splitHighlightedText(text: string, rawQuery: string) {
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const nextMatch = terms
      .map((term) => ({ term, index: lowerText.indexOf(term, cursor) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index || b.term.length - a.term.length)[0];
    if (!nextMatch) break;
    const { index, term } = nextMatch;
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), match: false });
    }
    parts.push({ text: text.slice(index, index + term.length), match: true });
    cursor = index + term.length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }

  return parts.length ? parts : [{ text, match: false }];
}

function roleSearchLabel(role: ConversationMessage["role"]) {
  if (role === "user") return "User";
  if (role === "companion") return "AI";
  return "系统";
}

function isWatchConversation(conversation: ConversationRecord) {
  const title = conversation.title || "";
  return Boolean(
    conversation.linkedWatchTitle
    || conversation.linkedWatchRecordId
    || title.includes("观影")
    || title.toLowerCase().includes("cinema"),
  );
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

function getConversationSortTime(conversation: ConversationRecord) {
  const createdAt = new Date(conversation.createdAt).getTime();
  if (Number.isFinite(createdAt)) return createdAt;
  const updatedAt = new Date(conversation.updatedAt).getTime();
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}

function getConversationPreview(conversation: ConversationRecord) {
  const lastText = [...conversation.messages]
    .reverse()
    .map((message) => String(message.text || "").replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (lastText) return lastText;
  return conversation.messages.length ? "这条消息暂时没有文本预览" : "还没有消息";
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
  const activePersona = personaProfile?.personas.find((persona) => persona.id === personaProfile.activePersonaId)
    || personaProfile?.personas[0];
  const [conversations, setConversations] = useState<ConversationRecord[]>(() => {
    const stored = listConversations();
    return stored.length ? stored : [createConversation("新的对话")];
  });
  const [activeId, setActiveId] = useState(() => initialConversationId || readActiveConversationId(conversations) || conversations[0]?.id || "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [input, setInput] = useState(() => readConversationDraft(activeId));
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
  const [chronicleWriteState, setChronicleWriteState] = useState<{
    messageId: string;
    phase: "writing" | "done" | "error";
    text: string;
  } | null>(null);
  const [stateCardVersion, setStateCardVersion] = useState(0);
  const [showStateCardEditor, setShowStateCardEditor] = useState(false);
  const [stateCardDraft, setStateCardDraft] = useState("");
  const [stateCardBusy, setStateCardBusy] = useState(false);
  const [stateCardNotice, setStateCardNotice] = useState("");
  const [newWindowPanelOpen, setNewWindowPanelOpen] = useState(false);
  const [newWindowSourceId, setNewWindowSourceId] = useState(activeId);
  const [newWindowOptions, setNewWindowOptions] = useState({
    continuity: true,
    stateCard: true,
    context: false,
  });

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const attachAreaRef = useRef<HTMLDivElement>(null);
  const preserveScrollHeightRef = useRef<number | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionImportInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const draftByConversationRef = useRef<Record<string, string>>(readConversationDrafts());
  const previousActiveIdRef = useRef(activeId);
  const shouldAutoFollowScrollRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || getConversation(activeId),
    [activeId, conversations],
  );
  const stateCard = useMemo(
    () => getSessionStateCard(activeId),
    [activeId, stateCardVersion],
  );
  const effectiveHistoryDepth = activePersona?.contextDepth && activePersona.contextDepth > 0
    ? activePersona.contextDepth
    : uplinkSettings.contextLoad.shortTermMessageLimit;
  const deleteTargetConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === deleteTargetId) || getConversation(deleteTargetId),
    [deleteTargetId, conversations],
  );

  const searchGroups = useMemo<ConversationSearchGroup[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    if (!terms.length) return [];

    const matchesTerms = (value: string) => {
      const lower = value.toLowerCase();
      return terms.every((term) => lower.includes(term));
    };

    return conversations
      .map((conversation) => {
        const hits: MessageSearchHit[] = [];
        const titleText = `${conversation.title || ""} ${conversation.linkedWatchTitle || ""}`;

        if (matchesTerms(titleText)) {
          hits.push({
            id: `${conversation.id}-title`,
            roleLabel: isWatchConversation(conversation) ? "观影" : "窗口",
            createdAt: conversation.updatedAt,
            preview: buildSearchPreview(titleText, searchQuery),
          });
        }

        conversation.messages.forEach((message) => {
          if (!matchesTerms(message.text)) return;
          hits.push({
            id: `${conversation.id}-${message.id}`,
            messageId: message.id,
            roleLabel: roleSearchLabel(message.role),
            createdAt: message.createdAt,
            preview: buildSearchPreview(message.text, searchQuery),
          });
        });

        hits.sort((a, b) => {
          const aIsMessage = a.messageId ? 1 : 0;
          const bIsMessage = b.messageId ? 1 : 0;
          if (aIsMessage !== bIsMessage) return aIsMessage - bIsMessage;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        if (!hits.length) return null;

        return {
          conversation,
          hits,
          hitCount: hits.length,
          isWatchConversation: isWatchConversation(conversation),
          lastModifiedAt: new Date(conversation.updatedAt || hits[hits.length - 1].createdAt).getTime(),
          preview: hits[0]?.preview || conversation.messages.at(-1)?.text || "",
        };
      })
      .filter((group): group is ConversationSearchGroup => Boolean(group))
      .sort((a, b) => {
        if (a.isWatchConversation !== b.isWatchConversation) return a.isWatchConversation ? 1 : -1;
        return b.lastModifiedAt - a.lastModifiedAt;
      });
  }, [conversations, searchQuery]);

  const totalSearchHitCount = useMemo(
    () => searchGroups.reduce((sum, group) => sum + group.hitCount, 0),
    [searchGroups],
  );

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => getConversationSortTime(b) - getConversationSortTime(a)),
    [conversations],
  );

  const dailyConversations = useMemo(
    () => sortedConversations.filter((conversation) => !isWatchConversation(conversation)),
    [sortedConversations],
  );

  const watchConversations = useMemo(
    () => sortedConversations.filter(isWatchConversation),
    [sortedConversations],
  );

  const recentWindowSources = useMemo(() => {
    const unique = new Map<string, ConversationRecord>();
    if (activeConversation) unique.set(activeConversation.id, activeConversation);
    sortedConversations.forEach((conversation) => {
      if (unique.size < 3) unique.set(conversation.id, conversation);
    });
    return Array.from(unique.values()).slice(0, 3);
  }, [activeConversation, sortedConversations]);

  const selectedNewWindowSource = useMemo(
    () => recentWindowSources.find((conversation) => conversation.id === newWindowSourceId) || recentWindowSources[0],
    [newWindowSourceId, recentWindowSources],
  );

  const selectedSourceStateCard = useMemo(
    () => getSessionStateCard(selectedNewWindowSource?.id),
    [selectedNewWindowSource?.id, stateCardVersion],
  );

  const hasContinuityLineForNewWindow = Boolean(getContinuityContext(personaProfile?.userName || "User").trim());
  const hasStateCardForNewWindow = Boolean(selectedSourceStateCard?.content.trim());
  const hasRecentContextForNewWindow = Boolean(selectedNewWindowSource?.messages.length);

  const messages = activeConversation?.messages ?? [];
  const visibleMessageCount = visibleMessageCountByConversation[activeId] ?? INITIAL_VISIBLE_MESSAGE_COUNT;
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessageCount);
  const visibleMessages = hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages;

  useEffect(() => {
    if (!initialConversationId) return;
    setActiveId(initialConversationId);
    setInput(draftByConversationRef.current[initialConversationId] ?? readConversationDraft(initialConversationId));
    setConversations(listConversations());
  }, [initialConversationId]);

  useEffect(() => {
    if (activeId) persistActiveConversationId(activeId);
  }, [activeId]);

  useEffect(() => {
    if (!activeId || previousActiveIdRef.current === activeId) return;
    previousActiveIdRef.current = activeId;
    setInput(draftByConversationRef.current[activeId] ?? readConversationDraft(activeId));
  }, [activeId]);

  useEffect(() => subscribeSessionContinuity(() => setStateCardVersion((value) => value + 1)), []);

  useEffect(() => {
    setStateCardDraft(stateCard?.content || "");
  }, [stateCard?.content, stateCard?.sessionId]);

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
    scrollMessagesToBottom("smooth");
  }, [messages, activeId, isSending]);

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
    if (!activeId) return;
    draftByConversationRef.current[activeId] = input;
    persistConversationDraft(activeId, input);
  }, [activeId, input]);

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

  function isNearMessageScrollBottom(threshold = 90) {
    const node = messageListRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth", force = false, retries = 2) {
    const node = messageListRef.current;
    if (!node) return;
    if (!force && !shouldAutoFollowScrollRef.current && !isNearMessageScrollBottom()) return;

    programmaticScrollUntilRef.current = Date.now() + (behavior === "smooth" ? 520 : 180);
    node.scrollTo({ top: node.scrollHeight, behavior });

    if (retries > 0) {
      window.setTimeout(() => {
        if (force || shouldAutoFollowScrollRef.current || isNearMessageScrollBottom()) {
          scrollMessagesToBottom("auto", force, retries - 1);
        }
      }, 90);
    }
  }

  function handleMessageScroll() {
    if (isNearMessageScrollBottom()) {
      shouldAutoFollowScrollRef.current = true;
      return;
    }
    if (Date.now() > programmaticScrollUntilRef.current) {
      shouldAutoFollowScrollRef.current = false;
    }
  }

  function handleSelectConversation(id: string) {
    if (activeId) {
      draftByConversationRef.current[activeId] = input;
      persistConversationDraft(activeId, input);
    }
    shouldAutoFollowScrollRef.current = true;
    const nextDraft = draftByConversationRef.current[id] ?? readConversationDraft(id);
    setInput(nextDraft || "");
    setActiveId(id);
    setRevealedSessionId((current) => (current === id ? "" : id));
    setSidebarOpen(false);
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
    if (activeId) {
      draftByConversationRef.current[activeId] = input;
      persistConversationDraft(activeId, input);
    }
    const nextDraft = draftByConversationRef.current[conversationId] ?? readConversationDraft(conversationId);
    setInput(nextDraft || "");
    setActiveId(conversationId);
    setVisibleMessageCountByConversation((current) => ({
      ...current,
      [conversationId]: Math.max(current[conversationId] ?? 0, requiredVisibleCount),
    }));
    setPendingJumpMessageId(messageId);
    setSidebarOpen(false);
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

  function makeRecentContext(conversation?: ConversationRecord) {
    if (!conversation) return "";
    return selectCacheFriendlyWindow(conversation.messages, uplinkSettings.contextLoad.shortTermMessageLimit)
      .map((message) => `${message.role === "user" ? "User" : "AI"}：${message.text}`)
      .join("\n")
      .slice(0, 900);
  }

  function createConversationWithContinuity(options = newWindowOptions, sourceOverride?: ConversationRecord) {
    if (activeId) {
      draftByConversationRef.current[activeId] = input;
      persistConversationDraft(activeId, input);
    }
    const next = createConversation("新的对话");
    const source = sourceOverride || selectedNewWindowSource || activeConversation;
    if (source) {
      captureWindowHandoff(source.id, next.id, {
        includeContinuityLine: options.continuity,
        includeStateCard: options.stateCard,
        recentContext: options.context ? makeRecentContext(source) : "",
      });
    }
    delete draftByConversationRef.current[next.id];
    persistConversationDraft(next.id, "");
    setInput("");
    setNewWindowPanelOpen(false);
    refresh(next.id);
    setSidebarOpen(true);
  }

  function handleCreateConversation() {
    const source = activeConversation || recentWindowSources[0];
    const stateCard = source ? getSessionStateCard(source.id) : null;
    createConversationWithContinuity({
      continuity: hasContinuityLineForNewWindow,
      stateCard: Boolean(stateCard?.content.trim()),
      context: false,
    }, source);
  }

  function openNewWindowOptionsPanel() {
    setNewWindowSourceId(activeId || recentWindowSources[0]?.id || "");
    setNewWindowOptions({
      continuity: hasContinuityLineForNewWindow,
      stateCard: hasStateCardForNewWindow,
      context: false,
    });
    setNewWindowPanelOpen(true);
  }

  function handleSelectNewWindowSource(conversation: ConversationRecord) {
    const nextStateCard = getSessionStateCard(conversation.id);
    const nextHasStateCard = Boolean(nextStateCard?.content.trim());
    const nextHasContext = Boolean(conversation.messages.length);
    setNewWindowSourceId(conversation.id);
    setNewWindowOptions((current) => ({
      continuity: hasContinuityLineForNewWindow ? current.continuity : false,
      stateCard: nextHasStateCard ? current.stateCard || !hasStateCardForNewWindow : false,
      context: nextHasContext ? current.context : false,
    }));
  }

  function handleExportConversation() {
    if (!activeConversation) return;
    const blob = new Blob([JSON.stringify(activeConversation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (activeConversation.title || "conversation").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
    link.href = url;
    link.download = `ki-co-chat-${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleImportConversation(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const incoming: ConversationRecord[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.conversations)
          ? payload.conversations
          : payload?.id && Array.isArray(payload?.messages)
            ? [payload]
            : [];
      if (!incoming.length) throw new Error("文件里没有可识别的对话窗口。");
      const inspection = inspectConversationImport(incoming);
      let conflictMode: "merge" | "copy" = "copy";
      if (inspection.divergentSameId > 0) {
        conflictMode = window.confirm(
          `检测到 ${inspection.divergentSameId} 个同 ID 但内容不同的窗口。\n\n确定：合并并按消息 ID 去重\n取消：保留为导入副本`,
        ) ? "merge" : "copy";
      }
      const report = importConversationRecords(incoming, conflictMode);
      const targetId = report.idMap[incoming[0].id] || listConversations()[0]?.id;
      refresh(targetId || activeId);
      if (window.innerWidth < 760) setSidebarOpen(false);
    } catch (event) {
      setError(event instanceof Error ? `导入失败：${event.message}` : "导入失败，请检查 JSON 文件。");
    }
  }

  async function handleRefreshStateCard() {
    if (!activeConversation || !personaProfile || stateCardBusy) return;
    setStateCardBusy(true);
    setStateCardNotice("更新中...");
    try {
      const updateTask = queueSessionStateCardUpdate(adapters.llm, personaProfile, activeConversation, effectiveHistoryDepth, "", true);
      const timeoutTask = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("状态卡刷新超时，请检查模型连接。")), STATE_CARD_REFRESH_TIMEOUT_MS);
      });
      const updated = await Promise.race([updateTask, timeoutTask]);
      setStateCardDraft(updated?.content || getSessionStateCard(activeConversation.id)?.content || "");
      setStateCardNotice(updated ? "已更新" : `暂无可写入内容：只整理最近 ${effectiveHistoryDepth} 条原文之前的对话`);
      window.setTimeout(() => setStateCardNotice(""), updated ? 2500 : 4200);
    } catch (event) {
      const message = event instanceof Error ? event.message : "状态卡更新失败。";
      setStateCardNotice(`更新失败：${message.slice(0, 42)}`);
      setError(message);
      window.setTimeout(() => setStateCardNotice(""), 7000);
    } finally {
      setStateCardBusy(false);
    }
  }

  function handleSaveStateCard() {
    if (!activeId) return;
    patchSessionStateCard(activeId, { content: stateCardDraft.trim() });
    setShowStateCardEditor(false);
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
    signal?: AbortSignal,
  ) {
    const chroniclePreferences = getChroniclePreferences();
    const shouldRecallMemory = chroniclePreferences.enableMemoryRecall
      && shouldRetrieveMemory(userText, { hasAttachments: attachments.length > 0 });

    const [personaCore, userContext, memories] = await Promise.all([
      adapters.persona.getPersonaCore(),
      adapters.persona.getUserContext?.() ?? Promise.resolve(""),
      shouldRecallMemory
        ? adapters.memory.retrieveRelevant(userText, uplinkSettings.contextLoad.memorySnippetLimit)
        : Promise.resolve([]),
    ]);
    const handoff = getWindowHandoff(activeConversation?.id);
    const continuityContext = handoff?.includeContinuityLine === false
      ? ""
      : getContinuityContext(personaProfile?.userName || "User");
    const currentStateCard = getSessionStateCard(activeConversation?.id);
    const stateCardContext = currentStateCard?.enabled && currentStateCard.visibleToPersona && currentStateCard.content.trim()
      ? `这是一张当前窗口的共同便签，不是审讯记录，也不是必须复刻的脚本。

它只帮助你带着当前窗口的主线自然往下说；如果使用者此刻表达了新的事实、情绪或方向，请以当下为准。

如果状态卡与当前对话发生冲突，优先听使用者此刻正在说的话，而不是顺着状态卡。

状态卡可能包含上一阶段的玩笑、未完线索或情绪背景，请只在自然相关时轻轻带过，不要主动复述整张卡。

状态卡只作为内部背景。正式回复中不要输出、改写或追加状态卡内容，也不要出现 [SESSION STATE CARD UPDATE] / 状态卡更新 / Now / Note / Known / Mood / Maybe / Anchor 这类内部标记。

${currentStateCard.content.trim()}`
      : "";
    const handoffContext = handoff?.content.trim()
      ? `这是上一窗口刚刚聊到的位置，只在这次接续时参考：\n${handoff.content}`
      : "";
    const assembledUserContext = [userContext, continuityContext, stateCardContext, handoffContext].filter(Boolean).join("\n\n");
    const dynamicContext = buildTimeAwarenessContext(uplinkSettings);

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
      userContext: assembledUserContext,
      dynamicContext,
      memories,
      recentMessages,
      onStreamUpdate,
      signal,
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

    shouldAutoFollowScrollRef.current = true;
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

    let latestStreamedText = "";
    const abortController = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = abortController;

    try {
      const response = await requestCompanion(userMessage.text, baseMessages, attachments, (streamedText) => {
        latestStreamedText = streamedText;
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
      }, abortController.signal);
      const completedMessages = [
        ...baseMessages,
        {
          ...companionMessage,
          text: response.text,
          modelUsed: response.modelUsed || uplinkSettings.profiles[uplinkSettings.activeProvider]?.model,
          tokenCount: response.tokenCount || estimateMessageTokens({ text: response.text }),
        },
      ];
      replaceConversationMessages(activeConversation.id, completedMessages);
      refresh(activeConversation.id);
      markWindowHandoffUsed(activeConversation.id);
      if (personaProfile) {
        const completedConversation: ConversationRecord = {
          ...activeConversation,
          messages: completedMessages,
          updatedAt: new Date().toISOString(),
        };
        const chronicleIntent = getChronicleWriteIntent(completedConversation, userMessage.text);
        let chronicleTask: Promise<unknown> = Promise.resolve(null);
        if (chronicleIntent) {
          setChronicleWriteState({ messageId: companionMessage.id, phase: "writing", text: "正在写入记忆之页..." });
          chronicleTask = maybeWriteChronicleAfterTurn(adapters.llm, personaProfile, completedConversation, userMessage.text);
          void chronicleTask
            .then((entry) => {
              setChronicleWriteState({
                messageId: companionMessage.id,
                phase: "done",
                text: entry ? "已写入时光回廊" : "暂未写入，后续会重试",
              });
              window.setTimeout(() => setChronicleWriteState((current) => current?.messageId === companionMessage.id ? null : current), 3500);
            })
            .catch((event) => {
              const message = event instanceof Error ? event.message : "未知错误";
              setChronicleWriteState({ messageId: companionMessage.id, phase: "error", text: `写入失败：${message}` });
              window.setTimeout(() => setChronicleWriteState((current) => current?.messageId === companionMessage.id ? null : current), 5000);
            });
        }
        void chronicleTask.catch(() => null)
          .then(() => queueSessionStateCardUpdate(adapters.llm, personaProfile, completedConversation, effectiveHistoryDepth, userMessage.text))
          .catch((event) => console.warn("[Session state] automatic update skipped:", event));
      }
    } catch (event) {
      const aborted = event instanceof DOMException && event.name === "AbortError";
      if (aborted) {
        replaceConversationMessages(activeConversation.id, [
          ...baseMessages,
          {
            ...companionMessage,
            text: latestStreamedText.trim() || "[已手动中止]",
            modelUsed: uplinkSettings.profiles[uplinkSettings.activeProvider]?.model,
            tokenCount: estimateMessageTokens({ text: latestStreamedText.trim() || "[已手动中止]" }),
          },
        ]);
      } else if (latestStreamedText.trim()) {
        replaceConversationMessages(activeConversation.id, [
          ...baseMessages,
          {
            ...companionMessage,
            text: latestStreamedText,
            modelUsed: uplinkSettings.profiles[uplinkSettings.activeProvider]?.model,
            tokenCount: estimateMessageTokens({ text: latestStreamedText }),
          },
        ]);
      } else {
        replaceConversationMessages(activeConversation.id, historyPrefix);
      }
      if (restoreDraftOnError && !latestStreamedText.trim()) {
        setInput(rawText);
        setPendingAttachments(attachments);
      }
      if (!aborted) setError(event instanceof Error ? event.message : "对话请求失败。");
      refresh(activeConversation.id);
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  async function handleSend() {
    if (!activeConversation) return;
    const text = input.trim();
    const attachments = pendingAttachments;
    setInput("");
    delete draftByConversationRef.current[activeConversation.id];
    persistConversationDraft(activeConversation.id, "");
    setPendingAttachments([]);
    await submitUserMessage(text, attachments, activeConversation.messages, true);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
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

  function renderConversationItem(conversation: ConversationRecord) {
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
            <small>{getConversationPreview(conversation)}</small>
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
          <button type="button" className="cottage-new-session-button" onClick={handleCreateConversation}>
            <Plus size={15} />
            新对话
          </button>
          <button type="button" className="cottage-new-session-options-button" onClick={openNewWindowOptionsPanel} title="接续选项" aria-label="接续选项">
            <NewWindowGlyph size={16} />
          </button>
          <button type="button" className="cottage-import-session-button" onClick={() => sessionImportInputRef.current?.click()} title="导入对话">
            <Upload size={15} />
            <span>导入</span>
          </button>
          <input ref={sessionImportInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportConversation} />
        </div>

        {newWindowPanelOpen && (
          <div className="cottage-new-window-panel-layer">
          <section className="cottage-confirm-dialog cottage-new-window-dialog" role="dialog" aria-label="新窗口接续">
            <header>
              <div className="cottage-new-window-heading">
                <span className="cottage-new-window-glyph"><NewWindowGlyph /></span>
                <div><strong>新窗口</strong><small>新窗口的接续选项，带一点信号过去。</small></div>
              </div>
              <button type="button" onClick={() => setNewWindowPanelOpen(false)}><X size={16} /></button>
            </header>

            <div className="cottage-new-window-options">
              {([
                {
                  key: "continuity" as const,
                  title: "生活线",
                  hint: "近期近况",
                  enabled: hasContinuityLineForNewWindow,
                  empty: "暂无生活线",
                },
                {
                  key: "stateCard" as const,
                  title: "状态卡",
                  hint: "窗口主线",
                  enabled: hasStateCardForNewWindow,
                  empty: "此窗口暂无",
                },
                {
                  key: "context" as const,
                  title: "上下文",
                  hint: "最近原话",
                  enabled: hasRecentContextForNewWindow,
                  empty: "暂无原话",
                },
              ]).map((item) => (
                <label key={item.key} className={!item.enabled ? "disabled" : ""}>
                  <input
                    type="checkbox"
                    checked={Boolean(newWindowOptions[item.key]) && item.enabled}
                    disabled={!item.enabled}
                    onChange={(event) => setNewWindowOptions((current) => ({ ...current, [item.key]: event.target.checked }))}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.enabled ? item.hint : item.empty}</small>
                  </span>
                  <em>{item.enabled ? "可带" : "空"}</em>
                </label>
              ))}
            </div>

            {recentWindowSources.length > 0 && (
              <div className="cottage-new-window-sources">
                <span>来源</span>
                {recentWindowSources.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className={conversation.id === selectedNewWindowSource?.id ? "active" : ""}
                    onClick={() => handleSelectNewWindowSource(conversation)}
                  >
                    <strong>{conversation.id === activeId ? "当前" : formatConversationDate(conversation.updatedAt)}</strong>
                    <small>{conversation.title}</small>
                  </button>
                ))}
              </div>
            )}

            <div className="cottage-confirm-actions">
              <button type="button" onClick={() => setNewWindowPanelOpen(false)}>取消</button>
              <button type="button" onClick={() => createConversationWithContinuity()}>开启</button>
            </div>
          </section>
          </div>
        )}

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

        {stateCard && (
          <>
            <section className={`cottage-state-card-compact ${stateCard.enabled ? "is-enabled" : "is-paused"}`}>
              <div className="cottage-state-card-label">
                <strong>状态卡</strong>
                {stateCardNotice ? <small>{stateCardNotice}</small> : null}
              </div>
              <div className="cottage-state-card-tools">
                <button
                  type="button"
                  className={`state-card-toggle ${stateCard.enabled ? "active" : "muted"}`}
                  onClick={() => patchSessionStateCard(activeId, { enabled: !stateCard.enabled })}
                  title={stateCard.enabled ? "暂停自动更新" : "开启自动更新"}
                  aria-label={stateCard.enabled ? "暂停状态卡自动更新" : "开启状态卡自动更新"}
                >
                  <StateCardGlyph size={16} />
                  {!stateCard.enabled && <span className="cottage-state-card-off-slash" />}
                </button>
                <button
                  type="button"
                  className={stateCard.visibleToPersona ? "active" : "muted"}
                  onClick={() => patchSessionStateCard(activeId, { visibleToPersona: !stateCard.visibleToPersona })}
                  title={stateCard.visibleToPersona ? "当前会注入对话" : "保留但不注入"}
                >{stateCard.visibleToPersona ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                <button type="button" className={showStateCardEditor ? "active" : ""} onClick={() => setShowStateCardEditor((value) => !value)} title="查看或编辑状态卡"><Edit2 size={14} /></button>
                <button type="button" onClick={() => void handleRefreshStateCard()} title="立即更新状态卡" disabled={stateCardBusy}>
                  {stateCardBusy ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                </button>
              </div>
            </section>

            {showStateCardEditor && (
              <div className="cottage-state-card-panel-layer">
              <section className="cottage-state-card-editor">
                <header>
                  <div>
                    <strong><StateCardGlyph size={15} />当前窗口状态卡</strong>
                    <small>滚动接续便签，不是长期记忆。</small>
                  </div>
                  <button type="button" onClick={() => setShowStateCardEditor(false)} title="收起状态卡"><X size={14} /></button>
                </header>
                <textarea value={stateCardDraft} onChange={(event) => setStateCardDraft(event.target.value)} rows={8} placeholder="当前窗口还没有形成状态卡。" />
                <footer>
                  <button type="button" onClick={() => { if (window.confirm("清空当前窗口状态卡？")) { clearSessionStateCard(activeId); setStateCardDraft(""); } }}>清空</button>
                  <button type="button" onClick={() => void handleRefreshStateCard()} disabled={stateCardBusy}>{stateCardBusy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}更新</button>
                  <button type="button" className="primary" onClick={handleSaveStateCard}><Check size={14} />保存</button>
                </footer>
              </section>
              </div>
            )}
          </>
        )}

        <div className="cottage-session-list">
          {searchQuery.trim() ? (
            <>
              <div className="cottage-search-summary">
                <strong>{totalSearchHitCount}</strong>
                <span>条匹配 · 按窗口和时间排序</span>
              </div>
              {searchGroups.map((group) => (
                <section key={group.conversation.id} className={`cottage-search-group ${group.isWatchConversation ? "is-watch" : "is-daily"}`}>
                  <button
                    type="button"
                    className="cottage-search-group-head"
                    onClick={() => handleSelectConversation(group.conversation.id)}
                  >
                    <span className="cottage-search-group-title-line">
                      <em>{group.isWatchConversation ? "观影" : "日常"}</em>
                      <strong>{group.conversation.title}</strong>
                    </span>
                    <span>{group.hitCount} 条 · {formatConversationDate(group.conversation.updatedAt || group.hits[0].createdAt)}</span>
                    <small>{group.preview || "无预览"}</small>
                  </button>
                  <div className="cottage-search-hit-list">
                    {group.hits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="cottage-search-hit"
                        onClick={() => hit.messageId ? handleJumpToMessage(group.conversation.id, hit.messageId) : handleSelectConversation(group.conversation.id)}
                      >
                        <span>
                          <strong>{hit.roleLabel}</strong>
                          <time>{formatConversationDate(hit.createdAt)}</time>
                        </span>
                        <p>
                          {splitHighlightedText(hit.preview, searchQuery).map((part, index) => (
                            part.match ? (
                              <mark key={`${hit.id}-${index}`}>{part.text}</mark>
                            ) : (
                              <span key={`${hit.id}-${index}`}>{part.text}</span>
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
              {sortedConversations.map(renderConversationItem)}
              {!sortedConversations.length && (
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
            <span className="cottage-sidebar-toggle-bars" aria-hidden="true">
              <i />
              <i />
            </span>
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

          <div className="cottage-chat-actions">
            <button type="button" onClick={handleExportConversation} title="导出当前窗口" aria-label="导出当前窗口"><Download size={16} /></button>
          </div>
        </header>

        <div className="cottage-message-scroll" ref={messageListRef} onScroll={handleMessageScroll}>
          {!messages.length && (
            <div className="cottage-empty-chat">
              <Database size={30} />
              <strong>这里会保存长对话，也会承接每部片子的观影对话。</strong>
              <span>人格核、记忆库、状态卡和时光回廊已经接入；这里会保留每一扇窗口。</span>
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
                {message.role === "companion" && chronicleWriteState?.messageId === message.id && (
                  <div className={`cottage-memory-write-state ${chronicleWriteState.phase}`}>
                    {chronicleWriteState.phase === "writing" ? <Loader2 className="spin" size={13} /> : chronicleWriteState.phase === "done" ? <Check size={13} /> : <X size={13} />}
                    <span>{chronicleWriteState.text}</span>
                  </div>
                )}
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
              onClick={isSending ? handleStop : handleSend}
              disabled={!isSending && !input.trim() && !pendingAttachments.length}
              title={isSending ? "停止生成" : "发送"}
            >
              {isSending ? <Square size={13} fill="currentColor" /> : <Send size={17} />}
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
