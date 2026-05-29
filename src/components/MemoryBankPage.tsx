import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileText,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { UplinkSettings } from "../types";
import {
  createMemoryEntry,
  exportMemoryJson,
  importMemoryJson,
  listMemoryEntries,
  organizeMemoryEntries,
  parseTags,
  removeMemoryEntry,
  saveMemoryEntries,
  upsertMemoryEntry,
  type MemoryEntry,
} from "../storage/memoryBank";
import { generateBatchMemoryTags } from "../services/memoryTagging";

interface MemoryBankPageProps {
  settings: UplinkSettings;
  onClose: () => void;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

export function MemoryBankPage({ settings }: MemoryBankPageProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>(() => listMemoryEntries().slice().reverse());
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryTags, setNewMemoryTags] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showTagFilters, setShowTagFilters] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [taggingProgress, setTaggingProgress] = useState(0);
  const [expandedAliasIds, setExpandedAliasIds] = useState<Set<string>>(new Set());
  const [expandedEntryTagIds, setExpandedEntryTagIds] = useState<Set<string>>(new Set());
  const [expandedTagInputIds, setExpandedTagInputIds] = useState<Set<string>>(new Set());
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});

  function refresh() {
    setEntries(listMemoryEntries().slice().reverse());
  }

  const allTags = useMemo(
    () => Array.from(new Set(entries.flatMap((entry) => entry.tags))).sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesSearch =
        !keyword ||
        `${entry.title}\n${entry.content}\n${entry.tags.join(" ")}\n${entry.aliases.join(" ")}\n${entry.sourceTitle || ""}`
          .toLowerCase()
          .includes(keyword);
      const matchesTag = selectedTag ? entry.tags.includes(selectedTag) : true;
      return matchesSearch && matchesTag;
    });
  }, [entries, searchTerm, selectedTag]);

  function handleAdd() {
    const content = newMemoryContent.trim();
    if (!content) return;
    const tags = parseTags(newMemoryTags);
    const entry = createMemoryEntry({
      title: content.slice(0, 24),
      content,
      tags: tags.length ? tags : ["通用"],
      importance: 3,
    });
    saveMemoryEntries([entry, ...listMemoryEntries()]);
    setNewMemoryContent("");
    setNewMemoryTags("");
    refresh();
  }

  function updateEntry(entry: MemoryEntry, patch: Partial<MemoryEntry>) {
    upsertMemoryEntry({ ...entry, ...patch });
    refresh();
  }

  function handleDelete(entry: MemoryEntry) {
    if (!window.confirm("确定要删除这条记忆吗？这是不可逆的操作。")) return;
    removeMemoryEntry(entry.id);
    refresh();
  }

  async function handleImport(file?: File) {
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const stats = importMemoryJson(text);
      setEntries(stats.entries.slice().reverse());
      window.alert(`导入完成：新增 ${stats.added} 条，合并更新 ${stats.merged} 条。`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法解析文件。请确认它是记忆库 JSON。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function runLocalOrganization(mode: "untagged" | "all") {
    setIsAutoTagging(true);
    setShowTagMenu(false);
    setTaggingProgress(35);
    await new Promise((resolve) => setTimeout(resolve, 140));
    const next = organizeMemoryEntries(mode);
    setTaggingProgress(100);
    setEntries(next.slice().reverse());
    window.setTimeout(() => {
      setIsAutoTagging(false);
      setTaggingProgress(0);
    }, 360);
  }

  async function runAiOrganization(mode: "untagged" | "all") {
    let targets = entries.slice().reverse();
    if (mode === "untagged") {
      targets = targets.filter((entry) => !entry.tags.length || (entry.tags.length === 1 && entry.tags[0] === "通用"));
    }

    if (!targets.length) {
      window.alert("没有需要整理的记忆条目。");
      return;
    }
    if (!settings.profiles[settings.activeProvider].apiKey.trim()) {
      window.alert("请先在系统设置里填写当前模型通道的 API Key。");
      return;
    }

    setIsAutoTagging(true);
    setShowTagMenu(false);
    setTaggingProgress(0);

    try {
      const batchSize = 3;
      let processedCount = 0;
      let updatedCount = 0;

      for (let index = 0; index < targets.length; index += batchSize) {
        const batch = targets.slice(index, index + batchSize);
        setTaggingProgress(Math.round((processedCount / targets.length) * 100));

        try {
          const tagsBatch = await generateBatchMemoryTags(settings, batch.map((memory) => memory.content));
          batch.forEach((memory, batchIndex) => {
            const nextTags = tagsBatch[batchIndex] || [];
            if (!nextTags.length) return;
            const existingTags = memory.tags.filter((tag) => tag !== "通用");
            upsertMemoryEntry({
              ...memory,
              tags: Array.from(new Set([...existingTags, ...nextTags])),
            });
            updatedCount += 1;
          });
          refresh();
        } catch (error) {
          console.error("Memory auto tagging batch failed", error);
        }

        processedCount += batch.length;
        await new Promise((resolve) => setTimeout(resolve, 380));
      }

      setTaggingProgress(100);
      refresh();
      window.alert(`整理完成：已处理 ${processedCount} 条记忆，更新 ${updatedCount} 条标签。`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "智能整理失败。");
    } finally {
      setIsAutoTagging(false);
      setTaggingProgress(0);
    }
  }

  function toggleAliases(id: string) {
    setExpandedAliasIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleEntryTags(id: string) {
    setExpandedEntryTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTagInput(memoryId: string) {
    setExpandedTagInputIds((prev) => new Set(prev).add(memoryId));
  }

  function closeTagInput(memoryId: string) {
    setExpandedTagInputIds((prev) => {
      const next = new Set(prev);
      next.delete(memoryId);
      return next;
    });
    setTagDrafts((prev) => ({ ...prev, [memoryId]: "" }));
  }

  function handleRemoveTag(memory: MemoryEntry, tagToRemove: string) {
    const nextTags = memory.tags.filter((tag) => tag !== tagToRemove);
    updateEntry(memory, { tags: nextTags.length ? nextTags : ["通用"] });
  }

  function handleAddTag(memory: MemoryEntry) {
    const draft = (tagDrafts[memory.id] || "").trim();
    if (!draft) return;
    const nextTags = Array.from(new Set([...memory.tags, ...parseTags(draft)]));
    updateEntry(memory, { tags: nextTags });
    closeTagInput(memory.id);
  }

  function handleRemoveAlias(memory: MemoryEntry, aliasToRemove: string) {
    updateEntry(memory, { aliases: memory.aliases.filter((alias) => alias !== aliasToRemove) });
  }

  function handleAddAlias(memory: MemoryEntry) {
    const draft = (aliasDrafts[memory.id] || "").trim();
    if (!draft) return;
    const nextAliases = Array.from(new Set([...memory.aliases, ...parseTags(draft)]));
    updateEntry(memory, { aliases: nextAliases });
    setAliasDrafts((prev) => ({ ...prev, [memory.id]: "" }));
  }

  return (
    <main
      className="cinema-shell settings-route-shell memory-route-shell"
      data-theme={settings.visual.theme}
      data-font={settings.visual.fontStyle}
      data-font-size={settings.visual.fontSize}
    >
      <input
        ref={importInputRef}
        className="visually-hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => handleImport(event.target.files?.[0])}
      />

      <aside className="settings-page memory-page" aria-label="记忆档案库">
        <div className="settings-page-card memory-page-card">
          <section className="memory-panel-head">
            <div className="memory-title-copy">
              <h2>记忆档案库 (Memory)</h2>
              <p>所有长期数据的存储、分类与检索。</p>
            </div>
            <div className="memory-head-actions">
              <div className="memory-smart-menu">
                <button
                  type="button"
                  onClick={() => setShowTagMenu(!showTagMenu)}
                  disabled={isAutoTagging}
                  className="memory-primary-tool"
                >
                  {isAutoTagging ? <RefreshCw size={15} className="spin-soft" /> : <Sparkles size={15} />}
                  {isAutoTagging ? `整理中 ${taggingProgress}%` : "智能整理标签"}
                </button>
                {showTagMenu && !isAutoTagging && (
                  <div className="memory-smart-popover">
                    <div className="memory-smart-group">
                      <span>本地快速整理 · 免费</span>
                      <button type="button" onClick={() => void runLocalOrganization("untagged")}>
                        <RefreshCw size={13} />
                        仅无标签
                      </button>
                      <button type="button" onClick={() => void runLocalOrganization("all")}>
                        <Layers size={13} />
                        全量整理
                      </button>
                    </div>
                    <div className="memory-smart-group">
                      <span>AI 精准整理 · 使用 API</span>
                      <button type="button" onClick={() => void runAiOrganization("untagged")}>
                        <Sparkles size={13} />
                        仅无标签
                      </button>
                      <button type="button" onClick={() => void runAiOrganization("all")}>
                        <Sparkles size={13} />
                        全量整理
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => downloadText(`persona_memory_bank_${new Date().toISOString().slice(0, 10)}.json`, exportMemoryJson())}>
                <Download size={15} />
                备份
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()}>
                <Upload size={15} />
                导入
              </button>
            </div>
          </section>

          <section className="settings-section memory-compose-card">
            <div className="settings-section-toggle static">
              <span className="settings-section-icon">
                <Plus size={17} />
              </span>
              <div className="settings-section-copy">
                <strong>写入记忆</strong>
                <small>记录稳定偏好、长期项目、关系背景、重要设定和需要反复记住的事。</small>
              </div>
            </div>
            <div className="settings-section-body memory-compose">
              <textarea
                value={newMemoryContent}
                onChange={(event) => setNewMemoryContent(event.target.value)}
                placeholder="铭刻内容..."
                rows={4}
              />
              <div className="memory-compose-foot">
                <Tag size={15} />
                <input
                  value={newMemoryTags}
                  onChange={(event) => setNewMemoryTags(event.target.value)}
                  placeholder="分类标签，留空则归为通用"
                />
                <button type="button" className="primary-memory-button" onClick={handleAdd} disabled={!newMemoryContent.trim()}>
                  <Plus size={15} />
                  存入
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-toggle static">
              <span className="settings-section-icon">
                <Filter size={17} />
              </span>
              <div className="settings-section-copy">
                <strong>检索与管理</strong>
                <small>搜索、标签筛选、编辑、删除、导入和导出本地记忆条目。</small>
              </div>
            </div>
            <div className="settings-section-body">
              <div className="memory-toolbar">
                <label className="memory-search">
                  <Search size={16} />
                  <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="全文检索..." />
                </label>
                <div className="memory-count-chip">
                  <Database size={14} />
                  {entries.length} 条
                </div>
                <div className="memory-count-chip">
                  <Tag size={14} />
                  {allTags.length} 类
                </div>
              </div>

              <div className="memory-filter-strip">
                <button type="button" className="memory-filter-toggle" onClick={() => setShowTagFilters((value) => !value)}>
                  {showTagFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  标签筛选
                  <span>{selectedTag ? `#${selectedTag}` : `${allTags.length} 类`}</span>
                </button>
                {selectedTag && (
                  <button type="button" className="memory-filter-clear" onClick={() => setSelectedTag(null)}>
                    清除
                  </button>
                )}
              </div>

              {showTagFilters && (
                <div className="memory-tag-filter compact">
                  <button type="button" className={!selectedTag ? "active" : ""} onClick={() => setSelectedTag(null)}>
                    全部
                  </button>
                  {allTags.map((tag) => (
                    <button type="button" key={tag} className={selectedTag === tag ? "active" : ""} onClick={() => setSelectedTag(tag)}>
                      #{tag}
                    </button>
                  ))}
                </div>
              )}

              <div className="memory-list">
                {filteredEntries.length === 0 ? (
                  <div className="memory-empty">
                    <FileText size={24} />
                    <strong>{searchTerm || selectedTag ? "未找到匹配的记忆碎片" : "档案库一片寂静"}</strong>
                    <span>{searchTerm || selectedTag ? "换一个关键词，或者清空筛选。" : "先写入一条长期记忆。"}</span>
                  </div>
                ) : (
                  filteredEntries.map((entry) => {
                    const showTagInput = expandedTagInputIds.has(entry.id);
                    const showAliases = expandedAliasIds.has(entry.id);
                    const showAllTags = expandedEntryTagIds.has(entry.id);
                    const visibleTags = showAllTags ? entry.tags : entry.tags.slice(0, 3);
                    const hiddenTagCount = Math.max(0, entry.tags.length - visibleTags.length);
                    return (
                      <article key={entry.id} className="memory-entry-card">
                        <p className="memory-entry-content">{entry.content}</p>

                        <div className="memory-alias-block">
                          <button type="button" onClick={() => toggleAliases(entry.id)} className="memory-alias-toggle">
                            {showAliases ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            联想词 ({entry.aliases.length})
                          </button>
                          {showAliases && (
                            <div className="memory-alias-body">
                              <div className="memory-chip-row">
                                {entry.aliases.map((alias) => (
                                  <span key={`${entry.id}-${alias}`} className="memory-mini-chip">
                                    {alias}
                                    <button type="button" onClick={() => handleRemoveAlias(entry, alias)} title="删除联想词">
                                      <X size={11} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                              <div className="memory-inline-add">
                                <input
                                  value={aliasDrafts[entry.id] || ""}
                                  onChange={(event) => setAliasDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      handleAddAlias(entry);
                                    }
                                  }}
                                  placeholder="加联想词"
                                />
                                <button type="button" onClick={() => handleAddAlias(entry)}>
                                  +
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="memory-entry-bottom">
                          <div className="memory-chip-row">
                            {visibleTags.map((tag) => (
                              <span key={`${entry.id}-${tag}`} className="memory-tag-chip">
                                <Tag size={10} />
                                {tag}
                                <button type="button" onClick={() => handleRemoveTag(entry, tag)} title="删除标签">
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            {entry.tags.length > 3 && (
                              <button
                                type="button"
                                className="memory-tag-more"
                                onClick={() => toggleEntryTags(entry.id)}
                                title={showAllTags ? "收起标签" : `展开剩余 ${hiddenTagCount} 个标签`}
                              >
                                {showAllTags ? "收起" : "..."}
                              </button>
                            )}
                            {showTagInput ? (
                              <span className="memory-inline-add">
                                <input
                                  value={tagDrafts[entry.id] || ""}
                                  onChange={(event) => setTagDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      handleAddTag(entry);
                                    } else if (event.key === "Escape") {
                                      closeTagInput(entry.id);
                                    }
                                  }}
                                  placeholder="加标签"
                                />
                                <button type="button" onClick={() => handleAddTag(entry)}>
                                  +
                                </button>
                                <button type="button" onClick={() => closeTagInput(entry.id)}>
                                  ×
                                </button>
                              </span>
                            ) : (
                              <button type="button" className="memory-chip-add" onClick={() => openTagInput(entry.id)} title="添加标签">
                                +
                              </button>
                            )}
                          </div>

                          <div className="memory-entry-meta">
                            <span>{formatDate(entry.createdAt)}</span>
                            <button type="button" onClick={() => handleDelete(entry)} title="删除">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}
