import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brain, Calendar, Check, ChevronDown, Clock, Cpu, Database, Download, Eye, FileJson, Hash, HelpCircle, Image, Loader2, Palette, Upload, User, Wifi, Zap } from "lucide-react";
import type {
  ContextLoadSettings,
  FontSizePreset,
  FontStylePreset,
  JournalProvider,
  ModelProvider,
  ProviderProfile,
  ThemePreset,
  UplinkSettings,
  VisualAtmosphereSettings,
} from "../types";
import { JOURNAL_MODEL_PRESETS, MODEL_PRESETS, PROVIDER_HINTS, PROVIDER_LABELS } from "../settings/uplinkSettings";
import { createFullBackup, createSettingsBackup, downloadBackup, importBackup, inspectBackupConversations } from "../storage/fullBackup";
import type { PersonaProfile } from "../storage/personaProfile";
import { getChroniclePreferences, saveChroniclePreferences, subscribeChronicles } from "../storage/chronicles";

interface UplinkSettingsPanelProps {
  settings: UplinkSettings;
  onChange: (settings: UplinkSettings) => void;
  personaProfile: PersonaProfile;
  onPersonaChange: (profile: PersonaProfile) => void;
}

interface SettingsSectionProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const THEME_LABELS: Record<ThemePreset, string> = {
  "black-gold": "黑金",
  "white-gold": "白金",
  "pink-mocha": "粉咖",
  custom: "KI-CO",
};

const THEME_PREVIEWS: Record<ThemePreset, string> = {
  "black-gold": "#050505",
  "white-gold": "#f8fafb",
  "pink-mocha": "linear-gradient(135deg, #42382e, #b58c8c)",
  custom: "linear-gradient(135deg, #efe9f2 0%, #d9cfe5 42%, #9f735c 100%)",
};

const FONT_STYLE_LABELS: Record<FontStylePreset, string> = {
  system: "黑体",
  soft: "宋体",
};

const FONT_SIZE_LABELS: Record<FontSizePreset, string> = {
  small: "小",
  standard: "标准",
  large: "大",
};

const BACKGROUND_FIT_LABELS: Record<VisualAtmosphereSettings["backgroundFit"], string> = {
  cover: "铺满",
  stage: "舞台",
  contain: "完整",
};

const BACKGROUND_FIT_ORDER: VisualAtmosphereSettings["backgroundFit"][] = ["stage", "contain", "cover"];

const BACKGROUND_FIT_HINTS: Record<VisualAtmosphereSettings["backgroundFit"], string> = {
  stage: "舞台：竖图完整居中，两侧虚化延展。点击切换为完整。",
  contain: "完整：尽量显示整张背景，不裁切。点击切换为铺满。",
  cover: "铺满：填满观影室背景，会裁切边缘。点击切换为舞台。",
};

const HUD_TOGGLES: Array<{
  key: keyof Pick<
    VisualAtmosphereSettings,
    "metaShowName" | "metaShowTime" | "metaShowDate" | "metaShowModel" | "metaShowTokens"
  >;
  label: string;
  icon: ReactNode;
}> = [
  { key: "metaShowName", label: "名字", icon: <User size={13} /> },
  { key: "metaShowTime", label: "时间", icon: <Clock size={13} /> },
  { key: "metaShowDate", label: "日期", icon: <Calendar size={13} /> },
  { key: "metaShowModel", label: "模型", icon: <Cpu size={13} /> },
  { key: "metaShowTokens", label: "Token", icon: <Hash size={13} /> },
];

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getNextBackgroundFit(current: VisualAtmosphereSettings["backgroundFit"]): VisualAtmosphereSettings["backgroundFit"] {
  const index = BACKGROUND_FIT_ORDER.indexOf(current);
  return BACKGROUND_FIT_ORDER[(index + 1) % BACKGROUND_FIT_ORDER.length] || "stage";
}

