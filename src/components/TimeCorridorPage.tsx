import {
  ArrowLeft,
  Check,
  ChevronRight,
  Edit2,
  FilePlus2,
  Loader2,
  Pin,
  Power,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LLMAdapter, UplinkSettings } from "../types";
import type { PersonaProfile } from "../storage/personaProfile";
import { upsertMemoryEntry } from "../storage/memoryBank";
import {
  addChronicle,
  getChroniclePreferences,
  getContinuityLine,
  listChronicles,
  listMemorySeeds,
  removeChronicle,
  resolveMemorySeed,
  saveChroniclePreferences,
  saveContinuityLine,
  subscribeChronicles,
  updateChronicle,
  type ChronicleEntry,
  type MemorySeed,
} from "../storage/chronicles";
import {
  generateContinuityFromChronicles,
  generateMemorySeeds,
  recentChronicles,
  writeConversationChronicle,
} from "../services/chronicleService";
import { listConversations } from "../storage/conversations";
import { ChronicleBookGlyph, CottageDivider, CottageStar } from "./CottageGlyphs";

interface TimeCorridorPageProps {
  settings: UplinkSettings;
  personaProfile: PersonaProfile;
  llm: LLMAdapter;
}

type PageView = "months" | "entries" | "diary";

function ContinuityVineGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 13 C7 10.5 7 7.5 8.5 5 C9.2 3.8 10.5 3.2 11.5 2.5"
        fill="none"
        stroke="var(--interactive-accent, var(--kx-primary, #dcbda8))"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M6 8 C4.5 7 2.5 7 1.5 7.5 C1 7.7 1.5 9 2.5 9.7 C3.5 10.5 5.2 10.5 6 9.5"
        fill="var(--text-accent, var(--kx-secondary, #a694bc))"
      />
      <path
        d="M8 5.5 C9.5 4.5 11.5 4.5 12.5 5 C13 5.2 12.5 6.5 11.5 7.2 C10.5 8 8.8 8 8 7"
        fill="var(--interactive-accent, var(--kx-primary, #dcbda8))"
      />
      <circle cx="11.5" cy="2.5" r="1.1" fill="#fff" />
    </svg>
  );
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const month = Number(key.split("-")[1]);
  return `${month}月`;
}

function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function fullDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/[#*_>`~\[\]]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function toneForIndex(index: number): string {
  return ["paper", "mist", "lavender", "paper", "deep"][index % 5];
}

