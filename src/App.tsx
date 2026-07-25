// Shell de l'app : bannières d'état, header, onglets, footer disclaimer.

import { useState } from "react";
import { useAppStore } from "./state/store";
import { LiveTab } from "./components/LiveTab";
import { ChartsTab } from "./components/ChartsTab";
import { LogTab } from "./components/LogTab";
import { AuditTab } from "./components/AuditTab";
import { SettingsTab } from "./components/SettingsTab";

type TabId = "live" | "charts" | "log" | "audit" | "settings";

const TABS: { id: TabId; label: string; ico: string }[] = [
  { id: "live", label: "Live", ico: "◉" },
  { id: "charts", label: "Charts", ico: "▤" },
  { id: "log", label: "Log", ico: "≡" },
  { id: "audit", label: "Audit", ico: "✓" },
  { id: "settings", label: "Réglages", ico: "⚙" },
];

export default function App() {
  const [tab, setTab] = useState<TabId>("live");
  const feedMode = useAppStore((s) => s.feedMode);
  const online = useAppStore((s) => s.online);
  const marketOpen = useAppStore((s) => s.marketOpen);
  const sourceName = useAppStore((s) => s.sourceName);
  const settings = useAppStore((s) => s.settings);

  return (
    <div className="app">
      {!online && <div className="banner offline">Hors ligne — dernier état affiché</div>}
      {feedMode === "sim" && (
        <div className="banner sim">
          Flux simulé{marketOpen ? " — reconnexion…" : " (marché fermé)"}
        </div>
      )}
      {!marketOpen && feedMode !== "sim" && (
        <div className="banner closed">
          Marché fermé{settings.simWhenClosed ? "" : " — sim désactivé (voir Réglages)"}
        </div>
      )}

      <header className="header">
        <span className="brand">AURUM</span>
        <span className="source">
          XAU/USD · <b>{sourceName}</b>
        </span>
      </header>

      <main className="content">
        {tab === "live" && <LiveTab />}
        {tab === "charts" && <ChartsTab />}
        {tab === "log" && <LogTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "settings" && <SettingsTab />}
      </main>

      <div className="disclaimer">
        Paper trading · prix réels, exécutions simulées · aucun ordre réel n'est passé
      </div>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            <span className="ico">{t.ico}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
