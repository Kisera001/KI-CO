import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Clapperboard,
  Clock3,
  ExternalLink,
  Film,
  Heart,
  Lightbulb,
  Maximize2,
  MessageCircle,
  Minimize2,
  PlayCircle,
  ListVideo,
  Search,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Upload,
  UserRoundCog,
  X,
} from "lucide-react";
import { ChronicleBookGlyph, CottageLogoMark, MemoryArchiveGlyph } from "./CottageGlyphs";
import type { CompanionAdapters, CompanionPlanPoint, ConversationAttachment, SubtitleCue, UplinkSettings, WatchRecord } from "../types";
import { captureVideoFrame, captureVideoThumbnail } from "../utils/media";
import { getSubtitleWindow, parseSubtitles } from "../utils/subtitles";
import { selectCacheFriendlyWindow } from "../utils/contextWindow";
import { shouldRetrieveMemory } from "../utils/memoryRecallGate";
import { formatTime, slugifyTitle } from "../utils/time";
import { listWatchRecords, removeWatchRecord, renameWatchRecord, saveWatchRecord } from "../storage/watchRecords";
import { appendConversationMessages, findWatchConversation, getOrCreateWatchConversation, renameWatchConversationLink } from "../storage/conversations";
import { MarkdownText } from "./MarkdownText";

interface CinemaCompanionRoomProps {
  adapters: CompanionAdapters;
  uplinkSettings: UplinkSettings;
  onOpenLongChat?: () => void;
  onOpenPersona?: () => void;
  onOpenMemory?: () => void;
  onOpenChronicle?: () => void;
  onOpenVectorLab?: () => void;
  onOpenSettings?: () => void;
  onOpenConversation?: (conversationId: string) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "companion";
  text: string;
}

interface NativeAudioTrackLike {
  kind?: string;
  label?: string;
  language?: string;
  enabled?: boolean;
}

interface NativeAudioTrackListLike {
  length: number;
  [index: number]: NativeAudioTrackLike;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

interface CinemaAudioTrackOption {
  index: number;
  label: string;
  language: string;
  enabled: boolean;
}

type PanelKey = "none" | "source" | "companion" | "subtitles" | "playlist" | "plan" | "map" | "prompt";
type CompanionMode = "active" | "natural" | "silent";
type CompanionDensity = "quiet" | "normal" | "talkative" | "breakdown";
type DeliveryMode = "auto" | "hint" | "manual";
type WebSearchPlatform = "bilibili";
type WatchPromptRequestMode = "line" | "segment";

interface WebFrameSource {
  platform: WebSearchPlatform;
  keyword: string;
  url: string;
  originalUrl?: string;
  embedUrl?: string;
  mode?: "embed" | "page";
  title: string;
}

interface WatchPromptAction {
  id: WatchPromptRequestMode;
  label: string;
  hint: string;
  icon: typeof MessageCircle;
}

interface AskCompanionOptions {
  displayText?: string;
  modelPrompt?: string;
  frameOverride?: string;
  retrievalQuery?: string;
  requestMode?: "cinema" | "watchPrompt";
}

const COMPANION_MODE_LABELS: Record<CompanionMode, string> = {
  active: "主动",
  natural: "自然",
  silent: "静默",
};

const COMPANION_DENSITY_LABELS: Record<CompanionDensity, string> = {
  quiet: "安静",
  normal: "正常",
  talkative: "话痨",
  breakdown: "拆解",
};

const CINEMA_LIGHTS_STATE_KEY = "kisera-cottage-cinema-lights-off";
const DEFAULT_BACKGROUND_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

function getDefaultCinemaBackgroundSrc(name: "cinema-room-bg" | "cinema-room-bg2", extensionIndex: number) {
  const extension = DEFAULT_BACKGROUND_EXTENSIONS[Math.min(extensionIndex, DEFAULT_BACKGROUND_EXTENSIONS.length - 1)];
  return `/${name}.${extension}`;
}

function getAudioTrackList(video: HTMLVideoElement | null): NativeAudioTrackListLike | null {
  if (!video) return null;
  const tracks = (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackListLike }).audioTracks;
  if (!tracks || typeof tracks.length !== "number") return null;
  return tracks;
}

function readAudioTrackOptions(video: HTMLVideoElement | null): CinemaAudioTrackOption[] {
  const tracks = getAudioTrackList(video);
  if (!tracks || tracks.length <= 0) return [];

  const options: CinemaAudioTrackOption[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const language = String(track?.language || "").trim();
    const rawLabel = String(track?.label || "").trim();
    const kind = String(track?.kind || "").trim();
    options.push({
      index,
      label: rawLabel || `音轨 ${index + 1}`,
      language: [language, kind].filter(Boolean).join(" · "),
      enabled: Boolean(track?.enabled),
    });
  }
  return options;
}

function KiseraStarIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="7" cy="7" rx="6.2" ry="2" stroke="currentColor" strokeWidth="0.6" fill="none" transform="rotate(-30 7 7)" opacity="0.8" />
      <circle cx="9.8" cy="4.2" r="0.6" fill="#fff" />
      <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <path
        d="M7 1.2C7 4.2 8.8 6 10.8 7C8.8 8 7 9.8 7 12.8C7 9.8 5.2 8 3.2 7C5.2 6 7 4.2 7 1.2Z"
        fill="currentColor"
      />
      <circle cx="7" cy="7" r="0.8" fill="#fff" />
    </svg>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlSize(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.max(0, Math.round(base64.length * 0.75));
}

