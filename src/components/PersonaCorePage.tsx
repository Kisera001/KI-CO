import { useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { CottageBondGlyph, CottageDivider, CottageStar, MemoryArchiveGlyph } from "./CottageGlyphs";
import type { UplinkSettings } from "../types";
import {
  DEFAULT_AVATAR_POSITION,
  DEFAULT_PERSONA_PROFILE,
  createPersonaCard,
  getActivePersona,
  type AvatarPosition,
  type PersonaCard,
  type PersonaProfile,
} from "../storage/personaProfile";

interface PersonaCorePageProps {
  profile: PersonaProfile;
  settings: UplinkSettings;
  onChange: (profile: PersonaProfile) => void;
  onClose: () => void;
}

type EditingAvatar =
  | { type: "user" }
  | { type: "persona"; personaId: string };

function readImageAsAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("头像图片读取失败。"));
      image.onload = () => {
        const maxSize = 720;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(String(reader.result ?? ""));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function AvatarPreview({
  name,
  image,
  position,
  size = "md",
}: {
  name: string;
  image: string;
  position: AvatarPosition;
  size?: "sm" | "md" | "lg";
}) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div className={`persona-avatar-preview ${size}`} aria-hidden="true">
      {image ? (
        <img
          src={image}
          alt=""
          style={{
            objectPosition: `${position.x}% ${position.y}%`,
            transformOrigin: `${position.x}% ${position.y}%`,
            transform: `scale(${position.scale})`,
          }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function PersonaCorePage({ profile, settings, onChange }: PersonaCorePageProps) {
  const [editingAvatar, setEditingAvatar] = useState<EditingAvatar | null>(null);
  const activePersona = useMemo(() => getActivePersona(profile), [profile]);

  function updateProfile(patch: Partial<PersonaProfile>) {
    onChange({ ...profile, ...patch });
  }

  function updatePersona(personaId: string, patch: Partial<PersonaCard>) {
    onChange({
      ...profile,
      personas: profile.personas.map((persona) =>
        persona.id === personaId ? { ...persona, ...patch } : persona,
      ),
    });
  }

  async function handleUserAvatar(file?: File) {
    if (!file) return;
    const dataUrl = await readImageAsAvatar(file);
    updateProfile({ userAvatarDataUrl: dataUrl, userAvatarPosition: DEFAULT_AVATAR_POSITION });
  }

  async function handlePersonaAvatar(personaId: string, file?: File) {
    if (!file) return;
    const dataUrl = await readImageAsAvatar(file);
    updatePersona(personaId, { avatarDataUrl: dataUrl, avatarPosition: DEFAULT_AVATAR_POSITION });
  }

  function resetProfile() {
    const confirmed = window.confirm("确定恢复为示意内容吗？当前填写内容会被替换。");
    if (confirmed) onChange(DEFAULT_PERSONA_PROFILE);
  }

  function addPersona() {
    const nextPersona = createPersonaCard({ name: `Persona ${profile.personas.length + 1}` });
    onChange({
      ...profile,
      activePersonaId: nextPersona.id,
      personas: [...profile.personas, nextPersona],
    });
  }

  function deletePersona(personaId: string) {
    if (profile.personas.length <= 1) return;
    if (!window.confirm("确定删除这个人格吗？")) return;
    const personas = profile.personas.filter((persona) => persona.id !== personaId);
    onChange({
      ...profile,
      personas,
      activePersonaId: profile.activePersonaId === personaId ? personas[0].id : profile.activePersonaId,
    });
  }

  function currentEditingAvatar() {
    if (!editingAvatar) return null;
    if (editingAvatar.type === "user") {
      return {
        title: "调整使用者头像",
        name: profile.userName,
        image: profile.userAvatarDataUrl,
        position: profile.userAvatarPosition,
        update: (patch: Partial<AvatarPosition>) =>
          updateProfile({ userAvatarPosition: { ...profile.userAvatarPosition, ...patch } }),
        reset: () => updateProfile({ userAvatarPosition: DEFAULT_AVATAR_POSITION }),
      };
    }

    const persona = profile.personas.find((item) => item.id === editingAvatar.personaId);
    if (!persona) return null;
    return {
      title: "调整人格头像",
      name: persona.name,
      image: persona.avatarDataUrl,
      position: persona.avatarPosition,
      update: (patch: Partial<AvatarPosition>) =>
        updatePersona(persona.id, { avatarPosition: { ...persona.avatarPosition, ...patch } }),
      reset: () => updatePersona(persona.id, { avatarPosition: DEFAULT_AVATAR_POSITION }),
    };
  }

  const avatarEditor = currentEditingAvatar();

  return (
    <main
      className="cinema-shell settings-route-shell persona-route-shell"
      data-theme={settings.visual.theme}
      data-font={settings.visual.fontStyle}
      data-font-size={settings.visual.fontSize}
    >
      <aside className="settings-page persona-original-page cottage-ritual-page" aria-label="人格核">
        <header className="cottage-page-heading">
          <div>
            <span className="cottage-page-kicker">PERSONA CORE</span>
            <h1>人格核</h1>
            <p>保存陪伴者的身份、表达方式与记忆读取边界。</p>
          </div>
        </header>

        <CottageDivider />

        <section className="persona-bond-stage">
          <div className="persona-bond-person">
            <div className="persona-orbit-avatar">
              <AvatarPreview name={profile.userName} image={profile.userAvatarDataUrl} position={profile.userAvatarPosition} size="lg" />
              <CottageStar className="persona-orbit-star persona-orbit-star-main" />
              <CottageStar className="persona-orbit-star persona-orbit-star-left" />
              <CottageStar className="persona-orbit-star persona-orbit-star-right" />
            </div>
            <label className="persona-bond-name">
              <span>Me</span>
              <input value={profile.userName} onChange={(event) => updateProfile({ userName: event.target.value })} placeholder="User" />
            </label>
            <div className="persona-avatar-actions compact">
              <button
                type="button"
                className={`persona-avatar-eye-toggle ${profile.showAvatars ? "active" : ""}`}
                onClick={() => updateProfile({ showAvatars: !profile.showAvatars })}
                title={profile.showAvatars ? "隐藏头像" : "显示头像"}
                aria-label={profile.showAvatars ? "隐藏头像" : "显示头像"}
              >
                {profile.showAvatars ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <label title="上传使用者头像">
                <Upload size={14} />
                <span>上传</span>
                <input className="visually-hidden-file" type="file" accept="image/*" onChange={(event) => handleUserAvatar(event.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => setEditingAvatar({ type: "user" })} disabled={!profile.userAvatarDataUrl} title="调整使用者头像">
                <SlidersHorizontal size={14} />
                <span>调整</span>
              </button>
            </div>
          </div>

          <div className="persona-bond-line">
            <CottageBondGlyph />
            <span />
            <small>BOND</small>
          </div>

          <div className="persona-bond-person">
            <div className="persona-orbit-avatar">
              <AvatarPreview name={activePersona.name} image={activePersona.avatarDataUrl} position={activePersona.avatarPosition} size="lg" />
              <CottageStar className="persona-orbit-star persona-orbit-star-main" />
              <CottageStar className="persona-orbit-star persona-orbit-star-left" />
              <CottageStar className="persona-orbit-star persona-orbit-star-right" />
            </div>
            <div className="persona-bond-name">
              <span>Ta</span>
              <strong>{activePersona.name || "Persona"}</strong>
            </div>
            <div className="persona-avatar-actions compact">
              <label title="上传人格头像">
                <Upload size={14} />
                <span>上传</span>
                <input className="visually-hidden-file" type="file" accept="image/*" onChange={(event) => handlePersonaAvatar(activePersona.id, event.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => setEditingAvatar({ type: "persona", personaId: activePersona.id })} disabled={!activePersona.avatarDataUrl} title="调整人格头像">
                <SlidersHorizontal size={14} />
                <span>调整</span>
              </button>
            </div>
          </div>
        </section>

        <div className="persona-memory-status">
          <span />
          {activePersona.allowMemory ? "记忆已载入 · ACTIVE" : "记忆读取已关闭 · STANDBY"}
        </div>

        <div className="persona-status-actions">
          <button type="button" className="cottage-primary-command persona-save-command" onClick={() => onChange(profile)} title="修改内容已自动保存">
            <span className="persona-save-particles" aria-hidden="true">
              <i className="particle-dot particle-dot-one" />
              <i className="particle-dot particle-dot-two" />
              <CottageStar className="particle-star particle-star-one" />
              <CottageStar className="particle-star particle-star-two" />
            </span>
            <Fingerprint size={15} />
            保存人格配置
          </button>
        </div>

        <section className="persona-responsive-workbench">
          <aside className="persona-deck-panel">
            <div className="cottage-panel-heading persona-deck-heading">
              <CottageStar />
              <div>
                <span>PERSONA DECK</span>
                <strong>人格档案</strong>
              </div>
              <button type="button" className="persona-add-inline" onClick={addPersona} title="新建人格">
                NEW
              </button>
            </div>
            <div className="persona-deck-list">
              {profile.personas.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  className={`persona-deck-card ${profile.activePersonaId === persona.id ? "active" : ""}`}
                  onClick={() => updateProfile({ activePersonaId: persona.id })}
                >
                  <strong>{persona.name || "Persona"}</strong>
                </button>
              ))}
            </div>
          </aside>

          <section className="persona-editor-panel">
            <div className="cottage-panel-heading persona-editor-heading">
              <Fingerprint />
              <div>
                <span>IDENTITY CORE</span>
                <strong>{activePersona.name || "Persona"}</strong>
              </div>
              <div className="persona-editor-heading-actions">
                <label className="persona-color-control" title="人格代表色">
                  <input type="color" value={activePersona.themeColor} onChange={(event) => updatePersona(activePersona.id, { themeColor: event.target.value })} />
                </label>
                <button type="button" className="persona-reset-inline" onClick={resetProfile} title="复位示例">
                  <RotateCcw size={14} />
                  <span>复位示例</span>
                </button>
              </div>
            </div>

            <div className="persona-editor-grid">
              <label className="persona-field">
                <span>NAME / 名称</span>
                <input value={activePersona.name} onChange={(event) => updatePersona(activePersona.id, { name: event.target.value })} placeholder="Persona" />
              </label>
              <label className="persona-field">
                <span>DESCRIPTION / 简述</span>
                <input value={activePersona.description} onChange={(event) => updatePersona(activePersona.id, { description: event.target.value })} placeholder="简单描述你们的关系/ Ta 长期回应你的方式。" />
              </label>
            </div>

            <label className="persona-field persona-core-field">
              <span className="persona-code-label"><CottageStar /> 人格核 / Identity Core</span>
              <textarea value={activePersona.systemPrompt} onChange={(event) => updatePersona(activePersona.id, { systemPrompt: event.target.value })} rows={10} />
              <small className="persona-core-footnote">
                记忆帮助延续关系，小屋是港湾不是笼子。这里保存的是可以回来的方向。
              </small>
            </label>

            <div className="persona-cognitive-row">
              <label className="persona-slider-card">
                <span>温度 / Temperature</span>
                <strong>{activePersona.temperature.toFixed(2)}</strong>
                <input type="range" min={0} max={2} step={0.05} value={activePersona.temperature} onChange={(event) => updatePersona(activePersona.id, { temperature: clamp(Number(event.target.value), 0, 2) })} />
              </label>
              <label className="persona-slider-card">
                <span>短期记忆携带量</span>
                <strong>{activePersona.contextDepth > 0 ? activePersona.contextDepth : `Auto · 系统 ${settings.contextLoad.shortTermMessageLimit}`}</strong>
                <input type="range" min={0} max={100} step={5} value={activePersona.contextDepth} onChange={(event) => updatePersona(activePersona.id, { contextDepth: Math.round(clamp(Number(event.target.value), 0, 100)) })} />
              </label>
            </div>

            <div className="persona-editor-footer">
              <button type="button" className={`persona-memory-gate ${activePersona.allowMemory ? "active" : ""}`} onClick={() => updatePersona(activePersona.id, { allowMemory: !activePersona.allowMemory })}>
                <MemoryArchiveGlyph size={16} />
                <span><strong>记忆库</strong><small>{activePersona.allowMemory ? "允许读取" : "停止读取"}</small></span>
              </button>
              <button type="button" className="persona-danger-button" onClick={() => deletePersona(activePersona.id)} disabled={profile.personas.length <= 1} title="删除当前人格">
                <Trash2 size={15} />
              </button>
            </div>
          </section>
        </section>
      </aside>

      {avatarEditor && (
        <div className="avatar-editor-backdrop" role="dialog" aria-modal="true">
          <div className="avatar-editor-card">
            <div className="settings-section-heading">
              <span className="settings-section-icon">
                <SlidersHorizontal size={17} />
              </span>
              <div>
                <strong>{avatarEditor.title}</strong>
                <span>调整头像位置和缩放。</span>
              </div>
            </div>
            <AvatarPreview
              name={avatarEditor.name}
              image={avatarEditor.image}
              position={avatarEditor.position}
              size="lg"
            />
            <label className="persona-slider-card compact">
              <span>水平位置</span>
              <strong>{Math.round(avatarEditor.position.x)}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                value={avatarEditor.position.x}
                onChange={(event) => avatarEditor.update({ x: Number(event.target.value) })}
              />
            </label>
            <label className="persona-slider-card compact">
              <span>垂直位置</span>
              <strong>{Math.round(avatarEditor.position.y)}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                value={avatarEditor.position.y}
                onChange={(event) => avatarEditor.update({ y: Number(event.target.value) })}
              />
            </label>
            <label className="persona-slider-card compact">
              <span>缩放</span>
              <strong>{avatarEditor.position.scale.toFixed(2)}x</strong>
              <input
                type="range"
                min={0.75}
                max={2.5}
                step={0.01}
                value={avatarEditor.position.scale}
                onChange={(event) => avatarEditor.update({ scale: Number(event.target.value) })}
              />
            </label>
            <div className="persona-actions">
              <button type="button" onClick={avatarEditor.reset}>
                <RotateCcw size={15} />
                重置
              </button>
              <button type="button" className="primary-mini-button" onClick={() => setEditingAvatar(null)}>
                <Check size={15} />
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
