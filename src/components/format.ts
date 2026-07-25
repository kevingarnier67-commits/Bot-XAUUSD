// Helpers de formatage partagés par les onglets.

export function fmtUsd(v: number, digits = 2): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(digits)} $`;
}

export function fmtSignedUsd(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)} $`;
}

export function fmtPrice(v: number): string {
  return v.toFixed(2);
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour12: false });
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${fmtTime(ts)}`;
}

export function fmtDuration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return `${Math.round(ms / 1000)} s`;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export function pnlClass(v: number): string {
  return v >= 0 ? "pos" : "neg";
}
