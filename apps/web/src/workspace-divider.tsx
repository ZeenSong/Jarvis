import { useRef } from "react";

export function WorkspaceDivider({ side, width, change }: { side: "left" | "right"; width: number; change: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number; container: number } | undefined>(undefined);
  const clamp = (next: number) => change(Math.max(18, Math.min(30, Math.round(next))));
  return <div className={`workspace-divider ${side}`} role="separator" tabIndex={0}
    aria-label={side === "left" ? "调整执行过程分栏" : "调整资源分栏"} aria-orientation="vertical"
    aria-valuemin={18} aria-valuemax={30} aria-valuenow={width} aria-valuetext={`侧栏宽度 ${width}%`}
    style={side === "left" ? { left: `calc(${width}% + 4px)` } : { right: `calc(${width}% + 4px)` }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      const container = event.currentTarget.parentElement!.getBoundingClientRect().width;
      drag.current = { x: event.clientX, width, container };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
      event.preventDefault();
    }}
    onPointerMove={(event) => {
      if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      clamp(drag.current.width + (event.clientX - drag.current.x) / drag.current.container * 100 * (side === "left" ? 1 : -1));
    }}
    onPointerUp={(event) => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}
    onDoubleClick={() => change(25)}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      clamp(event.key === "Home" ? 18 : event.key === "End" ? 30 : width + (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1));
    }} />;
}