function makeFrameAttachment(frameDataUrl: string, title: string, currentTime: number): ConversationAttachment | null {
  if (!frameDataUrl.trim()) return null;
  const mimeType = frameDataUrl.match(/^data:([^;]+);/)?.[1] || "image/jpeg";
  return {
    id: `cinema-frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: "image",
    name: `${slugifyTitle(title || "cinema-frame") || "cinema-frame"}-${Math.round(currentTime)}.jpg`,
    mimeType,
    size: estimateDataUrlSize(frameDataUrl),
    dataUrl: frameDataUrl,
  };
}

function parseManualTime(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => Number(part.trim()));
  if (parts.some((part) => Number.isNaN(part) || part < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function roundHalfSecond(value: number) {
  return Math.round(value * 2) / 2;
}

function makePlanPoints(cues: SubtitleCue[], density: CompanionDensity): CompanionPlanPoint[] {
  if (cues.length === 0) return [];
  const countByDensity: Record<CompanionDensity, number> = {
    quiet: 8,
    normal: 14,
    talkative: 22,
    breakdown: 18,
  };
  const targetCount = countByDensity[density];
  const interval = Math.max(1, Math.floor(cues.length / targetCount));
  return cues
    .filter((_, index) => index % interval === 0)
    .slice(0, targetCount)
    .map((cue, index) => ({
      id: `plan-${index}`,
      time: cue.start,
      subtitle: cue.text,
      companionHint:
        density === "breakdown"
          ? "这里适合拆一下镜头、台词或关系变化。"
          : cue.text.length > 40
            ? "这里适合停一下，聊聊情绪和关系变化。"
            : "这里可以给一个短陪看气泡。",
      type: density === "breakdown" ? "observe" : "emotion",
      priority: index % 5 === 0 ? "high" : "medium",
      delivery: "hint",
    }));
}

function getCompanionPlanGuidance(density: CompanionDensity, duration: number) {
  const minutes = Math.max(1, Math.round(duration / 60));
  if (density === "quiet") {
    return {
      range: minutes > 120 ? "8-12" : "6-10",
      spacing: "宁可少而准，通常间隔 8-15 分钟。",
      focus: "情绪转折、沉默、关键台词和真正值得轻声提醒的地方。",
    };
  }
  if (density === "talkative") {
    return {
      range: minutes > 120 ? "22-32" : "14-24",
      spacing: "允许更密，但避免连续刷屏；同一段最多保留 1-2 个重点。",
      focus: "情绪、关系、伏笔、名场面和可自然吐槽的小瞬间。",
    };
  }
  if (density === "breakdown") {
    return {
      range: minutes > 120 ? "18-28" : "12-20",
      spacing: "按镜头/剪辑/表演信息密度取点，不要平均铺满。",
      focus: "镜头语言、剪辑节奏、表演细节、声音设计和叙事选择。",
    };
  }
  return {
    range: minutes > 120 ? "14-22" : "10-16",
    spacing: "自然分布在关键段落，不要为了数量凑点。",
    focus: "关键台词、关系变化、情绪节点、伏笔和观影时会想轻声回应的地方。",
  };
}

function getCompanionPlanMaxCount(density: CompanionDensity, duration: number) {
  const minutes = Math.max(1, Math.round(duration / 60));
  const tier = minutes <= 30 ? "short" : minutes <= 90 ? "medium" : minutes <= 150 ? "long" : "epic";
  const limits: Record<CompanionDensity, Record<typeof tier, number>> = {
    quiet: { short: 5, medium: 8, long: 12, epic: 16 },
    normal: { short: 8, medium: 14, long: 20, epic: 26 },
    talkative: { short: 12, medium: 22, long: 32, epic: 40 },
    breakdown: { short: 20, medium: 40, long: 60, epic: 80 },
  };
  return limits[density][tier];
}

function getCompanionPlanMinSpacing(density: CompanionDensity) {
  if (density === "quiet") return 360;
  if (density === "talkative") return 120;
  if (density === "breakdown") return 90;
  return 180;
}

function findNearestCue(cues: SubtitleCue[], targetTime: number) {
  return cues.reduce<SubtitleCue | undefined>((best, cue) => {
    if (!best) return cue;
    return Math.abs(cue.start - targetTime) < Math.abs(best.start - targetTime) ? cue : best;
  }, undefined);
}

function makeCoveragePlanPoint(cue: SubtitleCue, index: number, density: CompanionDensity): CompanionPlanPoint {
  return {
    id: `coverage-${index}-${Math.round(cue.start)}`,
    time: cue.start,
    subtitle: cue.text,
    companionHint: density === "breakdown"
      ? "这里..."
      : cue.text.length > 42
        ? "这里想说点..."
        : "想说点...",
    type: density === "breakdown" ? "observe" : "emotion",
    priority: "medium",
    delivery: "hint",
  };
}

function rebalanceCompanionPlanPoints(
  points: CompanionPlanPoint[],
  cues: SubtitleCue[],
  density: CompanionDensity,
  duration: number,
) {
  const lastCue = cues[cues.length - 1];
  const lastPoint = points[points.length - 1];
  const totalDuration = Math.max(duration || 0, lastCue?.end || 0, lastPoint?.time || 0, 1);
  const maxCount = getCompanionPlanMaxCount(density, totalDuration);
  const minSpacing = getCompanionPlanMinSpacing(density);
  const coverageWindow = Math.max(minSpacing * 1.4, totalDuration / Math.max(maxCount, 1));
  const requiredRatios = totalDuration >= 5400 ? [0.12, 0.32, 0.52, 0.72, 0.9] : [0.18, 0.5, 0.82];
  const withCoverage = [...points].sort((a, b) => a.time - b.time);

  requiredRatios.forEach((ratio, index) => {
    const target = totalDuration * ratio;
    const hasNearbyPoint = withCoverage.some((point) => Math.abs(point.time - target) <= coverageWindow);
    if (hasNearbyPoint) return;
    const cue = findNearestCue(cues, target);
    if (cue) withCoverage.push(makeCoveragePlanPoint(cue, index, density));
  });

  const sorted = withCoverage
    .filter((point) => Number.isFinite(point.time) && point.time >= 0)
    .sort((a, b) => a.time - b.time);
  if (sorted.length <= 1) return sorted;

  const bucketCount = Math.min(maxCount, sorted.length);
  const bucketSize = totalDuration / bucketCount;
  const buckets = Array.from({ length: bucketCount }, () => [] as CompanionPlanPoint[]);
  sorted.forEach((point) => {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(point.time / bucketSize)));
    buckets[index].push(point);
  });

  const distributed = buckets
    .map((bucket, index) => {
      if (!bucket.length) return null;
      const center = (index + 0.5) * bucketSize;
      return bucket
        .slice()
        .sort((a, b) => {
          const priorityDelta = getPlanPriorityWeight(b) - getPlanPriorityWeight(a);
          if (priorityDelta !== 0) return priorityDelta;
          return Math.abs(a.time - center) - Math.abs(b.time - center);
        })[0];
    })
    .filter(Boolean) as CompanionPlanPoint[];

  const spaced: CompanionPlanPoint[] = [];
  distributed.forEach((point) => {
    const previous = spaced[spaced.length - 1];
    if (!previous || point.time - previous.time >= minSpacing * 0.65) {
      spaced.push(point);
      return;
    }
    if (getPlanPriorityWeight(point) > getPlanPriorityWeight(previous)) {
      spaced[spaced.length - 1] = point;
    }
  });

  return spaced.map((point, index) => ({ ...point, id: point.id || `plan-${index}` }));
}

function buildCompanionSubtitleDigest(cues: SubtitleCue[]) {
  return cues
    .map((cue, index) => `${index + 1}. [${formatTime(cue.start)}-${formatTime(cue.end)}] ${cue.text}`)
    .join("\n")
    .slice(0, 60000);
}

function extractJsonPayload(text: string): unknown {
  const candidates: string[] = [];
  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  fencedMatches.forEach((match) => {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  });
  candidates.push(text.trim());

  for (const source of candidates) {
    try {
      return JSON.parse(source);
    } catch {
      // Try extracting a JSON body from surrounding model prose.
    }

    const objectStart = source.indexOf("{");
    const objectEnd = source.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(source.slice(objectStart, objectEnd + 1));
      } catch {
        // Keep trying array-shaped output or another candidate.
      }
    }

    const arrayStart = source.indexOf("[");
    const arrayEnd = source.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        const triggers = JSON.parse(source.slice(arrayStart, arrayEnd + 1));
        if (Array.isArray(triggers)) return { triggers };
      } catch {
        // Keep trying remaining candidates.
      }
    }
  }

  const preview = text.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!preview) {
    throw new Error("模型返回为空，未能生成陪看星图。");
  }
  if (text.includes("{") || text.includes("[")) {
    throw new Error(`模型返回的 JSON 不完整或格式异常。返回开头：${preview}${text.length > 140 ? "..." : ""}`);
  }
  throw new Error(`模型没有按要求返回 JSON。返回开头：${preview}${text.length > 140 ? "..." : ""}`);
}

function parseCompanionPlanTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  return parseManualTime(value);
}

function normalizeGeneratedPlan(
  payload: unknown,
  fallbackCues: SubtitleCue[],
  density: CompanionDensity,
  duration: number,
): CompanionPlanPoint[] {
  const root = payload as { triggers?: unknown[] };
  const triggers = Array.isArray(root?.triggers) ? root.triggers : [];
  const normalized = triggers
    .map((item, index) => {
      const raw = item as {
        id?: unknown;
        time?: unknown;
        bubble?: unknown;
        companionHint?: unknown;
        subtitle?: unknown;
        type?: unknown;
        priority?: unknown;
        delivery?: unknown;
      };
      const time = parseCompanionPlanTime(raw.time);
      const companionHint = String(raw.bubble || raw.companionHint || "").trim();
      if (time === null || !companionHint) return null;
      const nearestCue = fallbackCues.reduce<SubtitleCue | undefined>((best, cue) => {
        if (!best) return cue;
        return Math.abs(cue.start - time) < Math.abs(best.start - time) ? cue : best;
      }, undefined);
      return {
        id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `plan-${index}`,
        time,
        subtitle: typeof raw.subtitle === "string" && raw.subtitle.trim() ? raw.subtitle.trim() : nearestCue?.text,
        companionHint: companionHint.slice(0, 120),
        type: raw.type === "emotion" || raw.type === "observe" || raw.type === "question" || raw.type === "memory"
          ? raw.type
          : "observe",
        priority: raw.priority === "high" || raw.priority === "medium" || raw.priority === "low"
          ? raw.priority
          : "medium",
        delivery: raw.delivery === "auto" || raw.delivery === "hint" || raw.delivery === "manual"
          ? raw.delivery
          : "hint",
      };
    })
    .filter(Boolean) as CompanionPlanPoint[];

  if (!normalized.length) throw new Error("没有生成有效的陪看点。");
  return rebalanceCompanionPlanPoints(normalized.sort((a, b) => a.time - b.time), fallbackCues, density, duration);
}

function getPlanPriorityWeight(point: CompanionPlanPoint) {
  if (point.priority === "high") return 3;
  if (point.priority === "low") return 1;
  return 2;
}

function resolveCompanionDelivery(point: CompanionPlanPoint, mode: CompanionMode): DeliveryMode {
  const priority = point.priority ?? "medium";
  const delivery = point.delivery ?? "hint";
  if (mode === "silent") return priority === "high" ? "hint" : "manual";
  if (mode === "active") return delivery === "manual" ? "hint" : "auto";
  if (priority === "high") return "auto";
  return delivery;
}

function extractCompanionNameFromCore(personaCore: string) {
  const match = personaCore.match(/Companion name:\s*([^\n]+)/i);
  return match?.[1]?.trim() || "当前人格";
}

function pickCompanionPointPrompt(speakerName: string, bubble: string) {
  const name = speakerName.trim() || "你";
  const prompts = [
    `${name}，“${bubble}”。展开说说？`,
    `${name}，“${bubble}”？...什么意思呢`,
    `${name}，“${bubble}”？是注意到什么了？`,
    `${name}，“${bubble}”，？`,
    `${name}，“${bubble}”，想听你说说`,
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function buildBilibiliSearchUrl(keyword: string) {
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword.trim())}`;
}

function buildBilibiliEmbedUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const videoMatch = parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
    if (!videoMatch) return rawUrl;

    const videoId = videoMatch[1];
    const page = parsed.searchParams.get("p") || "1";
    const embed = new URL("https://player.bilibili.com/player.html");
    if (/^BV/i.test(videoId)) {
      embed.searchParams.set("bvid", videoId);
    } else {
      embed.searchParams.set("aid", videoId.replace(/^av/i, ""));
    }
    embed.searchParams.set("page", page);
    embed.searchParams.set("autoplay", "0");
    embed.searchParams.set("danmaku", "0");
    return embed.toString();
  } catch {
    return rawUrl;
  }
}

function createBilibiliFrameSource(keyword: string): WebFrameSource {
  const trimmed = keyword.trim();
  const isUrl = isHttpUrl(trimmed);
  const embedUrl = isUrl ? buildBilibiliEmbedUrl(trimmed) : undefined;
  const useEmbed = !!embedUrl && embedUrl !== trimmed;
  return {
    platform: "bilibili",
    keyword: trimmed,
    originalUrl: isUrl ? trimmed : undefined,
    embedUrl,
    mode: useEmbed ? "embed" : undefined,
    url: useEmbed ? embedUrl : isUrl ? trimmed : buildBilibiliSearchUrl(trimmed),
    title: isUrl ? "B站网页视频" : `B站 · ${trimmed}`,
  };
}

function normalizeCompanionMode(value?: string): CompanionMode {
  return value && value in COMPANION_MODE_LABELS ? (value as CompanionMode) : "natural";
}

function normalizeCompanionDensity(value?: string): CompanionDensity {
  return value && value in COMPANION_DENSITY_LABELS ? (value as CompanionDensity) : "normal";
}

