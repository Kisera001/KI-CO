import type { SubtitleCue, SubtitleWindow } from "../types";

function timestampToSeconds(raw: string): number {
  const value = raw.trim().replace(",", ".");
  const parts = value.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(value) || 0;
}

function cleanSubtitleText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parseSrtOrVtt(source: string): SubtitleCue[] {
  const normalized = source
    .replace(/^\uFEFF/, "")
    .replace(/^WEBVTT[^\n]*(\n|$)/i, "")
    .replace(/\r/g, "");

  return normalized
    .split(/\n{2,}/)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return undefined;

      const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
      const text = cleanSubtitleText(lines.slice(timeIndex + 1).join("\n"));
      if (!text) return undefined;

      return {
        id: `cue-${index}`,
        start: timestampToSeconds(startRaw),
        end: timestampToSeconds(endRaw),
        text,
      };
    })
    .filter((cue): cue is SubtitleCue => Boolean(cue))
    .sort((a, b) => a.start - b.start);
}

function parseAss(source: string): SubtitleCue[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const cues: SubtitleCue[] = [];

  for (const line of lines) {
    if (!line.startsWith("Dialogue:")) continue;
    const body = line.slice("Dialogue:".length).trim();
    const parts = body.split(",");
    if (parts.length < 10) continue;
    const start = timestampToSeconds(parts[1]);
    const end = timestampToSeconds(parts[2]);
    const text = cleanSubtitleText(parts.slice(9).join(","));
    if (!text) continue;
    cues.push({
      id: `cue-${cues.length}`,
      start,
      end,
      text,
    });
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(source: string, fileName = ""): SubtitleCue[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ass") || lower.endsWith(".ssa") || /\[events\]/i.test(source)) {
    const ass = parseAss(source);
    if (ass.length > 0) return ass;
  }
  return parseSrtOrVtt(source);
}

export function getSubtitleWindow(cues: SubtitleCue[], currentTime: number, before = 4, after = 2): SubtitleWindow {
  if (cues.length === 0) {
    return { previous: [], next: [] };
  }

  const activeIndex = cues.findIndex((cue) => currentTime >= cue.start && currentTime <= cue.end);
  const insertionIndex = activeIndex >= 0 ? activeIndex : cues.findIndex((cue) => cue.start > currentTime);
  const center = activeIndex >= 0 ? activeIndex : Math.max(0, insertionIndex - 1);

  return {
    active: activeIndex >= 0 ? cues[activeIndex] : undefined,
    previous: cues.slice(Math.max(0, center - before), activeIndex >= 0 ? activeIndex : center + 1),
    next: cues.slice(activeIndex >= 0 ? activeIndex + 1 : center + 1, center + 1 + after),
  };
}
