import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brain, Calendar, Check, ChevronDown, Clock, Cpu, Database, Download, Eye, FileJson, Hash, HelpCircle, Image, Loader2, Palette, Upload, User, Wifi, Zap } from "lucide-react";
import type {
  ContextLoadSettings,
  FontSizePreset,
  FontStylePreset,
  ModelProvider,
  ProviderProfile,
  ThemePreset,
  UplinkSettings,
  VisualAtmosphereSettings,
} from "../types";
import { MODEL_PRESETS, PROVIDER_HINTS, PROVIDER_LABELS } from "../settings/uplinkSettings";
import { createFullBackup, createSettingsBackup, downloadBackup, importBackup, inspectBackupConversations } from "../storage/fullBackup";
import type { PersonaProfile } from "../storage/personaProfile";

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
};

const THEME_PREVIEWS: Record<ThemePreset, string> = {
  "black-gold": "#050505",
  "white-gold": "#f8fafb",
  "pink-mocha": "linear-gradient(135deg, #42382e, #b58c8c)",
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
  cover: "平铺",
  contain: "完整",
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
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ kind: "idle" | "success" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });
  const [openSections, setOpenSections] = useState({
    visual: true,
    neural: true,
    load: true,
    data: true,
  });
  const [maxOutputTokensDraft, setMaxOutputTokensDraft] = useState(String(settings.contextLoad.maxOutputTokens));

  useEffect(() => {
    setMaxOutputTokensDraft(String(settings.contextLoad.maxOutputTokens));
  }, [settings.contextLoad.maxOutputTokens]);

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function updateSettings(patch: Partial<UplinkSettings>) {
    onChange({ ...settings, ...patch });
  }

  function updateProfile(patch: Partial<ProviderProfile>) {
    onChange({
      ...settings,
      profiles: {
        ...settings.profiles,
        [provider]: {
          ...profile,
          ...patch,
        },
      },
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
                <span>环境与背景</span>
              </div>
              <label className="background-upload-card">
                <Upload size={15} />
                <strong>上传</strong>
                <input type="file" accept="image/*" onChange={(event) => handleBackgroundFile(event.target.files?.[0])} />
              </label>
              <div className="option-button-row compact-option-row">
                {(Object.keys(BACKGROUND_FIT_LABELS) as VisualAtmosphereSettings["backgroundFit"][]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={settings.visual.backgroundFit === item ? "active" : ""}
                    onClick={() => updateVisual({ backgroundFit: item })}
                  >
                    {BACKGROUND_FIT_LABELS[item]}
                  </button>
                ))}
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

            <label>
              <span>模型预设 <small>可编辑</small></span>
              <input
                value={profile.model}
                onChange={(event) => updateProfile({ model: event.target.value })}
              />
              <div className="model-preset-row" aria-label={`${PROVIDER_LABELS[provider]} 模型预设`}>
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
        </SettingsSection>

        <SettingsSection
          icon={<Brain size={18} />}
          title="认知负载"
          subtitle="只保留通用输出上限；温度和短期记忆携带量在人格核页面设置。"
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
              这里是“时空胶囊”发射台。导出数据将自动去除 API Key，确保安全。
              <small>完全相同的窗口不会重复导入；有差异的同窗口可选择合并或另存副本。</small>
            </p>

            <div className="backup-action-list">
              <button type="button" className="backup-action primary" onClick={handleFullBackup}>
                <span className="backup-action-icon"><Download size={18} /></span>
                <span className="backup-action-copy">
                  <strong>导出完整数据 (Full Backup)</strong>
                  <small>包含对话、人格核、记忆库、观影片单与系统设置</small>
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