function CinemaLayoutGlyph({ mode }: { mode: VisualAtmosphereSettings["backgroundFit"] }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3.4" width="12" height="11.2" rx="2.2" stroke="currentColor" strokeWidth="1.05" opacity="0.72" />
      {mode === "cover" && <rect x="4.9" y="5.2" width="8.2" height="7.6" rx="1.1" fill="currentColor" opacity="0.28" />}
      {mode === "stage" && (
        <>
          <rect x="5.8" y="4.6" width="6.4" height="8.8" rx="1.4" stroke="currentColor" strokeWidth="0.85" />
          <path d="M4.4 5.7C5.2 6.2 5.6 7.2 5.6 9s-.4 2.8-1.2 3.3" stroke="currentColor" strokeWidth="0.55" opacity="0.42" />
          <path d="M13.6 5.7c-.8.5-1.2 1.5-1.2 3.3s.4 2.8 1.2 3.3" stroke="currentColor" strokeWidth="0.55" opacity="0.42" />
        </>
      )}
      {mode === "contain" && (
        <>
          <rect x="4.7" y="5.9" width="8.6" height="6.2" rx="1.1" stroke="currentColor" strokeWidth="0.85" />
          <path d="M6.2 9h5.6" stroke="currentColor" strokeWidth="0.5" opacity="0.36" />
        </>
      )}
    </svg>
  );
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function SettingsSection({ icon, title, subtitle, open, onToggle, children }: SettingsSectionProps) {
  return (
    <section className={`settings-section ${open ? "is-open" : ""}`}>
      <button type="button" className="settings-section-toggle" onClick={onToggle}>
        <span className="settings-section-icon">{icon}</span>
        <span className="settings-section-copy">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <ChevronDown className={`settings-section-chevron ${open ? "open" : ""}`} size={17} />
      </button>
      {open && <div className="settings-section-body">{children}</div>}
    </section>
  );
}

