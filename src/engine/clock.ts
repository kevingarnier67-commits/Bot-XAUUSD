// Horloge temps réel : sessions XAUUSD en UTC + détection marché fermé.
// Le bot suit l'heure réelle, aucune accélération.

import type { SessionInfo, SessionName } from "./types";

const SESSIONS: Record<SessionName, Omit<SessionInfo, "name">> = {
  // Vol faible : scans espacés, exigence qualité élevée.
  SYDNEY_ASIA: { volFactor: 0.5, scanIntervalMs: 90_000, minQuality: 62 },
  LONDON: { volFactor: 1.0, scanIntervalMs: 30_000, minQuality: 50 },
  OVERLAP: { volFactor: 1.25, scanIntervalMs: 20_000, minQuality: 46 },
  NEW_YORK: { volFactor: 1.0, scanIntervalMs: 30_000, minQuality: 50 },
  CLOSE: { volFactor: 0.4, scanIntervalMs: 120_000, minQuality: 68 },
};

export function getSession(ts: number): SessionInfo {
  const h = new Date(ts).getUTCHours();
  let name: SessionName;
  if (h >= 7 && h < 12) name = "LONDON";
  else if (h >= 12 && h < 16) name = "OVERLAP";
  else if (h >= 16 && h < 21) name = "NEW_YORK";
  else if (h >= 21 && h < 22) name = "CLOSE";
  else name = "SYDNEY_ASIA";
  return { name, ...SESSIONS[name] };
}

/** Jours fériés majeurs (UTC) où le marché de l'or est fermé ou quasi mort. */
const HOLIDAYS_MMDD = new Set(["01-01", "12-25", "12-26", "07-04", "11-27"]);

/**
 * Marché XAUUSD fermé : du vendredi ~21h UTC au dimanche ~22h UTC,
 * plus les jours fériés majeurs.
 */
export function isMarketOpen(ts: number): boolean {
  const d = new Date(ts);
  const day = d.getUTCDay(); // 0 = dimanche
  const h = d.getUTCHours();

  if (day === 6) return false; // samedi
  if (day === 5 && h >= 21) return false; // vendredi soir
  if (day === 0 && h < 22) return false; // dimanche avant réouverture

  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  if (HOLIDAYS_MMDD.has(mmdd)) return false;

  return true;
}

/** Clé de jour UTC (YYYY-MM-DD) pour la daily loss limit. */
export function dayKeyUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