export function CinemaCompanionRoom({
  adapters,
  uplinkSettings,
  onOpenLongChat,
  onOpenPersona,
  onOpenMemory,
  onOpenChronicle,
  onOpenVectorLab,
  onOpenSettings,
  onOpenConversation,
}: CinemaCompanionRoomProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const recordThumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const webSourceInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailTargetRef = useRef<WatchRecord | null>(null);
  const lastAutoSaveAtRef = useRef(0);
  const panelCloseTimerRef = useRef<number | undefined>(undefined);
  const pendingResumeRef = useRef<WatchRecord | null>(null);
  const pendingInitialTimeRef = useRef<number | null>(null);
  const selectedAudioTrackIndexRef = useRef<number | null>(null);
  const floatingDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);
  const companionDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [bilibiliQuery, setBilibiliQuery] = useState("");
  const [webSourceUrl, setWebSourceUrl] = useState("");
  const [webFrameSource, setWebFrameSource] = useState<WebFrameSource | null>(null);
  const [webFrameVisible, setWebFrameVisible] = useState(false);
  const [isFloating, setIsFloating] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState({ left: 48, top: 92 });
  const [companionPosition, setCompanionPosition] = useState<{ left: number; top: number } | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKey>("none");
  const [closingPanel, setClosingPanel] = useState<PanelKey>("none");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [webTimeInput, setWebTimeInput] = useState("00:00");
  const [subtitles, setSubtitles] = useState<SubtitleCue[]>([]);
  const [subtitleFileName, setSubtitleFileName] = useState("");
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState(0);
  const [showSubtitlesOnVideo, setShowSubtitlesOnVideo] = useState(true);
  const [subtitlePanelExpanded, setSubtitlePanelExpanded] = useState(true);
  const [userMessage, setUserMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const [records, setRecords] = useState<WatchRecord[]>(() => listWatchRecords());
  const [editingRecordId, setEditingRecordId] = useState("");
  const [editingRecordTitle, setEditingRecordTitle] = useState("");
  const [plan, setPlan] = useState<CompanionPlanPoint[]>([]);
  const [companionMode, setCompanionMode] = useState<CompanionMode>("natural");
  const [companionDensity, setCompanionDensity] = useState<CompanionDensity>("normal");
  const [triggeredPlanIds, setTriggeredPlanIds] = useState<string[]>([]);
  const [activeCompanionPoint, setActiveCompanionPoint] = useState<CompanionPlanPoint | null>(null);
  const [activeCompanionDelivery, setActiveCompanionDelivery] = useState<DeliveryMode | null>(null);
  const [error, setError] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [audioTrackOptions, setAudioTrackOptions] = useState<CinemaAudioTrackOption[]>([]);
  const [selectedAudioTrackIndex, setSelectedAudioTrackIndex] = useState<number | null>(null);
  const [defaultBackgroundExtensionIndex, setDefaultBackgroundExtensionIndex] = useState(0);
  const [defaultDarkBackgroundExtensionIndex, setDefaultDarkBackgroundExtensionIndex] = useState(0);
  const [lightsOff, setLightsOff] = useState(() => {
    try {
      return window.localStorage.getItem(CINEMA_LIGHTS_STATE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [lightTransitionSequence, setLightTransitionSequence] = useState(0);

  useEffect(() => {
    const refreshImportedRecords = () => setRecords(listWatchRecords());
    window.addEventListener("kisera-cottage-data-imported", refreshImportedRecords);
    return () => window.removeEventListener("kisera-cottage-data-imported", refreshImportedRecords);
  }, []);

  const effectiveSubtitleTime = Math.max(0, currentTime - subtitleOffsetSeconds);
  const subtitleWindow = useMemo(
    () => getSubtitleWindow(subtitles, effectiveSubtitleTime, uplinkSettings.contextLoad.subtitleBefore, uplinkSettings.contextLoad.subtitleAfter),
    [effectiveSubtitleTime, subtitles, uplinkSettings.contextLoad.subtitleAfter, uplinkSettings.contextLoad.subtitleBefore],
  );
  const activePlanPoint = useMemo(
    () => plan.find((point) => Math.abs(point.time - effectiveSubtitleTime) < 1.5),
    [effectiveSubtitleTime, plan],
  );
  const hasWatchSource = !!videoUrl || !!webFrameSource;
  const hasCustomBackground = !!uplinkSettings.visual.customBackgroundDataUrl;
  const backgroundFitMode = uplinkSettings.visual.backgroundFit;
  const backgroundFitClass = `fit-${backgroundFitMode}`;
  const fittedLightMap = backgroundFitMode !== "cover";
  const activeAudioTrack =
    audioTrackOptions.find((track) => track.enabled)
    ?? (selectedAudioTrackIndex !== null
      ? audioTrackOptions.find((track) => track.index === selectedAudioTrackIndex)
      : undefined);
  const watchPromptActions: WatchPromptAction[] = [
    {
      id: "line",
      label: "讲台词",
      hint: "讲讲这句台词。",
      icon: MessageCircle,
    },
    {
      id: "segment",
      label: "讲这一段",
      hint: "聊聊这一段发生了什么。",
      icon: Clapperboard,
    },
  ];

  function toggleLights() {
    setLightsOff((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(CINEMA_LIGHTS_STATE_KEY, String(next));
      } catch {
        // The atmosphere toggle still works when local persistence is unavailable.
      }
      return next;
    });
    setLightTransitionSequence((sequence) => sequence + 1);
  }

  function enterMovieAtmosphere() {
    if (!lightsOff) setLightTransitionSequence((sequence) => sequence + 1);
    setLightsOff(true);
    try {
      window.localStorage.setItem(CINEMA_LIGHTS_STATE_KEY, "true");
    } catch {
      // Loading a film still changes the visible room when persistence is unavailable.
    }
  }

  function refreshAudioTrackOptions() {
    const nextOptions = readAudioTrackOptions(videoRef.current);
    setAudioTrackOptions(nextOptions);
    const enabledTrack = nextOptions.find((track) => track.enabled);
    const nextIndex = enabledTrack?.index ?? selectedAudioTrackIndexRef.current ?? null;
    selectedAudioTrackIndexRef.current = nextIndex;
    setSelectedAudioTrackIndex(nextIndex);
  }

  function applyAudioTrackSelection(targetIndex: number) {
    const tracks = getAudioTrackList(videoRef.current);
    if (!tracks || tracks.length <= 1) return;
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (track && typeof track.enabled === "boolean") {
        track.enabled = index === targetIndex;
      }
    }
    selectedAudioTrackIndexRef.current = targetIndex;
    setSelectedAudioTrackIndex(targetIndex);
    setAudioTrackOptions(readAudioTrackOptions(videoRef.current));
  }

  function cycleAudioTrack() {
    if (audioTrackOptions.length <= 1) return;
    const currentIndex = activeAudioTrack?.index ?? selectedAudioTrackIndex ?? audioTrackOptions[0].index;
    const currentPosition = audioTrackOptions.findIndex((track) => track.index === currentIndex);
    const nextTrack = audioTrackOptions[(currentPosition + 1 + audioTrackOptions.length) % audioTrackOptions.length];
    if (nextTrack) applyAudioTrackSelection(nextTrack.index);
  }

  useEffect(() => {
    return () => {
      if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      if (panelCloseTimerRef.current) window.clearTimeout(panelCloseTimerRef.current);
    };
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || webFrameSource) {
      setAudioTrackOptions([]);
      selectedAudioTrackIndexRef.current = null;
      setSelectedAudioTrackIndex(null);
      return;
    }

    const updateTracks = () => {
      const preferredIndex = selectedAudioTrackIndexRef.current;
      const options = readAudioTrackOptions(video);
      if (preferredIndex !== null && options.some((track) => track.index === preferredIndex)) {
        const tracks = getAudioTrackList(video);
        if (tracks) {
          for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            if (track && typeof track.enabled === "boolean") track.enabled = index === preferredIndex;
          }
        }
      }
      refreshAudioTrackOptions();
    };

    updateTracks();
    const tracks = getAudioTrackList(video);
    tracks?.addEventListener?.("change", updateTracks);
    video.addEventListener("loadedmetadata", updateTracks);
    video.addEventListener("loadeddata", updateTracks);
    video.addEventListener("canplay", updateTracks);
    const timerA = window.setTimeout(updateTracks, 120);
    const timerB = window.setTimeout(updateTracks, 600);

    return () => {
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      tracks?.removeEventListener?.("change", updateTracks);
      video.removeEventListener("loadedmetadata", updateTracks);
      video.removeEventListener("loadeddata", updateTracks);
      video.removeEventListener("canplay", updateTracks);
    };
  }, [videoUrl, webFrameSource]);

  useEffect(() => {
    if (activeCompanionPoint) return;
    const point = plan
      .filter((item) => Math.abs(item.time - effectiveSubtitleTime) <= 1.2 && !triggeredPlanIds.includes(item.id))
      .sort((left, right) => getPlanPriorityWeight(right) - getPlanPriorityWeight(left))[0];
    if (!point) return;
    setTriggeredPlanIds((items) => {
      const nextIds = [...items, point.id];
      saveProgress(currentTime, duration, { triggeredPlanIds: nextIds });
      return nextIds;
    });
    const delivery = resolveCompanionDelivery(point, companionMode);
    if (delivery === "manual") {
      setActiveCompanionPoint(null);
      setActiveCompanionDelivery(null);
      return;
    }
    setActiveCompanionPoint(point);
    setActiveCompanionDelivery(delivery);
  }, [activeCompanionPoint, companionMode, currentTime, duration, effectiveSubtitleTime, plan, triggeredPlanIds]);

  useEffect(() => {
    if (webFrameSource) setWebTimeInput(formatTime(currentTime));
  }, [currentTime, webFrameSource]);

  function togglePanel(panel: PanelKey) {
    if (activePanel === panel) {
      closePanel();
      return;
    }
    if (panelCloseTimerRef.current) window.clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = undefined;
    setClosingPanel("none");
    setActivePanel(panel);
  }

  function closePanel() {
    if (activePanel === "none" || closingPanel !== "none") return;
    setClosingPanel(activePanel);
    if (panelCloseTimerRef.current) window.clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = window.setTimeout(() => {
      setActivePanel("none");
      setClosingPanel("none");
      panelCloseTimerRef.current = undefined;
    }, 150);
  }

  function toggleFloatingPlayer() {
    setIsFloating((value) => {
      if (!value) {
        setFloatingPosition({
          left: Math.max(16, window.innerWidth - 560),
          top: 92,
        });
      }
      return !value;
    });
  }

  function handleFloatingDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!isFloating) return;
    const stage = event.currentTarget.closest<HTMLElement>(".video-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    floatingDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleFloatingDragMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = floatingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextLeft = drag.left + event.clientX - drag.startX;
    const nextTop = drag.top + event.clientY - drag.startY;
    setFloatingPosition({
      left: Math.min(Math.max(8, nextLeft), window.innerWidth - 120),
      top: Math.min(Math.max(8, nextTop), window.innerHeight - 80),
    });
  }

  function handleFloatingDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    const drag = floatingDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      floatingDragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCompanionDragStart(event: React.PointerEvent<HTMLSpanElement>) {
    const panel = event.currentTarget.closest<HTMLElement>(".sofa-companion");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    companionDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleCompanionDragMove(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = companionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = event.currentTarget.closest<HTMLElement>(".sofa-companion");
    const width = panel?.offsetWidth || 520;
    const height = panel?.offsetHeight || 260;
    const nextLeft = drag.left + event.clientX - drag.startX;
    const nextTop = drag.top + event.clientY - drag.startY;
    setCompanionPosition({
      left: Math.min(Math.max(12, nextLeft), Math.max(12, window.innerWidth - width - 12)),
      top: Math.min(Math.max(12, nextTop), Math.max(12, window.innerHeight - height - 12)),
    });
  }

  function handleCompanionDragEnd(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = companionDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      companionDragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function saveProgress(
    time = currentTime,
    nextDuration = duration,
    overrides: Partial<Omit<WatchRecord, "id" | "updatedAt">> = {},
  ) {
    if ((!videoUrl && !webFrameSource) || !title.trim()) return;
    let thumbnailDataUrl: string | undefined;
    try {
      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        thumbnailDataUrl = captureVideoThumbnail(video);
      }
    } catch {
      thumbnailDataUrl = undefined;
    }
    const sourceType = overrides.sourceType ?? (webFrameSource ? "web-url" : "local-file");
    const sourceLabelValue =
      overrides.sourceLabel
      ?? (webFrameSource?.originalUrl || webFrameSource?.url)
      ?? sourceLabel
      ?? "local file";
    saveWatchRecord({
      title,
      sourceType,
      sourceLabel: sourceLabelValue,
      currentTime: overrides.currentTime ?? time,
      duration: overrides.duration ?? nextDuration,
      subtitleFileName: overrides.subtitleFileName ?? (subtitleFileName || undefined),
      subtitleCount: overrides.subtitleCount ?? (subtitles.length || undefined),
      subtitleOffsetSeconds: overrides.subtitleOffsetSeconds ?? subtitleOffsetSeconds,
      thumbnailDataUrl: overrides.thumbnailDataUrl ?? thumbnailDataUrl ?? (screenshotDataUrl || undefined),
      webUrl: overrides.webUrl ?? webFrameSource?.url,
      webOriginalUrl: overrides.webOriginalUrl ?? webFrameSource?.originalUrl,
      webEmbedUrl: overrides.webEmbedUrl ?? webFrameSource?.embedUrl,
      webPlatform: overrides.webPlatform ?? webFrameSource?.platform,
      webMode: overrides.webMode ?? webFrameSource?.mode,
      companionPlan: overrides.companionPlan ?? (plan.length > 0 ? plan : undefined),
      companionMode: overrides.companionMode ?? companionMode,
      companionDensity: overrides.companionDensity ?? companionDensity,
      triggeredPlanIds: overrides.triggeredPlanIds ?? triggeredPlanIds,
    });
    setRecords(listWatchRecords());
  }

  function loadRecentWatchConversation(titleValue: string, recordId?: string) {
    const conversation = findWatchConversation(titleValue || "观影对话", recordId || slugifyTitle(titleValue || "cinema"));
    if (!conversation) {
      setMessages([]);
      return;
    }
    const recentMessages = conversation.messages
      .filter((message) => (message.role === "user" || message.role === "companion") && message.text.trim())
      .slice(-10)
      .map<ChatMessage>((message) => ({
        id: `history-${message.id}`,
        role: message.role,
        text: message.text,
      }));
    setMessages(recentMessages);
  }

  async function handleVideoFile(file?: File) {
    if (!file) return;
    setError("");
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    const nextUrl = URL.createObjectURL(file);
    const fileTitle = file.name.replace(/\.[^.]+$/, "");
    const pendingRecord = pendingResumeRef.current;
    const shouldResume = !!pendingRecord;
    const nextTitle = shouldResume && pendingRecord ? pendingRecord.title : fileTitle;
    setVideoUrl(nextUrl);
    setTitle(nextTitle);
    setSourceLabel(file.name);
    pendingInitialTimeRef.current = shouldResume && pendingRecord ? pendingRecord.currentTime : null;
    pendingResumeRef.current = null;
    setCurrentTime(shouldResume && pendingRecord ? pendingRecord.currentTime : 0);
    setWebTimeInput(formatTime(shouldResume && pendingRecord ? pendingRecord.currentTime : 0));
    setSubtitleOffsetSeconds(pendingRecord?.subtitleOffsetSeconds ?? 0);
    setScreenshotDataUrl("");
    setPlan(shouldResume && pendingRecord?.companionPlan ? pendingRecord.companionPlan : []);
    setCompanionMode(normalizeCompanionMode(pendingRecord?.companionMode));
    setCompanionDensity(normalizeCompanionDensity(pendingRecord?.companionDensity));
    setTriggeredPlanIds(shouldResume && pendingRecord?.triggeredPlanIds ? pendingRecord.triggeredPlanIds : []);
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);
    setWebFrameSource(null);
    setWebFrameVisible(false);
    setAudioTrackOptions([]);
    selectedAudioTrackIndexRef.current = null;
    setSelectedAudioTrackIndex(null);
    loadRecentWatchConversation(nextTitle, pendingRecord?.id || slugifyTitle(nextTitle));
    enterMovieAtmosphere();
  }

  function closeVideo() {
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setTitle("");
    setSourceLabel("");
    setDuration(0);
    setCurrentTime(0);
    setWebTimeInput("00:00");
    setScreenshotDataUrl("");
    setPlan([]);
    setTriggeredPlanIds([]);
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);
    setIsFloating(false);
    setActivePanel("none");
    setWebFrameSource(null);
    setWebFrameVisible(false);
    setAudioTrackOptions([]);
    selectedAudioTrackIndexRef.current = null;
    setSelectedAudioTrackIndex(null);
    setMessages([]);
    pendingResumeRef.current = null;
    pendingInitialTimeRef.current = null;
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function setManualWatchTime(seconds: number) {
    const nextTime = Math.max(0, seconds);
    if (videoRef.current) videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    setWebTimeInput(formatTime(nextTime));
    if (webFrameSource) saveProgress(nextTime, duration);
  }

  function applyWebTimeInput() {
    const nextTime = parseManualTime(webTimeInput);
    if (nextTime === null) {
      setError("时间格式可以写成 90、01:30 或 00:01:30。");
      return;
    }
    setError("");
    setManualWatchTime(nextTime);
  }

  function nudgeWebTime(delta: number) {
    setManualWatchTime(currentTime + delta);
  }

  function toggleLocalPlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {
        setError("浏览器暂时不允许自动播放，请手动点击播放。");
      });
      return;
    }
    video.pause();
  }

  function seekLocalVideo(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    const maximum = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const nextTime = Math.min(Math.max(0, (video.currentTime || currentTime) + delta), maximum || Number.MAX_SAFE_INTEGER);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    saveProgress(nextTime, maximum || duration);
  }

  useEffect(() => {
    if (!videoUrl || webFrameSource) return;

    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName?.toLowerCase();
      return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleLocalPlayback();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekLocalVideo(-5);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekLocalVideo(5);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, duration, videoUrl, webFrameSource]);

  function adjustSubtitleOffset(delta: number) {
    setSubtitleOffsetSeconds((value) => {
      const nextOffset = roundHalfSecond(Math.min(120, Math.max(-120, value + delta)));
      saveProgress(currentTime, duration, { subtitleOffsetSeconds: nextOffset });
      return nextOffset;
    });
  }

  async function handleScreenshotFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setScreenshotDataUrl(dataUrl);
      saveProgress(currentTime, duration, { thumbnailDataUrl: dataUrl });
    } catch (event) {
      setError(event instanceof Error ? event.message : "截图读取失败。");
    } finally {
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    }
  }

  function openRecordThumbnailPicker(record: WatchRecord) {
    thumbnailTargetRef.current = record;
    recordThumbnailInputRef.current?.click();
  }

  async function handleRecordThumbnailFile(file?: File) {
    const target = thumbnailTargetRef.current;
    if (!file || !target) return;
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      saveWatchRecord({
        ...target,
        thumbnailDataUrl: dataUrl,
      });
      setRecords(listWatchRecords());
    } catch (event) {
      setError(event instanceof Error ? event.message : "缩略图读取失败。");
    } finally {
      thumbnailTargetRef.current = null;
      if (recordThumbnailInputRef.current) recordThumbnailInputRef.current.value = "";
    }
  }

  async function handleSubtitleFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      const text = await readFileAsText(file);
      const parsed = parseSubtitles(text, file.name);
      setSubtitles(parsed);
      setSubtitleFileName(file.name);
      setShowSubtitlesOnVideo(true);
      setSubtitlePanelExpanded(true);
      setSubtitleOffsetSeconds(0);
      setPlan([]);
      setTriggeredPlanIds([]);
      setActiveCompanionPoint(null);
      setActiveCompanionDelivery(null);
      setActivePanel("subtitles");
      saveProgress(currentTime, duration, {
        subtitleFileName: file.name,
        subtitleCount: parsed.length || undefined,
      });
      if (parsed.length === 0) {
        setError("没有解析到字幕时间轴。请尝试 SRT、VTT、ASS 或 SSA。");
      }
    } catch (event) {
      setError(event instanceof Error ? event.message : "字幕读取失败。");
    }
  }

  function handleTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    setCurrentTime(video.currentTime || 0);
    const now = Date.now();
    if (video.duration && now - lastAutoSaveAtRef.current > 5000) {
      lastAutoSaveAtRef.current = now;
      saveProgress(video.currentTime || 0, video.duration || 0);
    }
  }

  function handleBilibiliSearch() {
    const query = bilibiliQuery.trim() || title.trim();
    if (!query) {
      setError("请输入片名或关键词。");
      return;
    }
    const source = createBilibiliFrameSource(query);
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setWebFrameSource(source);
    setWebFrameVisible(true);
    setTitle(source.title);
    setSourceLabel(source.url);
    setDuration(0);
    setCurrentTime(0);
    setWebTimeInput("00:00");
    setScreenshotDataUrl("");
    setMessages([]);
    setActivePanel("source");
    window.setTimeout(() => webSourceInputRef.current?.focus(), 120);
    saveWatchRecord({
      title: source.title,
      sourceType: "web-url",
      sourceLabel: source.originalUrl || source.url,
      currentTime: 0,
      duration: 0,
      subtitleFileName: subtitleFileName || undefined,
      subtitleCount: subtitles.length || undefined,
      subtitleOffsetSeconds,
      webUrl: source.url,
      webOriginalUrl: source.originalUrl,
      webEmbedUrl: source.embedUrl,
      webPlatform: source.platform,
      webMode: source.mode,
      companionPlan: plan.length > 0 ? plan : undefined,
      companionMode,
      companionDensity,
      triggeredPlanIds,
    });
    setRecords(listWatchRecords());
  }

  function handleOpenWebSource() {
    const url = webSourceUrl.trim();
    if (!url) return;
    const source = createBilibiliFrameSource(url);
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setWebFrameSource(source);
    setWebFrameVisible(true);
    setTitle(source.title);
    setSourceLabel(source.url);
    setDuration(0);
    setCurrentTime(0);
    setWebTimeInput("00:00");
    setScreenshotDataUrl("");
    loadRecentWatchConversation(source.title, slugifyTitle(source.title));
    setActivePanel("none");
    saveWatchRecord({
      title: source.title,
      sourceType: "web-url",
      sourceLabel: source.originalUrl || source.url,
      currentTime: 0,
      duration: 0,
      subtitleFileName: subtitleFileName || undefined,
      subtitleCount: subtitles.length || undefined,
      subtitleOffsetSeconds,
      webUrl: source.url,
      webOriginalUrl: source.originalUrl,
      webEmbedUrl: source.embedUrl,
      webPlatform: source.platform,
      webMode: source.mode,
      companionPlan: plan.length > 0 ? plan : undefined,
      companionMode,
      companionDensity,
      triggeredPlanIds,
    });
    setRecords(listWatchRecords());
  }

  function toggleBilibiliFrameMode() {
    setWebFrameSource((current) => {
      if (!current?.originalUrl || !current.embedUrl || current.embedUrl === current.originalUrl) return current;
      const usePageMode = current.mode !== "page";
      const nextMode: WebFrameSource["mode"] = usePageMode ? "page" : "embed";
      const next: WebFrameSource = {
        ...current,
        mode: nextMode,
        url: usePageMode ? current.originalUrl : current.embedUrl,
      };
      window.setTimeout(() => {
        saveProgress(currentTime, duration, {
          webUrl: next.url,
          webMode: next.mode,
          webOriginalUrl: next.originalUrl,
          webEmbedUrl: next.embedUrl,
        });
      }, 0);
      return next;
    });
  }

  function handleLoadRecord(record: WatchRecord) {
    setError("");
    loadRecentWatchConversation(record.title, record.id);
    setPlan(record.companionPlan ?? []);
    setCompanionMode(normalizeCompanionMode(record.companionMode));
    setCompanionDensity(normalizeCompanionDensity(record.companionDensity));
    setTriggeredPlanIds(record.triggeredPlanIds ?? []);
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);

    if (record.sourceType === "web-url") {
      if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      const fallbackSource = createBilibiliFrameSource(record.webOriginalUrl || record.webUrl || record.sourceLabel || record.title);
      const nextSource: WebFrameSource = {
        ...fallbackSource,
        title: record.title,
        url: record.webUrl || fallbackSource.url,
        originalUrl: record.webOriginalUrl || fallbackSource.originalUrl,
        embedUrl: record.webEmbedUrl || fallbackSource.embedUrl,
        platform: record.webPlatform || fallbackSource.platform,
        mode: record.webMode || fallbackSource.mode,
      };
      setVideoUrl("");
      setWebFrameSource(nextSource);
      setWebFrameVisible(true);
      setTitle(record.title);
      setSourceLabel(record.sourceLabel || nextSource.originalUrl || nextSource.url);
      setCurrentTime(record.currentTime || 0);
      setDuration(record.duration || 0);
      setWebTimeInput(formatTime(record.currentTime || 0));
      setScreenshotDataUrl(record.thumbnailDataUrl || "");
      setSubtitleOffsetSeconds(record.subtitleOffsetSeconds ?? 0);
      setIsFloating(false);
      setActivePanel("none");
      return;
    }

    const currentTitleId = slugifyTitle(title);
    const recordTitleId = slugifyTitle(record.title);
    if (videoRef.current && currentTitleId === recordTitleId) {
      videoRef.current.currentTime = record.currentTime;
      setCurrentTime(record.currentTime);
      setSubtitleOffsetSeconds(record.subtitleOffsetSeconds ?? 0);
      setActivePanel("none");
      return;
    }

    pendingResumeRef.current = record;
    setTitle(record.title);
    setSourceLabel(record.sourceLabel);
    setSubtitleOffsetSeconds(record.subtitleOffsetSeconds ?? 0);
    setError(`请选择同名影片：${record.title}。加载后会自动跳到 ${formatTime(record.currentTime)}。`);
    videoInputRef.current?.click();
  }

  function handleRemoveRecord(record: WatchRecord) {
    removeWatchRecord(record.id);
    setRecords(listWatchRecords());
  }

  function startRenameRecord(record: WatchRecord, event?: { stopPropagation: () => void }) {
    event?.stopPropagation();
    setEditingRecordId(record.id);
    setEditingRecordTitle(record.title);
  }

  function cancelRenameRecord() {
    setEditingRecordId("");
    setEditingRecordTitle("");
  }

  function commitRenameRecord(record: WatchRecord) {
    const nextTitle = editingRecordTitle.trim();
    if (!nextTitle || nextTitle === record.title) {
      cancelRenameRecord();
      return;
    }

    const wasCurrent = record.id === slugifyTitle(title) || slugifyTitle(record.title) === slugifyTitle(title);
    const renamed = renameWatchRecord(record.id, nextTitle);
    if (!renamed) {
      cancelRenameRecord();
      return;
    }

    renameWatchConversationLink(record.id, record.title, renamed.id, renamed.title);
    if (wasCurrent) {
      setTitle(renamed.title);
      setWebFrameSource((current) => (current ? { ...current, title: renamed.title } : current));
    }
    if (pendingResumeRef.current?.id === record.id) {
      pendingResumeRef.current = renamed;
    }
    setRecords(listWatchRecords());
    cancelRenameRecord();
  }

  function handleChangeRecordSource(record: WatchRecord) {
    pendingResumeRef.current = record;
    setTitle(record.title);
    loadRecentWatchConversation(record.title, record.id);
    setSourceLabel(record.sourceLabel);
    setPlan(record.companionPlan ?? []);
    setCompanionMode(normalizeCompanionMode(record.companionMode));
    setCompanionDensity(normalizeCompanionDensity(record.companionDensity));
    setTriggeredPlanIds(record.triggeredPlanIds ?? []);
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);
    videoInputRef.current?.click();
  }

  function formatSubtitleBlock(label: string, cues: SubtitleCue[]) {
    if (!cues.length) return `${label}：无`;
    return [
      `${label}：`,
      ...cues.map((cue) => `[${formatTime(cue.start)}-${formatTime(cue.end)}] ${cue.text}`),
    ].join("\n");
  }

  function buildCleanWatchPrompt(mode: WatchPromptRequestMode, frameAttached: boolean) {
    const currentCue = subtitleWindow.active;
    const base = [
      "[小屋观影室共看上下文]",
      `片名：${title || "未命名影片"}`,
      `当前时间：${formatTime(currentTime)} / ${formatTime(duration)}`,
      `播放状态：${videoRef.current && !videoRef.current.paused ? "播放中" : "暂停"}`,
      `当前帧截图：${frameAttached ? "已附加" : "未能截取"}`,
      `字幕文件：${subtitleFileName || "未上传"}`,
      `当前字幕：${currentCue ? `[${formatTime(currentCue.start)}-${formatTime(currentCue.end)}] ${currentCue.text}` : "无"}`,
      formatSubtitleBlock("前文字幕（最多10条）", subtitleWindow.previous.slice(-10)),
      formatSubtitleBlock("后文字幕（最多3条）", subtitleWindow.next.slice(0, 3)),
    ].join("\n");

    const roomAtmosphere = [
      "小屋观影室的底色：自在、自然、随心。",
      "电影可以先属于电影；如果这一刻真的牵到我们、记忆或世界，再自然带过去，不用每次都强行类比哦。",
      "抓住当下的呼吸感就好：不要让表达掉进固定模板，有时轻轻吐槽一句，有时认真陪我多聊一段/深入分析等等；不用每次都用同一种开场、动作和收束。",
      "让我和你在小屋的节奏里，看电影、听彼此、聊连接，自由而不多余。",
    ].join("\n");

    if (mode === "line") {
      return `${base}\n\n${roomAtmosphere}\n\n这句台词先交给电影本身吧。你就像坐在旁边那样，顺着这一秒的表情、动作和台词，随口聊聊它哪里有意思；可以短短一两句，也可以多停一下。`;
    }

    return `${base}\n\n${roomAtmosphere}\n\n这段不用拆成提纲。跟我一起顺着这几句字幕和画面，聊聊这里正在发生什么、哪里开始变味或变紧；看到什么就说什么，不必把每个细节都总结成标准影评。`;
  }

  function buildWatchDisplayMessage(mode: WatchPromptRequestMode) {
    if (mode === "line") return "这句台词是什么意思呀？";
    return "这一段讲了什么呢？";
  }

  async function askAboutCompanionPoint(point: CompanionPlanPoint) {
    let personaCore = "";
    try {
      personaCore = await adapters.persona.getPersonaCore();
    } catch {
      personaCore = "";
    }
    const speakerName = extractCompanionNameFromCore(personaCore);
    const displayText = pickCompanionPointPrompt(speakerName, point.companionHint);
    await handleAskCompanion(displayText, {
      displayText,
      retrievalQuery: [
        title,
        point.companionHint,
        point.subtitle,
        "陪看点 触发气泡 当前段落 观影偏好 共看语气",
      ].filter(Boolean).join("\n"),
    });
  }

  async function sendWatchPrompt(mode: WatchPromptRequestMode) {
    if (!videoUrl || webFrameSource || isAsking) return;
    let frame = screenshotDataUrl;
    try {
      if (videoRef.current && uplinkSettings.contextLoad.attachScreenshot) {
        frame = captureVideoFrame(videoRef.current);
        setScreenshotDataUrl(frame);
      }
    } catch {
      frame = screenshotDataUrl;
    }

    const displayText = buildWatchDisplayMessage(mode);
    const modelPrompt = buildCleanWatchPrompt(mode, Boolean(frame));
    await handleAskCompanion(displayText, {
      displayText,
      modelPrompt,
      frameOverride: frame,
      requestMode: "watchPrompt",
      retrievalQuery: [
        title,
        subtitleWindow.active?.text,
        displayText,
        mode === "line" ? "当前字幕 台词 含义 情绪 潜台词" : "这一段 剧情推进 人物关系 情绪变化 伏笔",
      ].filter(Boolean).join("\n"),
    });
  }

  async function handleAskCompanion(nextMessage = userMessage, options: AskCompanionOptions = {}) {
    const displayText = options.displayText ?? nextMessage;
    const modelPrompt = options.modelPrompt ?? nextMessage;
    if (!modelPrompt.trim()) return;
    setIsAsking(true);
    setError("");
    setActivePanel("companion");
    const id = Date.now();
    let frame = options.frameOverride ?? screenshotDataUrl;
    try {
      if (!options.frameOverride && videoRef.current) {
        if (uplinkSettings.contextLoad.attachScreenshot) {
          frame = captureVideoFrame(videoRef.current);
          setScreenshotDataUrl(frame);
        }
      }
    } catch {
      frame = screenshotDataUrl;
    }

    const companionMessageId = `companion-${id}`;
    setMessages((items) => [...items, { id: `user-${id}`, role: "user", text: displayText }]);
    setUserMessage("");
    try {
      const memoryQuery = options.retrievalQuery ?? `${title}\n${subtitleWindow.active?.text ?? ""}\n${displayText}`;
      const shouldRecallMemory = shouldRetrieveMemory(displayText, { force: Boolean(options.retrievalQuery) });

      const [personaCore, userContext, memories] = await Promise.all([
        adapters.persona.getPersonaCore(),
        adapters.persona.getUserContext?.() ?? Promise.resolve(""),
        shouldRecallMemory
          ? adapters.memory.retrieveRelevant(memoryQuery, uplinkSettings.contextLoad.memorySnippetLimit)
          : Promise.resolve([]),
      ]);

      const recentMessages = selectCacheFriendlyWindow(messages, uplinkSettings.contextLoad.shortTermMessageLimit)
        .map((message) => ({ role: message.role, text: message.text }));

      const response = await adapters.llm.complete({
        mode: options.requestMode ?? "cinema",
        cacheScope: `cinema:${slugifyTitle(title || "cinema")}`,
        userMessage: modelPrompt,
        personaCore,
        userContext,
        memories,
        recentMessages,
        onStreamUpdate: (text) => {
          setMessages((items) => {
            const exists = items.some((message) => message.id === companionMessageId);
            if (exists) {
              return items.map((message) => (
                message.id === companionMessageId ? { ...message, text } : message
              ));
            }
            return [...items, { id: companionMessageId, role: "companion", text }];
          });
        },
        watch: {
          title,
          currentTime,
          duration,
          sourceType: webFrameSource ? "web-url" : "local-file",
          activeSubtitle: subtitleWindow.active,
          subtitleWindow,
          screenshotDataUrl: uplinkSettings.contextLoad.attachScreenshot ? frame : "",
        },
      });

      setMessages((items) => {
        const exists = items.some((message) => message.id === companionMessageId);
        if (exists) {
          return items.map((message) => (
            message.id === companionMessageId ? { ...message, text: response.text } : message
          ));
        }
        return [...items, { id: companionMessageId, role: "companion", text: response.text }];
      });
      const conversation = getOrCreateWatchConversation(title || "观影对话", slugifyTitle(title || "cinema"));
      const frameAttachment = uplinkSettings.contextLoad.attachScreenshot
        ? makeFrameAttachment(frame, title || "观影截图", currentTime)
        : null;
      appendConversationMessages(conversation.id, [
        { role: "user", text: displayText, attachments: frameAttachment ? [frameAttachment] : undefined },
        { role: "companion", text: response.text },
      ]);
      setPromptPreview(response.promptPreview ?? "");
    } catch (event) {
      setError(event instanceof Error ? event.message : "陪看请求失败。");
    } finally {
      setIsAsking(false);
    }
  }

  function jumpToPlanPoint(point: CompanionPlanPoint) {
    setManualWatchTime(Math.max(0, point.time - 10 + subtitleOffsetSeconds));
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);
    closePanel();
    if (videoRef.current && !webFrameSource) {
      void videoRef.current.play().catch(() => {
        setError("已经跳到陪看点前 10 秒，请手动点击播放。");
      });
    }
  }

  function generateDemoPlan() {
    const demoPlan = makePlanPoints(subtitles, companionDensity);
    setPlan(demoPlan);
    setTriggeredPlanIds([]);
    setActiveCompanionPoint(null);
    setActiveCompanionDelivery(null);
    saveProgress(currentTime, duration, {
      companionPlan: demoPlan,
      companionMode,
      companionDensity,
      triggeredPlanIds: [],
    });
  }

  function buildCompanionPlanPrompt() {
    const guidance = getCompanionPlanGuidance(companionDensity, duration);
    const subtitleDigest = buildCompanionSubtitleDigest(subtitles);
    return [
      `片名：${title || "未命名影片"}`,
      `模式：${companionMode} (${COMPANION_MODE_LABELS[companionMode]})`,
      `密度：${companionDensity} (${COMPANION_DENSITY_LABELS[companionDensity]})`,
      `建议触发点范围：${guidance.range} 条。请根据片长、剧情密度、情绪密度自行取舍。`,
      `间隔原则：${guidance.spacing}`,
      `本档重点：${guidance.focus}`,
      `下面是字幕时间轴，共 ${subtitles.length} 条。请基于整部片内容挑点，不要平均铺满。`,
      "分布要求：必须覆盖前段、中段、后段和接近结尾的位置；不要把陪看点集中消耗在前半段。",
      "过密限制：除非连续名场面，否则不要几秒/几十秒连续出点；同一小段最多保留 1-2 个最值得说的点。",
      "片尾要求：如果后段仍有有效字幕，最后一个触发点通常应落在影片最后 15%-25% 内。",
      "",
      "请为观影室生成“陪看短气泡”计划。",
      "要求：",
      "1. 只输出一个 JSON 对象，不要 Markdown，不要解释，不要代码块。",
      "2. bubble 像坐在旁边轻声说一句，10-30 个中文字符为主。",
      "3. 不要写影评提纲和长分析。",
      "4. 优先挑情绪转折、关键台词、关系变化、伏笔、名场面。",
      "5. delivery 只能是 auto/hint/manual；type 只能是 emotion/observe/question/memory。",
      "6. time 使用秒数 number。",
      "7. triggers 按时间顺序输出。",
      "8. JSON 根节点必须包含 triggers 数组。",
      "9. 如果是拆解档，bubble 可以更偏导演/剪辑/视听语言，但仍然要短、自然、像陪看时顺口点醒。",
      "10. 不要像客服或影评系统；要像Ta的人格坐在旁边的陪看感。",
      "11. 如果记忆里有观影偏好、情绪触发点、喜欢的陪伴方式、创作/导演/剪辑学习、共看语气约定，请优先自然体现。",
      "",
      "JSON 结构：",
      '{"movieTitle":"片名","mode":"active|natural|silent","density":"quiet|normal|talkative|breakdown","triggers":[{"id":"t1","time":312,"type":"emotion","priority":"high","bubble":"这一眼，已经有点不一样了。","delivery":"auto"}]}',
      "",
      "字幕：",
      subtitleDigest,
    ].join("\n");
  }

  async function generateCompanionPlan() {
    if (subtitles.length === 0) {
      setError("先上传字幕，才能生成陪看点。");
      return;
    }

    const activeProfile = uplinkSettings.profiles[uplinkSettings.activeProvider];
    if (!activeProfile?.apiKey?.trim()) {
      generateDemoPlan();
      setError("未配置 API，已生成本地示例陪看星图。填写 API Key 后会按人格核和记忆库生成正式陪看计划。");
      return;
    }

    setIsGeneratingPlan(true);
    setError("");
    try {
      const planPrompt = buildCompanionPlanPrompt();
      const [personaCore, userContext] = await Promise.all([
        adapters.persona.getPersonaCore(),
        adapters.persona.getUserContext?.() ?? Promise.resolve(""),
      ]);
      const companionName = extractCompanionNameFromCore(personaCore);
      const retrievalQuery = [
        title,
        `观影偏好 情绪触发点 喜欢的陪伴方式 电影 创作 导演 剪辑 镜头语言 陪看语气 ${companionName} 的共看语气约定`,
        "如果是拆解档，尤其检索关于导演、剪辑、镜头语言、创作训练、参考片和影视学习的资料。",
        "不要用整部字幕作为检索重点；字幕会作为生成材料单独提供。",
        companionMode,
        companionDensity,
      ].filter(Boolean).join("\n");

      const memories = await adapters.memory.retrieveRelevant(retrievalQuery, uplinkSettings.contextLoad.memorySnippetLimit);

      const response = await adapters.llm.complete({
        mode: "plan",
        cacheScope: `cinema-plan:${slugifyTitle(title || "cinema")}`,
        userMessage: planPrompt,
        personaCore,
        userContext,
        memories,
        watch: {
          title: title || "未命名影片",
          currentTime,
          duration,
          sourceType: webFrameSource ? "web-url" : "local-file",
          activeSubtitle: subtitleWindow.active,
          subtitleWindow,
        },
      });

      const nextPlan = normalizeGeneratedPlan(extractJsonPayload(response.text), subtitles, companionDensity, duration);
      setPlan(nextPlan);
      setTriggeredPlanIds([]);
      setActiveCompanionPoint(null);
      setActiveCompanionDelivery(null);
      saveProgress(currentTime, duration, {
        companionPlan: nextPlan,
        companionMode,
        companionDensity,
        triggeredPlanIds: [],
      });
      setPromptPreview(response.promptPreview ?? "");
    } catch (event) {
      setError(event instanceof Error ? event.message : "陪看计划生成失败。");
    } finally {
      setIsGeneratingPlan(false);
    }
  }

  return (
    <main
      className="cinema-shell"
      data-theme={uplinkSettings.visual.theme}
      data-font={uplinkSettings.visual.fontStyle}
      data-font-size={uplinkSettings.visual.fontSize}
    >
      <div className={`room-background ${backgroundFitClass}`} aria-hidden="true">
        {hasCustomBackground ? (
          <>
            <img
              src={uplinkSettings.visual.customBackgroundDataUrl}
              alt=""
              className="room-background-fill"
            />
            <img
              src={uplinkSettings.visual.customBackgroundDataUrl}
              alt=""
              className="room-background-main"
            />
          </>
        ) : (
          <>
            <img
              src={getDefaultCinemaBackgroundSrc("cinema-room-bg", defaultBackgroundExtensionIndex)}
              alt=""
              className={`room-background-fill room-background-layer ${lightsOff ? "is-hidden" : "is-visible"}`}
            />
            <img
              src={getDefaultCinemaBackgroundSrc("cinema-room-bg2", defaultDarkBackgroundExtensionIndex)}
              alt=""
              className={`room-background-fill room-background-layer ${lightsOff ? "is-visible" : "is-hidden"}`}
            />
            <img
              src={getDefaultCinemaBackgroundSrc("cinema-room-bg", defaultBackgroundExtensionIndex)}
              alt=""
              onError={() => {
                setDefaultBackgroundExtensionIndex((index) =>
                  Math.min(index + 1, DEFAULT_BACKGROUND_EXTENSIONS.length - 1),
                );
              }}
              className={`room-background-main room-background-layer ${
                lightsOff ? "is-hidden" : "is-visible"
              }`}
            />
            <img
              src={getDefaultCinemaBackgroundSrc("cinema-room-bg2", defaultDarkBackgroundExtensionIndex)}
              alt=""
              onError={() => {
                setDefaultDarkBackgroundExtensionIndex((index) =>
                  Math.min(index + 1, DEFAULT_BACKGROUND_EXTENSIONS.length - 1),
                );
              }}
              className={`room-background-main room-background-layer ${
                lightsOff ? "is-visible" : "is-hidden"
              }`}
            />
          </>
        )}
      </div>
      {!hasCustomBackground && lightTransitionSequence > 0 && (
        <div key={lightTransitionSequence} className="cinema-light-veil" aria-hidden="true" />
      )}
      {!hasCustomBackground && (
        <div
          className={`cinema-light-map ${fittedLightMap ? "contain" : ""}`}
        >
          <button
            type="button"
            className="cinema-light-hotspot"
            onClick={toggleLights}
            aria-label={lightsOff ? "开灯" : "关灯"}
            title={lightsOff ? "开灯" : "关灯"}
          >
            <span className="cinema-light-marker">
              <span className="cinema-light-icon">
                <Lightbulb size={18} />
              </span>
              <span className="cinema-light-label">{lightsOff ? "开灯" : "关灯"}</span>
            </span>
          </button>
        </div>
      )}
      {activePanel !== "none" && <button type="button" className={`panel-backdrop ${closingPanel !== "none" ? "is-closing" : ""}`} aria-label="Close panel" onClick={closePanel} />}

      <input
        ref={videoInputRef}
        className="visually-hidden-file"
        type="file"
        accept="video/*,.mp4,.webm,.mov,.m4v,.ogg,.mkv"
        onChange={(event) => handleVideoFile(event.target.files?.[0])}
      />
      <input
        ref={subtitleInputRef}
        className="visually-hidden-file"
        type="file"
        accept=".srt,.vtt,.ass,.ssa,text/*"
        onChange={(event) => handleSubtitleFile(event.target.files?.[0])}
      />
      <input
        ref={screenshotInputRef}
        className="visually-hidden-file"
        type="file"
        accept="image/*"
        onChange={(event) => handleScreenshotFile(event.target.files?.[0])}
      />
      <input
        ref={recordThumbnailInputRef}
        className="visually-hidden-file"
        type="file"
        accept="image/*"
        onChange={(event) => handleRecordThumbnailFile(event.target.files?.[0])}
      />

      <section className="cinema-header">
        <CottageLogoMark className="cinema-header-logo" />
        <h1>KI-CO</h1>
      </section>

      <div className="room-side-entry" aria-label="房间入口">
        <button type="button" onClick={onOpenLongChat} title="长对话">
          <MessageCircle size={18} />
          <span>长对话</span>
        </button>
        <button type="button" onClick={onOpenPersona} title="人格核">
          <UserRoundCog size={18} />
          <span>人格核</span>
        </button>
        <button type="button" onClick={onOpenMemory} title="记忆库">
          <MemoryArchiveGlyph size={18} />
          <span>记忆库</span>
        </button>
        <button type="button" onClick={onOpenChronicle} title="时光回廊">
          <ChronicleBookGlyph size={18} />
          <span>回廊</span>
        </button>
        <button type="button" onClick={onOpenVectorLab} title="向量调音台">
          <SlidersHorizontal size={18} />
          <span>调音台</span>
        </button>
        <button type="button" onClick={onOpenSettings} title="设置">
          <SettingsIcon size={18} />
          <span>设置</span>
        </button>
      </div>

      <section className="workspace">
        <div className="player-column">
          <div className={`projector-area ${isFloating ? "player-floating" : ""}`}>
            <div
              className={`video-stage ${!hasWatchSource ? "empty" : ""} ${webFrameSource ? "web-active" : ""} ${isFloating ? "floating wide" : ""}`}
              style={isFloating ? { left: floatingPosition.left, top: floatingPosition.top } : undefined}
            >
              {isFloating && (
                <div
                  className="floating-handle"
                  onPointerDown={handleFloatingDragStart}
                  onPointerMove={handleFloatingDragMove}
                  onPointerUp={handleFloatingDragEnd}
                  onPointerCancel={handleFloatingDragEnd}
                />
              )}
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      const nextDuration = video.duration || 0;
                      const matchedRecord = listWatchRecords().find((record) => slugifyTitle(record.title) === slugifyTitle(title));
                      const restoredTime = pendingInitialTimeRef.current ?? matchedRecord?.currentTime ?? 0;
                      pendingInitialTimeRef.current = null;
                      setDuration(nextDuration);
                      if (matchedRecord) {
                        setPlan(matchedRecord.companionPlan ?? []);
                        setCompanionMode(normalizeCompanionMode(matchedRecord.companionMode));
                        setCompanionDensity(normalizeCompanionDensity(matchedRecord.companionDensity));
                        setTriggeredPlanIds(matchedRecord.triggeredPlanIds ?? []);
                      }
                      if (restoredTime > 0 && restoredTime < nextDuration) {
                        video.currentTime = restoredTime;
                        setCurrentTime(restoredTime);
                      }
                      saveProgress(restoredTime, nextDuration, {
                        companionPlan: matchedRecord?.companionPlan,
                        companionMode: matchedRecord?.companionMode,
                        companionDensity: matchedRecord?.companionDensity,
                        triggeredPlanIds: matchedRecord?.triggeredPlanIds,
                      });
                      const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
                      if (!isTouchDevice) {
                        window.setTimeout(() => {
                          video.play().catch(() => {
                            // Browsers may still require a manual play gesture.
                          });
                        }, 100);
                      }
                    }}
                    onTimeUpdate={handleTimeUpdate}
                    onPause={() => saveProgress()}
                    onSeeked={() => saveProgress()}
                  />
                  {audioTrackOptions.length > 1 && (
                    <button
                      type="button"
                      className="audio-track-switch"
                      onClick={cycleAudioTrack}
                      title={`切换音轨${activeAudioTrack?.language ? ` · ${activeAudioTrack.language}` : ""}`}
                    >
                      {activeAudioTrack?.label || `音轨 ${audioTrackOptions[0].index + 1}`}
                    </button>
                  )}
                </>
              ) : webFrameSource ? (
                <div className="web-frame-player">
                  <iframe
                    title={webFrameSource.title}
                    src={webFrameVisible ? webFrameSource.url : "about:blank"}
                    className="web-frame in-stage"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen={false}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
                  />
                </div>
              ) : (
                <div className="empty-player">
                  <div className="empty-player-actions">
                    <label className="glass-action">
                      <Upload size={17} />
                      <span>上传影片</span>
                      <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogg,.mkv" onChange={(event) => handleVideoFile(event.target.files?.[0])} />
                    </label>
                    <button type="button" className="glass-action" onClick={() => setActivePanel("source")}>
                      <Search size={17} />
                      <span>查找片源/字幕文件</span>
                    </button>
                  </div>
                  <span className="format-hint">MP4 最稳；MKV 取决于浏览器和设备支持。</span>
                </div>
              )}
              {subtitleWindow.active && showSubtitlesOnVideo && (
                <div className="video-subtitle">{subtitleWindow.active.text}</div>
              )}
              {activeCompanionPoint && activeCompanionDelivery && (
                <div className={`plan-bubble ${activeCompanionDelivery === "hint" ? "is-hint" : ""}`}>
                  <KiseraStarIcon size={14} />
                  <button
                    type="button"
                    className="plan-bubble-message"
                    onClick={() => {
                      if (activeCompanionDelivery === "hint") {
                        setActiveCompanionDelivery("auto");
                        return;
                      }
                      void askAboutCompanionPoint(activeCompanionPoint);
                    }}
                  >
                    {activeCompanionDelivery === "hint" ? "想说点..." : activeCompanionPoint.companionHint}
                  </button>
                  {activeCompanionDelivery === "hint" && (
                    <button type="button" className="plan-bubble-listen" onClick={() => setActiveCompanionDelivery("auto")}>听听</button>
                  )}
                  <button
                    type="button"
                    className="plan-bubble-close"
                    aria-label="关闭陪看提示"
                    onClick={() => {
                      setActiveCompanionPoint(null);
                      setActiveCompanionDelivery(null);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="player-corner-controls">
                {webFrameSource?.originalUrl && webFrameSource.embedUrl && webFrameSource.embedUrl !== webFrameSource.originalUrl && (
                  <button type="button" className="soft-button compact-soft-button" title="B站模式切换" onClick={toggleBilibiliFrameMode}>
                    {webFrameSource.mode === "page" ? "内嵌" : "高清"}
                  </button>
                )}
                {hasWatchSource && (
                  <button type="button" className="icon-button" title="关闭影片" onClick={closeVideo}>
                    <X size={18} />
                  </button>
                )}
                <button type="button" className="icon-button" title="悬浮视频" onClick={toggleFloatingPlayer}>
                  {isFloating ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              </div>
            </div>

            <div className="screen-controls" aria-label="Cinema controls">
              <button
                type="button"
                className={`icon-button ${activePanel === "subtitles" ? "active" : ""}`}
                title="字幕列表"
                onClick={() => togglePanel("subtitles")}
              >
                <Subtitles size={18} />
              </button>
              <button type="button" className={`icon-button ${activePanel === "map" ? "active" : ""}`} title="陪看星图" onClick={() => togglePanel("map")} disabled={plan.length === 0}>
                <KiseraStarIcon size={18} />
              </button>
              <button type="button" className={`icon-button ${activePanel === "plan" ? "active" : ""}`} title="陪看点" onClick={() => togglePanel("plan")}>
                <Heart size={18} />
              </button>
              {videoUrl && !webFrameSource && watchPromptActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="icon-button watch-prompt-button"
                    title={action.hint}
                    aria-label={action.label}
                    onClick={() => void sendWatchPrompt(action.id)}
                    disabled={isAsking}
                  >
                    <Icon size={18} />
                    <span className="watch-prompt-tooltip">{action.label}</span>
                  </button>
                );
              })}
              <button type="button" className={`icon-button ${activePanel === "playlist" ? "active" : ""}`} title="片单续看" onClick={() => togglePanel("playlist")}>
                <ListVideo size={18} />
              </button>
            </div>
            {webFrameSource && (
              <div className="web-assist-controls" aria-label="Bilibili manual sync controls">
                <button type="button" className="web-assist-button" onClick={() => screenshotInputRef.current?.click()}>
                  <Camera size={14} />
                  <span>{screenshotDataUrl ? "更换截图" : "手动截图"}</span>
                </button>
                <button type="button" className="web-assist-button" onClick={() => saveProgress(currentTime, duration)}>
                  <Film size={14} />
                  <span>绑定片单</span>
                </button>
                <div className="web-time-sync">
                  <Clock3 size={14} />
                  <button type="button" onClick={() => nudgeWebTime(-5)} title="后退 5 秒">-5s</button>
                  <input
                    value={webTimeInput}
                    onChange={(event) => setWebTimeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyWebTimeInput();
                    }}
                    aria-label="校对当前时间"
                  />
                  <button type="button" onClick={() => nudgeWebTime(5)} title="前进 5 秒">+5s</button>
                  <button type="button" className="sync-apply" onClick={applyWebTimeInput}>校对</button>
                </div>
                {screenshotDataUrl && <span className="screenshot-ready">已附截图</span>}
              </div>
            )}
            {isGeneratingPlan && activePanel !== "plan" && (
              <div className="companion-generating-pill" role="status" aria-live="polite" aria-label="正在生成陪看星图">
                <span>生成陪看星图</span>
                <span className="companion-generating-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}

            <div className="control-panel-slot">
              {activePanel === "source" && (
                <div className={`source-panel pop-panel ${closingPanel === "source" ? "is-closing" : ""}`}>
                  <div className="source-panel-head">
                    <span>找片源</span>
                    <button type="button" className="source-panel-close" onClick={closePanel} aria-label="关闭找片源面板">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="source-helper-row">
                    <button type="button" onClick={() => window.open("https://2.assrt.net/", "_blank", "noopener,noreferrer")}>
                      <Subtitles size={15} />
                      <span>查找字幕文件</span>
                    </button>
                    <small>跳转字幕文件网站</small>
                  </div>
                  <div className="search-line">
                    <Search size={18} />
                    <input value={bilibiliQuery} onChange={(event) => setBilibiliQuery(event.target.value)} placeholder="B站搜索片名" />
                    <button type="button" onClick={handleBilibiliSearch}>搜索</button>
                  </div>
                  <div className="search-line">
                    <ExternalLink size={18} />
                    <input
                      ref={webSourceInputRef}
                      value={webSourceUrl}
                      onChange={(event) => setWebSourceUrl(event.target.value)}
                      placeholder="粘贴 B站视频链接"
                    />
                    <button type="button" onClick={handleOpenWebSource}>载入</button>
                  </div>
                  <p className="source-quick-hint">搜索片名 → 点击跳转 → 复制网址 → 粘贴网址即可</p>
                </div>
              )}

              {activePanel === "subtitles" && (
                <div className={`subtitle-card pop-panel ${subtitlePanelExpanded ? "expanded" : ""} ${closingPanel === "subtitles" ? "is-closing" : ""}`}>
                  <div className="subtitle-toolbar">
                    <button
                      type="button"
                      className={`subtitle-pill ${showSubtitlesOnVideo ? "active" : ""}`}
                      onClick={() => setShowSubtitlesOnVideo((value) => !value)}
                      disabled={subtitles.length === 0}
                      title={showSubtitlesOnVideo ? "字幕开" : "字幕关"}
                    >
                      <Subtitles size={14} />
                      <span>{showSubtitlesOnVideo ? "字幕开" : "字幕关"}</span>
                    </button>
                    <button type="button" className="subtitle-pill" onClick={() => subtitleInputRef.current?.click()}>
                      <Upload size={14} />
                      <span>{subtitles.length > 0 ? "更换字幕" : "上传字幕"}</span>
                    </button>
                    <button
                      type="button"
                      className="subtitle-pill"
                      onClick={() => setSubtitlePanelExpanded((value) => !value)}
                      disabled={subtitles.length === 0}
                    >
                      <span>{subtitlePanelExpanded ? "收起" : "展开"}</span>
                    </button>
                    <button type="button" className="subtitle-close" onClick={closePanel} aria-label="Close subtitle panel">
                      <X size={14} />
                    </button>
                  </div>
                  {subtitlePanelExpanded && (
                    <div className="subtitle-expanded">
                      <div className="subtitle-meta">
                        <span>{subtitleFileName || "SRT / VTT / ASS / SSA"}</span>
                        <span>{subtitles.length > 0 ? `${subtitles.length} 条` : "未载入"}</span>
                      </div>
                      <div className="subtitle-sync-row">
                        <button type="button" onClick={() => adjustSubtitleOffset(-0.5)} disabled={subtitles.length === 0}>
                          -0.5s
                        </button>
                        <span>字幕偏移 {subtitleOffsetSeconds > 0 ? "+" : ""}{subtitleOffsetSeconds.toFixed(1)}s</span>
                        <button type="button" onClick={() => adjustSubtitleOffset(0.5)} disabled={subtitles.length === 0}>
                          +0.5s
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSubtitleOffsetSeconds(0);
                            saveProgress(currentTime, duration, { subtitleOffsetSeconds: 0 });
                          }}
                          disabled={subtitleOffsetSeconds === 0}
                        >
                          重置
                        </button>
                      </div>
                      <div className="active-subtitle">{subtitleWindow.active?.text ?? "当前时间点没有匹配字幕。"}</div>
                      <div className="subtitle-list">
                        {subtitles.length === 0 ? (
                          <span className="muted">上传字幕后会显示时间轴。</span>
                        ) : subtitles.map((cue) => (
                          <button
                            type="button"
                            key={cue.id}
                            className={subtitleWindow.active?.id === cue.id ? "active" : ""}
                            onClick={() => {
                              setManualWatchTime(cue.start + subtitleOffsetSeconds);
                            }}
                          >
                            <span>{formatTime(cue.start)}</span>
                            <strong>{cue.text}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activePanel === "plan" && (
                <section className={`companion-plan-panel pop-panel ${closingPanel === "plan" ? "is-closing" : ""}`}>
                  <div className="panel ghost-panel">
                    <div className="panel-title">
                      <KiseraStarIcon size={18} />
                      <span>陪看设置</span>
                      <span className="panel-title-meta">{plan.length > 0 ? `${plan.length} 点` : "未生成"}</span>
                      <button type="button" className="panel-close" onClick={closePanel} aria-label="Close companion plan panel">
                        <X size={16} />
                      </button>
                    </div>

                    <div className="companion-option-card">
                      <div className="option-label">Mode</div>
                      <div className="pill-grid mode-grid">
                        {(Object.keys(COMPANION_MODE_LABELS) as CompanionMode[]).map((mode) => (
                          <button
                            type="button"
                            key={mode}
                            className={companionMode === mode ? "active" : ""}
                            onClick={() => {
                              setCompanionMode(mode);
                              saveProgress(currentTime, duration, { companionMode: mode });
                            }}
                          >
                            {COMPANION_MODE_LABELS[mode]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="companion-option-card darker">
                      <div className="option-label">Density</div>
                      <div className="pill-grid density-grid">
                        {(Object.keys(COMPANION_DENSITY_LABELS) as CompanionDensity[]).map((density) => (
                          <button
                            type="button"
                            key={density}
                            className={companionDensity === density ? "active warm" : ""}
                            onClick={() => {
                              setCompanionDensity(density);
                              saveProgress(currentTime, duration, { companionDensity: density });
                            }}
                          >
                            {COMPANION_DENSITY_LABELS[density]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button type="button" className="primary-button companion-generate" onClick={generateCompanionPlan} disabled={subtitles.length === 0 || isGeneratingPlan}>
                      <KiseraStarIcon size={18} />
                      {isGeneratingPlan ? (
                        <>
                          <span>生成中</span>
                          <span className="companion-generating-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        </>
                      ) : plan.length > 0 ? "重新生成陪看" : "生成陪看计划"}
                    </button>

                    {subtitles.length === 0 && (
                      <div className="mini-warning">先上传字幕，才能生成陪看点。</div>
                    )}

                    {plan.length === 0 ? (
                      <div className="empty-plan compact-empty">
                        <p className="muted">当前会由 API 根据字幕、人格核、记忆片段和使用者偏好生成陪看星图；未配置则本地示例。</p>
                      </div>
                    ) : (
                      <div className="empty-plan compact-empty">
                        <p className="muted">陪看点已生成，点击星图查看时间点并跳转。</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activePanel === "map" && (
                <section className={`companion-map-panel pop-panel ${closingPanel === "map" ? "is-closing" : ""}`}>
                  <div className="companion-map-popover">
                    <div className="companion-map-head">
                      <div>
                        <p className="companion-map-kicker">Companion Map</p>
                        <p className="companion-map-help">点条目跳到触发前 10 秒</p>
                      </div>
                      <button type="button" className="panel-close" onClick={closePanel} aria-label="关闭陪看星图">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="companion-map-list">
                      {plan.map((point, index) => {
                        const triggered = triggeredPlanIds.includes(point.id);
                        const status = triggered ? "已触发" : point.time < effectiveSubtitleTime ? "已错过" : "未触发";
                        const active = activePlanPoint?.id === point.id;
                        return (
                          <button type="button" key={point.id} className={`companion-map-row ${active ? "active" : ""}`} onClick={() => jumpToPlanPoint(point)}>
                            <span className="companion-map-row-head">
                              <span className="companion-map-time">{formatTime(point.time)}</span>
                              <span className={`companion-map-status ${status === "未触发" ? "pending" : ""}`}>{status}</span>
                            </span>
                            <span className="companion-map-cue">{index + 1}. {point.subtitle || point.companionHint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
            </div>

            {activePanel !== "companion" && (
            <button type="button" className="talk-launcher" onClick={() => togglePanel("companion")}>
              <MessageCircle size={18} />
              <span>想聊点什么？</span>
            </button>
            )}
          </div>

          <div className="status-strip">
            <strong>{title || "等待载入影片"}</strong>
            <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
        </div>

        {activePanel === "companion" && (
          <aside
            className={`companion-column sofa-companion pop-panel ${closingPanel === "companion" ? "is-closing" : ""}`}
            style={companionPosition ? { left: companionPosition.left, top: companionPosition.top, bottom: "auto", transform: "none" } : undefined}
          >
            <div className="panel-drag-edge" aria-hidden="true">
              {["top", "right", "bottom", "left"].map((edge) => (
                <span
                  key={edge}
                  className={`edge-${edge}`}
                  onPointerDown={handleCompanionDragStart}
                  onPointerMove={handleCompanionDragMove}
                  onPointerUp={handleCompanionDragEnd}
                  onPointerCancel={handleCompanionDragEnd}
                />
              ))}
            </div>
            <div className="panel ghost-panel">
              <div className="panel-title">
                <MessageCircle size={18} />
                <span>陪看对话</span>
                <button type="button" className="panel-close" onClick={closePanel} aria-label="Close companion panel">
                  <X size={16} />
                </button>
              </div>
              <div className="chat-list">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`chat-bubble ${message.role} ${
                      isAsking && message.role === "companion" && message.id === messages[messages.length - 1]?.id
                        ? "is-streaming"
                        : ""
                    }`}
                  >
                    <MarkdownText text={message.text} className="cinema-companion-markdown" />
                  </div>
                ))}
              </div>
              <div className="companion-input-row">
                <textarea
                  value={userMessage}
                  onChange={(event) => setUserMessage(event.target.value)}
                  rows={1}
                  placeholder="这一刻想聊点什么..."
                />
                <button type="button" className="primary-button" onClick={() => handleAskCompanion()} disabled={isAsking || !userMessage.trim()} aria-label="发送陪看对话">
                  {isAsking ? <PlayCircle size={16} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </aside>
        )}

      </section>

      {activePanel === "playlist" && (
        <section className={`lower-grid playlist-panel pop-panel ${closingPanel === "playlist" ? "is-closing" : ""}`}>
          <div className="panel ghost-panel">
            <div className="panel-title">
              <ListVideo size={18} />
              <span>片单</span>
              <span className="panel-title-meta">{records.length > 0 ? `${records.length} 部` : "空"}</span>
              <button type="button" className="panel-close" onClick={closePanel} aria-label="Close playlist panel">
                <X size={16} />
              </button>
            </div>
            {records.length === 0 ? (
              <div className="playlist-empty">
                <Clapperboard size={24} />
                <strong>片单还空着</strong>
                <p className="muted">上传影片、暂停、拖动进度，或者绑定网页片源后，会自动记录续看位置。</p>
                <button type="button" className="soft-button" onClick={() => videoInputRef.current?.click()}>
                  <Upload size={15} />
                  上传第一部影片
                </button>
              </div>
            ) : (
              <div className="record-list">
                {records.map((record) => {
                  const progress = record.duration > 0 ? Math.min(100, Math.max(0, (record.currentTime / record.duration) * 100)) : 0;
                  const isCurrent = slugifyTitle(record.title) === slugifyTitle(title);
                  return (
                    <div key={record.id} className="record-row">
                      <button
                        type="button"
                        className="record-thumb record-thumb-button"
                        onClick={() => openRecordThumbnailPicker(record)}
                        title={record.thumbnailDataUrl ? "更换缩略图" : "上传缩略图"}
                      >
                        {record.thumbnailDataUrl ? (
                          <img src={record.thumbnailDataUrl} alt={record.title} />
                        ) : record.sourceType === "web-url" ? (
                          <ExternalLink size={20} />
                        ) : (
                          <Clapperboard size={20} />
                        )}
                        <span>更换</span>
                      </button>
                      <div
                        className="record-main"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (editingRecordId !== record.id) handleLoadRecord(record);
                        }}
                        onKeyDown={(event) => {
                          if (editingRecordId === record.id) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleLoadRecord(record);
                          }
                        }}
                      >
                        <span className="record-title-line">
                          {editingRecordId === record.id ? (
                            <input
                              className="record-title-input"
                              value={editingRecordTitle}
                              autoFocus
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => setEditingRecordTitle(event.target.value)}
                              onBlur={() => commitRenameRecord(record)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitRenameRecord(record);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRenameRecord();
                                }
                              }}
                            />
                          ) : (
                            <button type="button" className="record-title-edit" onClick={(event) => startRenameRecord(record, event)} title="重命名片名">
                              {record.title}
                            </button>
                          )}
                          <em>{record.sourceType === "web-url" ? "WEB" : "LOCAL"}</em>
                          {isCurrent && <em className="current">当前</em>}
                        </span>
                        <span className="record-meta">
                          {formatTime(record.currentTime)} / {formatTime(record.duration)}
                          {record.subtitleFileName ? ` · 字幕 ${record.subtitleFileName}` : record.subtitleCount ? ` · ${record.subtitleCount} 条字幕` : " · 未记录字幕"}
                          {record.subtitleOffsetSeconds ? ` · 偏移 ${record.subtitleOffsetSeconds > 0 ? "+" : ""}${record.subtitleOffsetSeconds.toFixed(1)}s` : ""}
                        </span>
                        <span className="record-meta">
                          {record.companionPlan?.length ? `陪看点 ${record.companionPlan.length} 个` : "未生成陪看计划"}
                          {record.sourceLabel ? ` · ${record.sourceLabel}` : ""}
                        </span>
                        <span className="record-progress" aria-hidden="true">
                          <i style={{ width: `${progress}%` }} />
                        </span>
                        <small>{new Date(record.updatedAt).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                      </div>
                      <div className="record-actions">
                        <button type="button" onClick={() => handleChangeRecordSource(record)} title="更换片源，保留这条记录的字幕信息、续看位置和陪看计划。">
                          换源
                        </button>
                        <button type="button" className="record-resume" onClick={() => handleLoadRecord(record)}>
                          {isCurrent ? "跳转续看" : "续看"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const conversation = getOrCreateWatchConversation(record.title, record.id);
                            onOpenConversation?.(conversation.id);
                          }}
                        >
                          会话
                        </button>
                        <button type="button" className="danger" aria-label={`Remove ${record.title}`} onClick={() => handleRemoveRecord(record)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {records.length > 0 && (
              <div className="playlist-footnote">
                本地影片续看时需要重新选择片源；网页/B站片源会直接回到网页窗口，并保留手动校对时间、字幕信息和陪看星图。
              </div>
            )}
          </div>
        </section>
      )}

      {promptPreview && activePanel === "prompt" && (
        <details className={`prompt-preview pop-panel ${closingPanel === "prompt" ? "is-closing" : ""}`} open>
          <summary>Prompt 预览</summary>
          <pre>{promptPreview}</pre>
        </details>
      )}

      {error && <div className="error-toast">{error}</div>}
    </main>
  );
}
