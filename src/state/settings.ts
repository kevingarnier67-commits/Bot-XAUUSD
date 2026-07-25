// Réglages utilisateur — clés API en localStorage uniquement, jamais commitées.

export interface Settings {
  goldApiIoKey: string;
  twelveDataKey: string;
  initialCapital: number;
  /** S'entraîner sur SimFeed quand le marché est fermé. */
  simWhenClosed: boolean;
}

const STORAGE_KEY = "aurum-settings-v1";

export const DEFAULT_SETTINGS: Settings = {
  goldApiIoKey: "",
  twelveDataKey: "",
  initialCapital: 10_000,
  simWhenClosed: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      goldApiIoKey: typeof parsed.goldApiIoKey === "string" ? parsed.goldApiIoKey : "",
      twelveDataKey: typeof parsed.twelveDataKey === "string" ? parsed.twelveDataKey : "",
      initialCapital:
        typeof parsed.initialCapital === "number" && parsed.initialCapital > 0
          ? parsed.initialCapital
          : DEFAULT_SETTINGS.initialCapital,
      simWhenClosed: parsed.simWhenClosed === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