function diaryTone(entry: ChronicleEntry): string {
  const hash = [...entry.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return ["paper", "mist", "lavender", "deep"][hash % 4];
}

export function TimeCorridorPage({ settings, personaProfile, llm }: TimeCorridorPageProps) {
  const [entries, setEntries] = useState(() => listChronicles());
  const [view, setView] = useState<PageView>("months");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [activeDiaryId, setActiveDiaryId] = useState("");
  const [query, setQuery] = useState("");
  const [editingEntry, setEditingEntry] = useState<ChronicleEntry | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showContinuity, setShowContinuity] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [preferences, setPreferences] = useState(() => getChroniclePreferences());
  const [continuityLine, setContinuityLine] = useState(() => getContinuityLine());
  const [seeds, setSeeds] = useState(() => listMemorySeeds());

  useEffect(() => subscribeChronicles(() => {
    setEntries(listChronicles());
    setPreferences(getChroniclePreferences());
    setContinuityLine(getContinuityLine());
    setSeeds(listMemorySeeds());
  }), []);

  const groupedMonths = useMemo(() => {
    const groups = new Map<string, ChronicleEntry[]>();
    entries.forEach((entry) => groups.set(monthKey(entry.createdAt), [...(groups.get(monthKey(entry.createdAt)) || []), entry]));
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [entries]);

  const monthEntries = useMemo(() => entries
    .filter((entry) => monthKey(entry.createdAt) === selectedMonth)
    .filter((entry) => {
      const needle = query.trim().toLowerCase();
      return !needle || `${entry.title} ${entry.content} ${entry.triggerKeywords.join(" ")}`.toLowerCase().includes(needle);
    }), [entries, query, selectedMonth]);

  const activeDiary = entries.find((entry) => entry.id === activeDiaryId) || null;
  const activePersona = personaProfile.personas.find((persona) => persona.id === personaProfile.activePersonaId) || personaProfile.personas[0];

  function openMonth(key: string) {
    setSelectedMonth(key);
    setQuery("");
    setView("entries");
  }

  function openDiary(id: string) {
    setActiveDiaryId(id);
    setView("diary");
  }

  function deleteEntry(entry: ChronicleEntry) {
    if (!window.confirm(`确定删除「${entry.diaryTitle || entry.title}」吗？`)) return;
    removeChronicle(entry.id);
    if (activeDiaryId === entry.id) setView("entries");
  }

  function deleteMonth(key: string) {
    const rows = entries.filter((entry) => monthKey(entry.createdAt) === key);
    if (!window.confirm(`确定删除 ${monthLabel(key)} 的 ${rows.length} 篇日记吗？`)) return;
    rows.forEach((entry) => removeChronicle(entry.id));
  }

  async function generateLatestDiary() {
    const conversation = listConversations()[0];
    if (!conversation) { setNotice("还没有可整理的对话窗口。"); return; }
    setBusy("diary");
    setNotice("");
    try {
      const entry = await writeConversationChronicle(llm, personaProfile, conversation, "manual");
      setNotice(entry ? `已写入「${entry.title}」。` : "当前对话内容还不足以写成日记。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "日记生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function refineMemories() {
    const source = selectedMonth ? entries.filter((entry) => monthKey(entry.createdAt) === selectedMonth) : entries.slice(0, 30);
    if (!source.length) { setNotice("这个范围还没有日记可以提炼。"); return; }
    setBusy("seeds");
    try {
      await generateMemorySeeds(llm, personaProfile, source);
      setSeeds(listMemorySeeds());
      setShowSeeds(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回忆提炼失败。");
    } finally {
      setBusy("");
    }
  }

  async function refineContinuity() {
    const source = recentChronicles(preferences.recentDays);
    if (!source.length) { setNotice(`最近 ${preferences.recentDays} 天还没有日记。`); return; }
    setBusy("continuity");
    try {
      await generateContinuityFromChronicles(llm, personaProfile, source, preferences.recentDays);
      setContinuityLine(getContinuityLine());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生活线提炼失败。");
    } finally {
      setBusy("");
    }
  }

  function storeSeed(seed: MemorySeed) {
    const now = new Date().toISOString();
    upsertMemoryEntry({
      id: `memory-seed:${seed.id}`,
      title: seed.title,
      content: seed.content,
      tags: [...new Set([...seed.tags, "回忆种子"])],
      aliases: [],
      importance: seed.importance,
      createdAt: now,
      updatedAt: now,
      sourceType: "chronicle_seed",
      sourceId: seed.sourceChronicleIds[0],
      sourceTitle: seed.title,
    });
    resolveMemorySeed(seed.id, "stored");
    setSeeds(listMemorySeeds());
  }

  return (
    <main className="cinema-shell chronicle-route-shell" data-theme={settings.visual.theme} data-font={settings.visual.fontStyle} data-font-size={settings.visual.fontSize}>
      <section className="chronicle-page">
        {view === "months" ? (
          <>
            <header className="chronicle-page-header">
              <div className="chronicle-title-lockup"><ChronicleBookGlyph /><div><span className="chronicle-page-kicker">CHRONICLES</span><h1>时光回廊</h1><p>把日记、生活线和回忆种子留在这里，需要时再慢慢翻回。</p></div></div>
              <div className="chronicle-toolbar">
                <button type="button" onClick={() => setShowContinuity(true)}><ContinuityVineGlyph size={15} />跨窗接续</button>
                <button type="button" onClick={() => setShowComposer(true)}><FilePlus2 size={15} />手写</button>
              </div>
            </header>
            <CottageDivider />
            <div className="chronicle-month-list">
              {groupedMonths.map(([key, rows], index) => {
                const tone = toneForIndex(index);
                const latest = rows[0];
                return (
                  <article key={key} className={`chronicle-month-card tone-${tone}`} onClick={() => openMonth(key)}>
                    <span className="chronicle-month-edge" />
                    <div className="chronicle-month-number">{key.slice(5)}</div>
                    <div className="chronicle-month-copy"><h2>{monthLabel(key)}</h2><span>{key.slice(0, 4)} · MEMORY BOOK</span><p>{latest.diaryTitle || latest.title}</p></div>
                    <div className="chronicle-month-meta"><span>{rows.length} 篇</span><ChevronRight size={17} /></div>
                    <button type="button" className="chronicle-delete-month" title="删除整月" onClick={(event) => { event.stopPropagation(); deleteMonth(key); }}><Trash2 size={14} /></button>
                  </article>
                );
              })}
              {!groupedMonths.length ? <div className="chronicle-empty"><ChronicleBookGlyph /><strong>还没有日记</strong><p>可以手写一篇，或从最近的对话生成。</p><button type="button" onClick={generateLatestDiary} disabled={busy === "diary"}>{busy === "diary" ? <Loader2 className="chronicle-spin" size={15} /> : <Sparkles size={15} />}从最近对话生成</button></div> : null}
            </div>
          </>
        ) : null}

        {view === "entries" ? (
          <>
            <header className="chronicle-list-header">
              <button className="chronicle-back" type="button" onClick={() => setView("months")} aria-label="返回时光回廊"><ArrowLeft size={22} /></button>
              <div><h1>{selectedMonth.replace("-", "年")}月</h1><p>{monthEntries.length} 篇日记</p></div>
            </header>
            <CottageDivider />
            <div className="chronicle-search-row">
              <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在此卷中检索..." /></label>
              <button type="button" onClick={refineMemories} disabled={busy === "seeds"}>{busy === "seeds" ? <Loader2 className="chronicle-spin" size={15} /> : <Sparkles size={15} />}提炼回忆</button>
            </div>
            <div className="chronicle-entry-list">
              {monthEntries.map((entry) => (
                <article key={entry.id} className={`chronicle-entry tone-${diaryTone(entry)} ${entry.isActive ? "" : "inactive"}`}>
                  <div className="chronicle-entry-rail">
                    <button type="button" className={entry.starred ? "starred" : ""} onClick={() => updateChronicle(entry.id, { starred: !entry.starred })} aria-label={entry.starred ? "取消星标" : "标记星星"}>{entry.starred ? <CottageStar /> : <i />}</button>
                    <span />
                  </div>
                  <div className="chronicle-entry-main" onClick={() => openDiary(entry.id)}>
                    <div className="chronicle-entry-head"><span className="chronicle-entry-date">{dateLabel(entry.createdAt)}</span><div className="chronicle-entry-actions">
                      <button type="button" title={entry.isActive ? "从召回中卸载" : "重新载入召回"} onClick={(event) => { event.stopPropagation(); updateChronicle(entry.id, { isActive: !entry.isActive }); }}><Power size={15} /></button>
                      <button type="button" title="编辑" onClick={(event) => { event.stopPropagation(); setEditingEntry(entry); }}><Edit2 size={15} /></button>
                      <button type="button" title="删除" onClick={(event) => { event.stopPropagation(); deleteEntry(entry); }}><Trash2 size={15} /></button>
                      <ChevronRight size={16} />
                    </div></div>
                    <div className="chronicle-entry-card">
                      <h2>{entry.diaryTitle || entry.title}</h2>
                      <div className="chronicle-entry-badges"><span>{entry.mode === "auto" ? "自动" : "手动"}</span>{entry.sessionTitle ? <span>{entry.sessionTitle}</span> : null}</div>
                      <p>{excerpt(entry.content, 180)}</p>
                      <div className="chronicle-entry-tags">{entry.triggerKeywords.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}</div>
                    </div>
                  </div>
                </article>
              ))}
              {!monthEntries.length ? <div className="chronicle-empty compact"><p>没有找到匹配的日记。</p></div> : null}
            </div>
          </>
        ) : null}

        {view === "diary" && activeDiary ? (
          <article className="chronicle-reading-page">
            <header className="chronicle-reading-header">
              <button type="button" onClick={() => setView("entries")} aria-label="返回日记列表"><ArrowLeft size={23} /></button>
              <div className="chronicle-reading-date"><strong>{String(new Date(activeDiary.createdAt).getDate()).padStart(2, "0")}</strong><span>{fullDateLabel(activeDiary.createdAt)}</span></div>
              <div className="chronicle-reading-heading"><span>日记 / DIARY</span><h1>{activeDiary.diaryTitle || activeDiary.title}</h1><p>{activeDiary.mode === "auto" ? "自动整理" : "手动记录"}{activeDiary.sessionTitle ? ` · ${activeDiary.sessionTitle}` : ""}</p></div>
            </header>
            <CottageDivider />
            <div className="chronicle-reading-sheet">
              <CottageStar className="chronicle-reading-star top" />
              <div className="chronicle-reading-body">{activeDiary.content}</div>
              {activeDiary.facts[0] ? <blockquote>{activeDiary.facts[0]}</blockquote> : null}
              <footer><span>—— {activeDiary.personaName || activePersona?.name || "Persona"}</span><small>MEMORY CORRIDOR</small></footer>
              <CottageStar className="chronicle-reading-star bottom" />
            </div>
            <div className="chronicle-reading-actions"><button type="button" onClick={() => setEditingEntry(activeDiary)}><Edit2 size={15} />编辑</button><button type="button" onClick={() => deleteEntry(activeDiary)}><Trash2 size={15} />删除</button></div>
          </article>
        ) : null}

        {notice ? <button type="button" className="chronicle-notice" onClick={() => setNotice("")}>{notice}<X size={14} /></button> : null}
      </section>

      {(showComposer || editingEntry) ? <DiaryEditor entry={editingEntry} onClose={() => { setShowComposer(false); setEditingEntry(null); }} /> : null}
      {showContinuity ? <ContinuityDialog preferences={preferences} line={continuityLine} busy={busy} onClose={() => setShowContinuity(false)} onPreferences={(patch: Partial<typeof preferences>) => setPreferences(saveChroniclePreferences(patch))} onGenerate={refineContinuity} onLineChange={(content: string) => setContinuityLine(saveContinuityLine({ content }))} /> : null}
      {showSeeds ? <SeedDialog seeds={seeds} onClose={() => setShowSeeds(false)} onStore={storeSeed} onIgnore={(seed) => { resolveMemorySeed(seed.id, "ignored"); setSeeds(listMemorySeeds()); }} /> : null}
    </main>
  );
}

function DiaryEditor({ entry, onClose }: { entry: ChronicleEntry | null; onClose: () => void }) {
  const [title, setTitle] = useState(entry?.diaryTitle || entry?.title || "");
  const [content, setContent] = useState(entry?.content || "");
  const [tags, setTags] = useState(entry?.triggerKeywords.join("，") || "");
  function save() {
    if (!content.trim()) return;
    const parsedTags = tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
    if (entry) updateChronicle(entry.id, { title: title.trim() || "未命名日记", diaryTitle: title.trim() || undefined, content: content.trim(), triggerKeywords: parsedTags });
    else addChronicle({ title: title.trim() || "今日小记", diaryTitle: title.trim() || undefined, content: content.trim(), dateRange: new Date().toLocaleDateString(), createdAt: Date.now(), isActive: true, starred: false, mode: "manual", triggerKeywords: parsedTags, facts: [] });
    onClose();
  }
  return <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="chronicle-modal diary-editor"><button className="chronicle-modal-close" onClick={onClose}><X size={18} /></button><h2>{entry ? "编辑日记" : "手写日记"}</h2><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这一天一个自然的标题" /></label><label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔" /></label><label>正文<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={12} placeholder="今天发生了什么..." /></label><button className="chronicle-primary" onClick={save}><Check size={16} />保存日记</button></div></div>;
}

function ContinuityDialog({ preferences, line, busy, onClose, onPreferences, onGenerate, onLineChange }: any) {
  const [pin, setPin] = useState("");
  return <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="chronicle-modal continuity-dialog"><button className="chronicle-modal-close" onClick={onClose}><X size={18} /></button><h2>跨窗接续</h2><label className="chronicle-check"><input type="checkbox" checked={preferences.includeContinuityLine} onChange={(event) => onPreferences({ includeContinuityLine: event.target.checked })} /><span><strong>带上近期生活线</strong><small>知道最近几天发生了什么，不需要主动复述。</small></span></label><label className="chronicle-check"><input type="checkbox" checked={preferences.enableMemoryRecall} onChange={(event) => onPreferences({ enableMemoryRecall: event.target.checked })} /><span><strong>启用记忆召回</strong><small>聊到相关的事，会从日记、记忆库和外脑里想起来。</small></span></label><div className="chronicle-days">{[3, 7, 14].map((days) => <button key={days} className={preferences.recentDays === days ? "active" : ""} onClick={() => onPreferences({ recentDays: days })}>{days} 天</button>)}</div><textarea value={line.content} onChange={(event) => onLineChange(event.target.value)} rows={6} placeholder="还没有生活线，可以从近期日记提炼。" /><button className="chronicle-primary" onClick={onGenerate} disabled={busy === "continuity"}>{busy === "continuity" ? <Loader2 className="chronicle-spin" size={16} /> : <Sparkles size={16} />}提炼生活线</button><section className="chronicle-auto-settings"><div><strong>日记整理</strong><small>手动指令始终可用，自动整理按对话轮次触发。</small></div><label className="chronicle-check compact"><input type="checkbox" checked={preferences.autoEnabled} onChange={(event) => onPreferences({ autoEnabled: event.target.checked })} /><span><strong>自动日记</strong><small>达到设定轮次后写入时光回廊。</small></span></label><label className="chronicle-frequency"><span>每</span><input type="number" min="5" max="100" value={preferences.summaryFrequency} onChange={(event) => onPreferences({ summaryFrequency: Number(event.target.value) || 20 })} /><span>轮整理一次</span></label></section><div className="chronicle-pins"><strong><Pin size={14} />置顶事项</strong>{line.pinned.map((item: any) => <div key={item.id}><span>{item.content}</span><button onClick={() => saveContinuityLine({ pinned: line.pinned.filter((row: any) => row.id !== item.id) })}><X size={13} /></button></div>)}{line.pinned.length < 3 ? <form onSubmit={(event) => { event.preventDefault(); if (!pin.trim()) return; saveContinuityLine({ pinned: [...line.pinned, { id: `pin-${Date.now()}`, content: pin.trim(), createdAt: Date.now() }] }); setPin(""); }}><input value={pin} onChange={(event) => setPin(event.target.value)} placeholder="最多置顶三件仍未结束的事" /><button><Pin size={14} /></button></form> : null}</div></div></div>;
}

function SeedDialog({ seeds, onClose, onStore, onIgnore }: { seeds: MemorySeed[]; onClose: () => void; onStore: (seed: MemorySeed) => void; onIgnore: (seed: MemorySeed) => void }) {
  return <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="chronicle-modal seed-dialog"><button className="chronicle-modal-close" onClick={onClose}><X size={18} /></button><h2>回忆种子</h2><p>这些只是候选，是否长期留下由你决定。</p><div>{seeds.map((seed) => <article key={seed.id}><span>{seed.date}</span><h3>{seed.title}</h3><p>{seed.content}</p><div>{seed.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div><footer><button onClick={() => onIgnore(seed)}>忽略</button><button className="chronicle-primary" onClick={() => onStore(seed)}>存入记忆库</button></footer></article>)}{!seeds.length ? <div className="chronicle-empty compact"><p>暂时没有待确认的回忆种子。</p></div> : null}</div></div></div>;
}
