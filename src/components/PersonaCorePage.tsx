import { useMemo, useState } from "react";
import {
  Book,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type { UplinkSettings } from "../types";
import {
  DEFAULT_AVATAR_POSITION,
  DEFAULT_PERSONA_PROFILE,
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
    const confirmed = window.confirm("确定恢复为示意人格核吗？当前填写内容会被替换。");
    if (confirmed) onChange(DEFAULT_PERSONA_PROFILE);
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
      <aside className="settings-page persona-original-page" aria-label="人格核">
        <section className="persona-user-layer">
          <div className="persona-user-avatar-block">
            <AvatarPreview
              name={profile.userName}
              image={profile.userAvatarDataUrl}
              position={profile.userAvatarPosition}
              size="lg"
            />
            <div className="persona-avatar-actions">
              <button
                type="button"
                className={`persona-avatar-eye-toggle ${profile.showAvatars ? "active" : ""}`}
                onClick={() => updateProfile({ showAvatars: !profile.showAvatars })}
                title={profile.showAvatars ? "隐藏头像" : "显示头像"}
                aria-label={profile.showAvatars ? "隐藏头像" : "显示头像"}
              >
                {profile.showAvatars ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <label>
                <Upload size={14} />
                上传头像
                <input
                  className="visually-hidden-file"
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleUserAvatar(event.target.files?.[0])}
                />
              </label>
              <button type="button" onClick={() => setEditingAvatar({ type: "user" })} disabled={!profile.userAvatarDataUrl}>
                <SlidersHorizontal size={14} />
                调整
              </button>
            </div>
          </div>

          <div className="persona-user-copy">
            <p>USER IDENTITY</p>
            <label className="persona-field">
              <span>NAME / 称呼</span>
              <input
                value={profile.userName}
                onChange={(event) => updateProfile({ userName: event.target.value })}
                placeholder="User"
              />
            </label>
          </div>

          <button type="button" className="persona-save-button" onClick={() => onChange(profile)}>
            <Save size={12} />
            保存设定
          </button>
        </section>

        <section className="persona-workbench">
          <section className="persona-editor-panel">
            <div className="persona-editor-head">
              <div className="persona-editor-avatar">
                <AvatarPreview
                  name={activePersona.name}
                  image={activePersona.avatarDataUrl}
                  position={activePersona.avatarPosition}
                  size="lg"
                />
                <div className="persona-avatar-actions">
                  <label>
                    <Upload size={14} />
                    上传
                    <input
                      className="visually-hidden-file"
                      type="file"
                      accept="image/*"
                      onChange={(event) => handlePersonaAvatar(activePersona.id, event.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setEditingAvatar({ type: "persona", personaId: activePersona.id })}
                    disabled={!activePersona.avatarDataUrl}
                  >
                    <SlidersHorizontal size={14} />
                    调整
                  </button>
                </div>
              </div>

              <div className="persona-editor-title">
                <p>ACTIVE PERSONA</p>
                <h2>{activePersona.name || "Companion"}</h2>
                <span>当前活跃人格</span>
              </div>

            </div>

            <div className="persona-editor-grid">
              <label className="persona-field">
                <span>NAME / 名称</span>
                <input
                  value={activePersona.name}
                  onChange={(event) => updatePersona(activePersona.id, { name: event.target.value })}
                  placeholder="Companion"
                />
              </label>
            </div>

            <label className="persona-field">
              <span>DESCRIPTION / 简述</span>
              <input
                value={activePersona.description}
                onChange={(event) => updatePersona(activePersona.id, { description: event.target.value })}
                placeholder="一位由你配置的长期 AI 伙伴"
              />
            </label>

            <label className="persona-field">
              <span className="persona-code-label">
                <Fingerprint size={14} />
                人格核 / 锚点 (System Prompt)
              </span>
              <textarea
                value={activePersona.systemPrompt}
                onChange={(event) => updatePersona(activePersona.id, { systemPrompt: event.target.value })}
                rows={10}
              />
            </label>

            <div className="persona-cognitive-row">
              <label className="persona-slider-card">
                <span>Temperature (感性度)</span>
                <strong>{activePersona.temperature.toFixed(2)}</strong>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={activePersona.temperature}
                  onChange={(event) =>
                    updatePersona(activePersona.id, { temperature: clamp(Number(event.target.value), 0, 2) })
                  }
                />
              </label>

              <label className="persona-slider-card">
                <span>Context Depth (记忆深度)</span>
                <strong>{activePersona.contextDepth > 0 ? activePersona.contextDepth : "Auto"}</strong>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={activePersona.contextDepth}
                  onChange={(event) =>
                    updatePersona(activePersona.id, { contextDepth: Math.round(clamp(Number(event.target.value), 0, 100)) })
                  }
                />
                <em>设为 0 则跟随全局设置。</em>
              </label>
            </div>

            <div className="persona-gates-card">
              <span className="persona-gates-label">Cognitive Gates / 读取开关</span>
              <button
                type="button"
                className={`persona-memory-gate ${activePersona.allowMemory ? "active" : ""}`}
                onClick={() => updatePersona(activePersona.id, { allowMemory: !activePersona.allowMemory })}
              >
                <Book size={16} />
                <span>
                  <strong>记忆库 (Memory)</strong>
                  <small>{activePersona.allowMemory ? "ACCESS GRANTED" : "ACCESS DENIED"}</small>
                </span>
              </button>
            </div>

            <div className="persona-active-status">
              <Fingerprint size={15} />
              当前活跃中
            </div>

            <div className="persona-actions">
              <button type="button" onClick={resetProfile}>
                <RotateCcw size={15} />
                恢复示意预设
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
