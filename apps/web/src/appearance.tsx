import type { CSSProperties } from "react";

export type JarvisStyle = "lantern" | "moss" | "clay" | "graphite";

export const jarvisStyles: Array<{
  id: JarvisStyle;
  name: string;
  subtitle: string;
  description: string;
  background: string;
  surface: string;
  accent: string;
  sage: string;
}> = [
  {
    id: "lantern",
    name: "Lantern",
    subtitle: "暖琥珀",
    description: "墨黑、暖金与鼠尾草绿，像家里一盏不刺眼的灯。",
    background: "#0a0b0d",
    surface: "#171a1e",
    accent: "#e2b56d",
    sage: "#93ab8d",
  },
  {
    id: "moss",
    name: "Moss",
    subtitle: "苔绿",
    description: "深林、苔藓与柔和的绿光，更安静、更接近自然。",
    background: "#090d0a",
    surface: "#161f17",
    accent: "#9ec08f",
    sage: "#8fbf9a",
  },
  {
    id: "clay",
    name: "Clay",
    subtitle: "陶土",
    description: "暖褐、赤陶与傍晚余温，适合照片与家庭氛围。",
    background: "#0e0b09",
    surface: "#211a15",
    accent: "#d98a63",
    sage: "#a8a37f",
  },
  {
    id: "graphite",
    name: "Graphite",
    subtitle: "石墨",
    description: "近乎无彩的灰阶与象牙白，最克制、最像工具。",
    background: "#0b0b0b",
    surface: "#1b1b1b",
    accent: "#d6d0c3",
    sage: "#a7b3a2",
  },
];

export function AppearanceSettings({ style, onStyleChange, theme, onThemeChange }: {
  style: JarvisStyle;
  onStyleChange: (style: JarvisStyle) => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
}) {
  return <section className="settings-section appearance-settings">
    <div className="section-heading"><h2>外观</h2><span className="appearance-hint">立即生效 · 保存在当前浏览器</span></div>
    <p className="appearance-intro">选一个适合你的 Jarvis。明暗模式可以独立切换，所有页面会一起变化。</p>
    <div className="appearance-styles" role="radiogroup" aria-label="视觉风格">
      {jarvisStyles.map((item) => <button
        type="button"
        role="radio"
        aria-checked={style === item.id}
        className={`appearance-card${style === item.id ? " selected" : ""}`}
        key={item.id}
        onClick={() => onStyleChange(item.id)}
      >
        <span className="appearance-preview" aria-hidden="true" style={{
          "--preview-bg": item.background,
          "--preview-surface": item.surface,
          "--preview-accent": item.accent,
          "--preview-sage": item.sage,
        } as CSSProperties}><i /></span>
        <span className="appearance-copy"><strong>{item.name}</strong><small>{item.subtitle}</small><p>{item.description}</p></span>
      </button>)}
    </div>
    <div className="appearance-mode">
      <span>明暗模式</span>
      <div className="segmented" role="group" aria-label="明暗模式">
        <button type="button" aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>深色</button>
        <button type="button" aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>浅色</button>
      </div>
    </div>
  </section>;
}
