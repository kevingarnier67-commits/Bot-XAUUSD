// Mini chart des ticks — canvas natif, aucune lib de charting.

import { useEffect, useRef } from "react";
import type { Tick } from "../engine/types";

interface Props {
  ticks: readonly Tick[];
}

export function TickChart({ ticks }: Props) {
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

    if (ticks.length < 2) {
      ctx.fillStyle = "#565b6e";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText("En attente de ticks…", w / 2, h / 2);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const t of ticks) {
      if (t.mid < min) min = t.mid;
      if (t.mid > max) max = t.mid;
    }
    const pad = Math.max((max - min) * 0.12, 0.05);
    min -= pad;
    max += pad;

    const x = (i: number) => (i / (ticks.length - 1)) * (w - 8) + 4;
    const y = (p: number) => h - ((p - min) / (max - min)) * (h - 10) - 5;

    const first = ticks[0]!.mid;
    const last = ticks[ticks.length - 1]!.mid;
    const up = last >= first;
    const line = up ? "#3fd68c" : "#f0566a";

    // Remplissage dégradé sous la courbe.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? "rgba(63,214,140,0.25)" : "rgba(240,86,106,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ticks.forEach((t, i) => {
      const px = x(i);
      const py = y(t.mid);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.lineTo(x(ticks.length - 1), h);
    ctx.lineTo(x(0), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Point courant.
    ctx.beginPath();
    ctx.arc(x(ticks.length - 1), y(last), 3, 0, Math.PI * 2);
    ctx.fillStyle = line;
    ctx.fill();

    // Min/max affichés.
    ctx.fillStyle = "#565b6e";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText((max - pad).toFixed(2), 4, 10);
    ctx.fillText((min + pad).toFixed(2), 4, h - 3);
  }, [ticks]);

  return <canvas ref={ref} className="chart" />;
}
