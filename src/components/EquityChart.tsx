// Equity curve — canvas natif. Vert au-dessus du capital initial, rouge en dessous.

import { useEffect, useRef } from "react";
import type { EquityPoint } from "../engine/types";

interface Props {
  curve: readonly EquityPoint[];
  initialCapital: number;
}

export function EquityChart({ curve, initialCapital }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (curve.length < 2) {
      ctx.fillStyle = "#565b6e";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Pas encore assez d'historique", w / 2, h / 2);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const p of curve) {
      if (p.equity < min) min = p.equity;
      if (p.equity > max) max = p.equity;
    }
    min = Math.min(min, initialCapital);
    max = Math.max(max, initialCapital);
    const pad = Math.max((max - min) * 0.1, initialCapital * 0.002);
    min -= pad;
    max += pad;

    const t0 = curve[0]!.ts;
    const t1 = curve[curve.length - 1]!.ts;
    const span = Math.max(t1 - t0, 1);
    const x = (ts: number) => ((ts - t0) / span) * (w - 8) + 4;
    const y = (e: number) => h - ((e - min) / (max - min)) * (h - 14) - 7;

    const baseY = y(initialCapital);

    // Ligne du capital initial.
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(w, baseY);
    ctx.strokeStyle = "rgba(201,163,74,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Courbe segmentée : vert au-dessus du capital, rouge en dessous.
    // On coupe chaque segment à l'intersection avec la ligne de base.
    const drawSegment = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): void => {
      const above1 = y1 <= baseY;
      const above2 = y2 <= baseY;
      if (above1 === above2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = above1 ? "#3fd68c" : "#f0566a";
        ctx.stroke();
        return;
      }
      const t = (baseY - y1) / (y2 - y1);
      const xi = x1 + (x2 - x1) * t;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(xi, baseY);
      ctx.strokeStyle = above1 ? "#3fd68c" : "#f0566a";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xi, baseY);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = above2 ? "#3fd68c" : "#f0566a";
      ctx.stroke();
    };

    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1]!;
      const b = curve[i]!;
      drawSegment(x(a.ts), y(a.equity), x(b.ts), y(b.equity));
    }

    // Repères min/max.
    ctx.fillStyle = "#565b6e";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText((max - pad).toFixed(0), 4, 10);
    ctx.fillText((min + pad).toFixed(0), 4, h - 3);
  }, [curve, initialCapital]);

  return <canvas ref={ref} className="chart tall" />;
}