export function UplinkSettingsPanel({ settings, onChange, personaProfile, onPersonaChange }: UplinkSettingsPanelProps) {
  const provider = settings.activeProvider;
  const profile = settings.profiles[provider];
  const presets = MODEL_PRESETS[provider];
  const journalProviderSetting: JournalProvider = settings.journalProvider || "openrouter";
  const journalProvider: ModelProvider = journalProviderSetting === "active" ? provider : journalProviderSetting;
  const journalProfile = settings.profiles[journalProvider];
  const journalPresets = JOURNAL_MODEL_PRESETS[journalProvider] || MODEL_PRESETS[journalProvider];
  const journalUsesActiveConnection = journalProviderSetting === "active";
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ kind: "idle" | "success" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });
  const [openSections, setOpenSections] = useState({
    visual: true,
    neural: true,
    chronos: true,
    load: true,
    data: true,
  });
  const [maxOutputTokensDraft, setMaxOutputTokensDraft] = useState(String(settings.contextLoad.maxOutputTokens));
  const [chroniclePreferences, setChroniclePreferences] = useState(() => getChroniclePreferences());

  useEffect(() => {
    setMaxOutputTokensDraft(String(settings.contextLoad.maxOutputTokens));
  }, [settings.contextLoad.maxOutputTokens]);

  useEffect(() => subscribeChronicles(() => setChroniclePreferences(getChroniclePreferences())), []);

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function updateSettings(patch: Partial<UplinkSettings>) {
    onChange({ ...settings, ...patch });
  }

  function updateProviderProfile(targetProvider: ModelProvider, patch: Partial<ProviderProfile>) {
    onChange({
      ...settings,
      profiles: {
        ...settings.profiles,
        [targetProvider]: {
          ...settings.profiles[targetProvider],
          ...patch,
        },
      },
    });
  }

  function updateProfile(patch: Partial<ProviderProfile>) {
    updateProviderProfile(provider, patch);
  }

  function updateJournalProvider(value: JournalProvider) {
    onChange({
      ...settings,
      journalProvider: value,
    });
  }

  function commitMaxOutputTokens() {
    const parsed = Number(maxOutputTokensDraft);
    const value = maxOutputTokensDraft.trim() && Number.isFinite(parsed)
      ? clampNumber(parsed, 256, 8000)
      : settings.contextLoad.maxOutputTokens;
    setMaxOutputTokensDraft(String(value));
    if (value !== settings.contextLoad.maxOutputTokens) {
      updateContextLoad({ maxOutputTokens: value });
    }
  }

  function updateContextLoad(patch: Partial<ContextLoadSettings>) {
    onChange({
      ...settings,
      contextLoad: {
        ...settings.contextLoad,
        ...patch,
      },
    });
  }

  function updateMemoryRetrieval(patch: Partial<UplinkSettings["memoryRetrieval"]>) {
    onChange({
      ...settings,
      memoryRetrieval: {
        ...settings.memoryRetrieval,
        ...patch,
      },
    });
  }

  function updateVisual(patch: Partial<VisualAtmosphereSettings>) {
    onChange({
      ...settings,
      visual: {
        ...settings.visual,
        ...patch,
      },
    });
  }

  async function handleBackgroundFile(file?: File) {
    if (!file) return;
    const dataUrl = await readImageAsDataUrl(file);
    updateVisual({ customBackgroundDataUrl: dataUrl });
  }

  function switchProvider(nextProvider: ModelProvider) {
    onChange({
      ...settings,
      activeProvider: nextProvider,
    });
  }

  function backupDateLabel() {
    return new Date().toISOString().slice(0, 10);
  }

  function handleFullBackup() {
    downloadBackup(
      `KISERA_COTTAGE_FULL_BACKUP_${backupDateLabel()}.json`,
      createFullBackup(settings, personaProfile),
    );
  }

  function handleSettingsBackup() {
    downloadBackup(
      `kisera_cottage_settings_${backupDateLabel()}.json`,
      createSettingsBackup(settings, personaProfile),
    );
  }

  async function handleImportFile(file?: File) {
    if (!file) return;
    setIsImporting(true);
    setImportFeedback({ kind: "idle", text: "" });
    try {
      const text = await file.text();
      const inspection = inspectBackupConversations(text);
      let conflictMode: "merge" | "copy" = "merge";
      if (inspection?.divergentSameId) {
        const merge = window.confirm(
          `发现 ${inspection.divergentSameId} 个同一窗口但内容不同的对话。\n\n选择“确定”合并对话，选择“取消”保留为副本。`,
        );
        conflictMode = merge ? "merge" : "copy";
      }
      const result = importBackup(text, settings, conflictMode);
      onChange(result.settings);
      onPersonaChange(result.personaProfile);
      window.dispatchEvent(new Event("kisera-cottage-data-imported"));
      setImportFeedback({ kind: "success", text: result.report });
    } catch (error) {
      setImportFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "恢复失败，请检查备份文件。",
      });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <aside className="settings-page" aria-label="设置 / Settings">
      <div className="settings-page-card">
        <SettingsSection
          icon={<Palette size={18} />}
          title="视觉与氛围"
          subtitle="主题、背景、字体和流式输出。"
          open={openSections.visual}
          onToggle={() => toggleSection("visual")}
        >
          <div className="visual-cortex-card">
            <div className="visual-block">
              <div className="visual-block-title">
                <Palette size={14} />
                <span>主题配色</span>
              </div>
              <div className="theme-orb-row" aria-label="主题配色">
                {(Object.keys(THEME_LABELS) as ThemePreset[]).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    className={settings.visual.theme === theme ? "active" : ""}
                    onClick={() => updateVisual({ theme })}
                    title={THEME_LABELS[theme]}
                  >
                    <span style={{ background: THEME_PREVIEWS[theme] }} />
                    {settings.visual.theme === theme && <Check size={10} />}
                    <em>{THEME_LABELS[theme]}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="visual-inline-row background-inline-row">
              <div className="visual-block-title visual-compact-title">
                <Image size={14} />
                <span>环境背景</span>
              </div>
              <label className="background-upload-card">
                <Upload size={15} />
                <strong>上传</strong>
                <input type="file" accept="image/*" onChange={(event) => handleBackgroundFile(event.target.files?.[0])} />
              </label>
              <div className="cinema-layout-control">
                <span>观影室布局</span>
                <button
                  type="button"
                  className={`cinema-layout-cycle fit-${settings.visual.backgroundFit}`}
                  onClick={() => updateVisual({ backgroundFit: getNextBackgroundFit(settings.visual.backgroundFit) })}
                  title={BACKGROUND_FIT_HINTS[settings.visual.backgroundFit]}
                  aria-label={`观影室布局：${BACKGROUND_FIT_LABELS[settings.visual.backgroundFit]}`}
                >
                  <CinemaLayoutGlyph mode={settings.visual.backgroundFit} />
                  <strong>{BACKGROUND_FIT_LABELS[settings.visual.backgroundFit]}</strong>
                </button>
              </div>
            </div>

            <div className="visual-inline-pair">
              <div className="visual-compact-setting">
                <div className="visual-block-title visual-compact-title">
                  <span>字体风格</span>
                </div>
                <div className="option-button-row even-option-row font-style-row">
                  {(Object.keys(FONT_STYLE_LABELS) as FontStylePreset[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={settings.visual.fontStyle === item ? "active" : ""}
                      onClick={() => updateVisual({ fontStyle: item })}
                    >
                      {FONT_STYLE_LABELS[item]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="visual-compact-setting">
                <div className="visual-block-title visual-compact-title">
                  <span>字号</span>
                </div>
                <div className="option-button-row even-option-row font-size-row">
                  {(Object.keys(FONT_SIZE_LABELS) as FontSizePreset[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={settings.visual.fontSize === item ? "active" : ""}
                      onClick={() => updateVisual({ fontSize: item })}
                    >
                      {FONT_SIZE_LABELS[item]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="stream-row-card">
              <button
                type="button"
                className={`mini-toggle ${settings.stream ? "active" : ""}`}
                onClick={() => updateSettings({ stream: !settings.stream })}
                aria-pressed={settings.stream}
              >
                <span />
              </button>
              <div>
                <strong><Zap size={13} /> 流式输出</strong>
                <small>开启后按模型返回逐步显示。</small>
              </div>
            </div>

            <div className="hud-toggle-card">
              <div className="visual-block-title visual-compact-title">
                <Eye size={14} />
                <span>显示信息</span>
              </div>
              <div className="hud-toggle-row">
                {HUD_TOGGLES.map((toggle) => {
                  const active = Boolean(settings.visual[toggle.key]);
                  return (
                    <button
                      type="button"
                      key={toggle.key}
                      className={active ? "active" : ""}
                      onClick={() => updateVisual({ [toggle.key]: !active })}
                    >
                      {active ? <Check size={13} /> : toggle.icon}
                      {toggle.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<Wifi size={18} />}
          title="神经网络连接"
          subtitle="模型通道、接口地址和模型预设。"
          open={openSections.neural}
          onToggle={() => toggleSection("neural")}
        >
          <div className="provider-tabs" aria-label="模型通道">
            {(Object.keys(PROVIDER_LABELS) as ModelProvider[]).map((item) => (
              <button type="button" key={item} className={item === provider ? "active" : ""} onClick={() => switchProvider(item)}>
                {PROVIDER_LABELS[item]}
              </button>
            ))}
          </div>

          <p className="settings-hint">{PROVIDER_HINTS[provider]}</p>

          <div className="settings-grid">
            <label>
              <span>API Key</span>
              <input
                value={profile.apiKey}
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                onChange={(event) => updateProfile({ apiKey: event.target.value })}
              />
            </label>

            <label>
              <span>Base URL</span>
              <input value={profile.baseUrl} placeholder="https://openrouter.ai/api/v1" onChange={(event) => updateProfile({ baseUrl: event.target.value })} />
            </label>

            <label className="model-preset-field">
              <span>模型预设 <small>可编辑</small></span>
              <input
                value={profile.model}
                onChange={(event) => updateProfile({ model: event.target.value })}
              />
              <div className={`model-preset-row provider-${provider}`} aria-label={`${PROVIDER_LABELS[provider]} 模型预设`}>
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={profile.model === preset.id ? "active" : ""}
                    onClick={() => updateProfile({ model: preset.id })}
                    title={preset.id}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <div className="journal-channel-card">
            <div className="journal-channel-head">
              <span className="journal-channel-icon"><FileJson size={15} /></span>
              <div>
                <strong>日记/总结通道</strong>
                <small>日记/总结模型可调用轻量模型，不影响主对话。</small>
              </div>
            </div>

            <div className="journal-channel-grid">
              <label>
                <span>通道模式</span>
                <select value={journalProviderSetting} onChange={(event) => updateJournalProvider(event.target.value as JournalProvider)}>
                  <option value="active">跟随主对话通道</option>
                  <option value="openrouter">独立通道 · OpenRouter</option>
                  <option value="glm">独立通道 · GLM</option>
                  <option value="deepseek">独立通道 · DeepSeek</option>
                  <option value="claude">独立通道 · Claude</option>
                  <option value="gemini">独立通道 · Gemini</option>
                </select>
              </label>

              {!journalUsesActiveConnection && (
                <>
                  <label>
                    <span>API Key</span>
                    <input
                      value={journalProfile.apiKey}
                      type="password"
                      autoComplete="off"
                      placeholder="sk-..."
                      onChange={(event) => updateProviderProfile(journalProvider, { apiKey: event.target.value })}
                    />
                  </label>

                  <label>
                    <span>Base URL</span>
                    <input
                      value={journalProfile.baseUrl}
                      placeholder="https://openrouter.ai/api/v1"
                      onChange={(event) => updateProviderProfile(journalProvider, { baseUrl: event.target.value })}
                    />
                  </label>
                </>
              )}

              <label className="journal-model-field">
                <span>日记/总结模型 <small>{journalUsesActiveConnection ? "使用主通道 Key/Base URL" : "独立 Key/Base URL"}</small></span>
                <input
                  value={journalProfile.journalModel}
                  placeholder={journalProvider === "openrouter" ? "z-ai/glm-5" : "glm-5"}
                  onChange={(event) => updateProviderProfile(journalProvider, { journalModel: event.target.value })}
                />
                <div className={`model-preset-row journal-model-presets provider-${journalProvider}`} aria-label={`${PROVIDER_LABELS[journalProvider]} 日记模型预设`}>
                  {journalPresets.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={journalProfile.journalModel === preset.id ? "active" : ""}
                      onClick={() => updateProviderProfile(journalProvider, { journalModel: preset.id })}
                      title={preset.id}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </label>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<Calendar size={18} />}
          title="时空锚点 (Chronos)"
          subtitle="日期、星期、节日和当前时段；只放进动态上下文。"
          open={openSections.chronos}
          onToggle={() => toggleSection("chronos")}
        >
          <div className="chronos-settings-card">
            <div className="chronos-copy">
              <strong>时间感知 (Time Awareness)</strong>
              <small>影响模型是否知道“今天是什么日子 / 现在是不是深夜”。实时感知更有生活感，但不会放进稳定缓存前缀。</small>
            </div>
            <div className="chronos-mode-row">
              {([
                ["off", "关闭", "不注入日期或时间。"],
                ["date_only", "日期感知", "日期 / 星期 / 节日 / 时段。"],
                ["realtime", "实时感知", "在日期感知基础上加入当前时间。"],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  className={settings.contextLoad.timeAwarenessMode === value ? "active" : ""}
                  onClick={() => updateContextLoad({ timeAwarenessMode: value })}
                  title={hint}
                >
                  {settings.contextLoad.timeAwarenessMode === value ? <span aria-hidden="true">✦</span> : null}
                  {label}
                </button>
              ))}
            </div>
            <p>建议日常默认使用“日期感知”。只有希望 TA 知道具体几点、比如凌晨陪聊或熬夜工作时，再开“实时感知”。</p>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<Brain size={18} />}
          title="记忆与上下文"
          subtitle="短期原文、自动日记周期和记忆检索方式。"
          open={openSections.load}
          onToggle={() => toggleSection("load")}
        >
          <div className="settings-grid compact cognitive-load-grid">
            <label
              className="settings-tooltip-label"
              data-tooltip="单次回复的最大长度。过低会导致回复被截断，过高可能让回复过长。"
            >
              <span>
                单次输出上限 (Max Tokens)
                <HelpCircle size={12} />
              </span>
              <input
                value={maxOutputTokensDraft}
                type="number"
                min={256}
                max={8000}
                step={128}
                onChange={(event) => setMaxOutputTokensDraft(event.target.value)}
                onBlur={commitMaxOutputTokens}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          </div>
          <div className="memory-context-settings">
            <label className="memory-context-range">
              <span><strong>短期记忆携带量</strong><small>当前保留在原文窗口里的最近消息；状态卡只整理它之前的内容。</small></span>
              <b>{settings.contextLoad.shortTermMessageLimit} 条</b>
              <input type="range" min={6} max={100} step={2} value={settings.contextLoad.shortTermMessageLimit} onChange={(event) => updateContextLoad({ shortTermMessageLimit: Number(event.target.value) })} />
            </label>
            <label className="memory-context-range">
              <span><strong>记忆总结周期</strong><small>每累计多少轮新对话，自动整理一篇日记。</small></span>
              <b>{chroniclePreferences.summaryFrequency} 轮</b>
              <input type="range" min={5} max={100} step={5} value={chroniclePreferences.summaryFrequency} onChange={(event) => setChroniclePreferences(saveChroniclePreferences({ summaryFrequency: Number(event.target.value) }))} />
            </label>
            <section className="memory-retrieval-mode-card">
              <div><strong>记忆检索模式</strong><small>选择每轮如何从记忆库、日记与外脑中找回相关内容。</small></div>
              <div className="memory-retrieval-mode-row">
                {([
                  ["local", "本地", "只使用本地关键词与轻量评分。"],
                  ["hybrid", "混合", "本地检索与 embedding 互相补充，建议默认。"],
                  ["vector", "向量", "主要使用 embedding 语义相似度。"],
                ] as const).map(([value, label, description]) => (
                  <button key={value} type="button" className={settings.memoryRetrieval.memoryRetrievalMode === value ? "active" : ""} onClick={() => updateMemoryRetrieval({ memoryRetrievalMode: value })} title={description}>
                    {settings.memoryRetrieval.memoryRetrievalMode === value ? <span aria-hidden="true">✦</span> : null}{label}
                  </button>
                ))}
              </div>
              <p>{settings.memoryRetrieval.memoryRetrievalMode === "local" ? "无需 embedding；远程不可用时也会回退到本地 RAG。" : settings.memoryRetrieval.memoryRetrievalMode === "hybrid" ? "建议先使用默认设置：有 embedding 时增强语义召回，没有时仍保留本地 RAG。" : "需要有效的 embedding 配置；未接入时会自动回退本地 RAG。"}</p>
            </section>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<Database size={18} />}
          title="数据与备份 (Data & Backup)"
          subtitle="全量导出 / 恢复"
          open={openSections.data}
          onToggle={() => toggleSection("data")}
        >
          <div className="backup-management-card">
            <p className="backup-intro">
              <strong className="backup-safety-note">全量打包不会打包 API Key</strong>
              这里是“时空胶囊”发射台，主要数据会一起收进本地备份。
              <small>完全相同的窗口不会重复导入；有差异的同窗口可选择合并或另存副本。</small>
            </p>

            <div className="backup-action-list">
              <button type="button" className="backup-action primary" onClick={handleFullBackup}>
                <span className="backup-particles" aria-hidden="true"><i /><i /><i /><i /></span>
                <span className="backup-action-icon"><Download size={18} /></span>
                <span className="backup-action-copy">
                  <strong>全量打包 (Full Backup)</strong>
                  <small>对话、人格核、记忆库、日记、生活线、状态卡、片单、索引与设置</small>
                </span>
              </button>

              <button type="button" className="backup-action" onClick={handleSettingsBackup}>
                <span className="backup-action-icon"><FileJson size={18} /></span>
                <span className="backup-action-copy">
                  <strong>仅导出系统配置 (Settings Only)</strong>
                  <small>包含主题、人格核与参数（无对话数据）</small>
                </span>
              </button>

              <button
                type="button"
                className={`backup-action ${isImporting ? "busy" : ""}`}
                disabled={isImporting}
                onClick={() => importInputRef.current?.click()}
              >
                <span className="backup-action-icon">
                  {isImporting ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
                </span>
                <span className="backup-action-copy">
                  <strong>{isImporting ? "正在恢复数据..." : "恢复/导入数据"}</strong>
                  <small>支持完整备份或纯配置文件</small>
                </span>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => handleImportFile(event.target.files?.[0])}
                />
              </button>
            </div>

            {importFeedback.kind !== "idle" && (
              <div className={`backup-feedback ${importFeedback.kind}`}>{importFeedback.text}</div>
            )}
          </div>
        </SettingsSection>
      </div>
    </aside>
  );
}
