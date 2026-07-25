// Onglet SETTINGS : clés API (localStorage), capital, toggle sim, reset,
// instructions d'installation iOS + limite PWA iOS documentée dans l'app.

import { useState } from "react";
import { bot } from "../state/bot";
import { useAppStore } from "../state/store";

export function SettingsTab() {
  const settings = useAppStore((s) => s.settings);
  const [goldApiIoKey, setGoldApiIoKey] = useState(settings.goldApiIoKey);
  const [twelveDataKey, setTwelveDataKey] = useState(settings.twelveDataKey);
  const [capital, setCapital] = useState(String(settings.initialCapital));
  const [confirmReset, setConfirmReset] = useState(false);

  const save = () => {
    const cap = Number(capital);
    bot.updateSettings({
      ...settings,
      goldApiIoKey: goldApiIoKey.trim(),
      twelveDataKey: twelveDataKey.trim(),
      initialCapital: Number.isFinite(cap) && cap > 0 ? cap : settings.initialCapital,
    });
  };

  const toggleSim = (checked: boolean) => {
    bot.updateSettings({ ...settings, simWhenClosed: checked });
  };

  const doReset = async () => {
    await bot.reset();
    setConfirmReset(false);
  };

  return (
    <>
      <div className="card">
        <h2>Clés API (optionnelles)</h2>
        <div className="field">
          <label htmlFor="goldapiio">GoldAPI.io — x-access-token</label>
          <input
            id="goldapiio"
            type="password"
            value={goldApiIoKey}
            onChange={(e) => setGoldApiIoKey(e.target.value)}
            placeholder="goldapi-xxxxxxxx"
            autoComplete="off"
          />
          <div className="hint">
            Bid/ask réels + high/low du jour et de la veille (PDH/PDL immédiats).
            Polling 15 s.
          </div>
        </div>
        <div className="field">
          <label htmlFor="twelvedata">Twelve Data — API key</label>
          <input
            id="twelvedata"
            type="password"
            value={twelveDataKey}
            onChange={(e) => setTwelveDataKey(e.target.value)}
            placeholder="clé Twelve Data"
            autoComplete="off"
          />
          <div className="hint">
            WebSocket temps réel (~170 ms) + récupération de l'historique M1 et
            des jours précédents : l'analyse ICT démarre immédiatement.
            Prioritaire si renseignée.
          </div>
        </div>
        <div className="field">
          <label htmlFor="capital">Capital initial ($)</label>
          <input
            id="capital"
            type="number"
            inputMode="decimal"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            min={100}
          />
          <div className="hint">Appliqué au prochain reset.</div>
        </div>
        <button className="btn" onClick={save}>
          Enregistrer
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          Les clés restent dans le localStorage de cet appareil — jamais envoyées
          ailleurs qu'aux APIs concernées.
        </div>
      </div>

      <div className="card">
        <h2>Marché fermé</h2>
        <div className="toggle-row">
          <div>
            <div className="t-label">S'entraîner sur flux simulé</div>
            <div className="t-sub">
              Quand le marché est fermé (week-end), trader sur SimFeed clairement
              étiqueté.
            </div>
          </div>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.simWhenClosed}
              onChange={(e) => toggleSim(e.target.checked)}
            />
            <span className="track" />
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Installer sur iPhone</h2>
        <div className="install-steps">
          1. Ouvre cette page dans <b>Safari</b>
          <br />
          2. Touche le bouton <b>Partager</b> (carré avec flèche)
          <br />
          3. Choisis <b>« Sur l'écran d'accueil »</b>
          <br />
          4. L'app s'ouvre plein écran, sans barre Safari
        </div>
      </div>

      <div className="card">
        <h2>Limite iOS importante</h2>
        <div className="notice">
          Une PWA iOS est <b>suspendue en arrière-plan</b> : le bot ne trade PAS
          quand l'app est fermée. Au retour, AURUM récupère le prix actuel,
          réévalue les positions ouvertes contre SL/TP (avec le high/low de la
          période manquée si l'API le fournit) et logge un « rattrapage après
          suspension ». Il ne prétendra jamais avoir tradé en arrière-plan.
        </div>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        {!confirmReset ? (
          <button className="btn danger" onClick={() => setConfirmReset(true)}>
            Reset complet
          </button>
        ) : (
          <>
            <div className="notice" style={{ marginBottom: 10, borderColor: "var(--red)" }}>
              Efface positions, historique, équité et logs. Irréversible.
            </div>
            <button className="btn danger" onClick={() => void doReset()}>
              Confirmer le reset
            </button>
            <div style={{ height: 8 }} />
            <button className="btn" onClick={() => setConfirmReset(false)}>
              Annuler
            </button>
          </>
        )}
      </div>
    </>
  );
}
