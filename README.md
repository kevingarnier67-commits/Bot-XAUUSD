# AURUM — Paper Trading XAUUSD · PWA iPhone

Bot de **paper trading XAUUSD 100% autonome**, livré en **PWA installable sur iPhone**, connecté au **prix de l'or en temps réel**.

> **Paper trading · prix réels, exécutions simulées · aucun ordre réel n'est passé.**
> Les prix viennent d'un flux live ; le spread, le slippage, la commission et le swap sont **modélisés**. Le système est réaliste : il peut perdre, entrer en drawdown, se mettre en pause. Aucun paramètre n'est truqué pour faire monter la courbe.

## Démarrage

```bash
npm install
npm run dev
```

Le prix XAUUSD réel s'affiche en moins de 15 s, **sans aucune clé API** (flux par défaut : [gold-api.com](https://gold-api.com), gratuit et sans inscription). Le bot analyse le marché et ouvre son premier paper-trade seul, sans aucun clic (marché ouvert).

Autres commandes :

```bash
npm test           # suite Vitest complète
npm run build      # build de production (PWA)
npm run preview    # sert le build (test d'installation iPhone)
```

## Flux de prix — pattern adapter avec failover

| Adapter | Clé | Transport | Particularités |
|---|---|---|---|
| `GoldApiFeed` (défaut) | aucune | REST, polling 10 s | mid seul → spread synthétique réaliste 0.30–0.60 $ |
| `GoldApiIoFeed` | GoldAPI.io | REST, polling 15 s | **bid/ask réels** + high/low du jour (meilleur rattrapage) |
| `TwelveDataFeed` | Twelve Data | WebSocket (~170 ms) | reconnexion à backoff exponentiel |
| `SimFeed` (fallback) | — | GBM local | vol 0.8 %/jour, clustering GARCH-lite, **ancré sur le dernier prix live** |

- Si le flux live se tait plus de **60 s** → bascule automatique en `SimFeed` avec bannière **« FLUX SIMULÉ — reconnexion… »**. Retour au live loggé dès la reconnexion.
- Le `SimFeed` n'a **jamais** d'ancre hardcodée : sans au moins un prix réel (reçu ou persisté), il refuse de simuler.
- Les clés API se saisissent dans l'onglet **Réglages** et restent en `localStorage` — jamais commitées.
- **Marché fermé** (ven ~21h → dim ~22h UTC + jours fériés majeurs) : l'app affiche « MARCHÉ FERMÉ » ; un toggle permet de s'entraîner sur le `SimFeed`, clairement étiqueté.

## Moteur (`src/engine/`, logique pure sans React)

Le cerveau applique une **stratégie ICT** (Inner Circle Trader) mécanisée sur des bougies M1/M5 agrégées depuis les ticks réels (et persistées, l'historique survit aux redémarrages) :

- **Structure de marché** — swings fractals, biais M5 (HH/HL → haussier, LH/LL → baissier), **MSS** (Market Structure Shift : clôture au-delà du dernier swing opposé).
- **FVG / IFVG** — Fair Value Gaps à 3 bougies avec suivi d'état : un FVG percé en clôture **s'inverse** (IFVG) et se trade au retest dans l'autre sens ; une inversion invalidée meurt. Order block adjacent (dernière bougie opposée avant le displacement) compté en confluence.
- **Liquidité** — PDH/PDL (high/low du jour précédent), ranges asiatique (00–07) et de Londres (07–12), **EQH/EQL** (doubles sommets/creux ≈ pools de stops), et détection de **sweeps** (mèche au-delà d'un niveau puis clôture de retour = raid des stops).
- **Premium/Discount** — équilibre du dealing range ; on préfère acheter en discount, vendre en premium.
- **Kill zones** — London 07–10 UTC, New York 12–15 UTC ; hors KZ le seuil de confluence est durci.
- **Modèles d'entrée** — `Sweep+MSS` (modèle 2022 : raid de liquidité → MSS → retrace dans le FVG du displacement, la plus forte confluence), `FVG` (retrace en tendance), `IFVG` (retest d'inversion). **SL derrière la zone/l'extrême du sweep**, **cible = prochaine pool de liquidité** (draw on liquidity) ; R:R < 1.3 → rejeté.

- **`clock.ts`** — temps réel, sessions UTC (Sydney/Asia, London 07–12, Overlap 12–16, NY 16–21, Close) + kill zones. La session module la fréquence de scan et le seuil de confluence.
- **`candles.ts` / `ict.ts` / `brain.ts`** — agrégation M1/M5/jours, primitives ICT ci-dessus, scoring de confluence. **winProb plafonnée à 56 %** ; l'edge vient du R:R (1.3–2.6). Les setups filtrés sont rejetés **et loggés** avec la raison ; une zone tradée n'est pas re-tradée pendant 45 min.
- **`risk.ts`** — 1 % de l'équité par trade (lot via distance SL sur ATR des ticks réels), anti-martingale ×0.7 par perte consécutive (cap 3), cooldown 45 min après 3 pertes, **daily loss limit −3 % → HALTED** jusqu'au jour UTC suivant, max 3 positions, commission 3.50 $/lot, swap −0.45 $/lot/h.
- **`executor.ts`** — entrée à l'ask + slippage (BUY) / bid − slippage (SELL), slippage aléatoire proportionnel à la vol de session ; SL/TP surveillés à chaque tick, clôture au toucher ; chaque trade porte une **Decision Logic** ICT (zone, biais, MSS, sweep, cible de liquidité, risque chiffré) visible dans l'onglet Audit.
- **Persistance** — état complet (positions, historique, équité, logs) en IndexedDB via `idb-keyval` : l'app reprend où elle en était.

## Installer sur iPhone

1. Ouvre l'app dans **Safari**.
2. **Partager** → **« Sur l'écran d'accueil »**.
3. L'app s'ouvre plein écran (standalone, safe-area gérée pour l'encoche et la home bar), fonctionne hors ligne (dernier état + bannière « HORS LIGNE »).

> iOS n'affiche pas de prompt d'installation automatique — c'est la procédure normale d'Apple, rappelée dans l'onglet Réglages.

## ⚠️ Limite iOS importante

Une PWA iOS est **suspendue en arrière-plan** : **le bot ne trade PAS quand l'app est fermée.** Au retour, AURUM :

1. récupère le prix actuel ;
2. réévalue les positions ouvertes contre SL/TP en utilisant le **high/low de la période manquée** si l'API le fournit (GoldAPI.io donne le high/low du jour), sinon le prix courant — si SL **et** TP étaient tous deux dans le range manqué, le **pire cas (SL)** est retenu ;
3. logge une ligne **« rattrapage après suspension »**.

L'app ne prétendra **jamais** avoir tradé en arrière-plan.

## Structure

```
src/engine/      logique pure (clock, brain, risk, executor, stats) + tests
src/data/        couche marché : adapters PriceFeed + FeedManager (failover) + tests
src/state/       store zustand, BotController (timers), persistance IndexedDB, settings
src/components/  UI mobile-first : 5 onglets (Live, Charts, Log, Audit, Réglages)
public/icons/    icônes PWA générées depuis scripts/icon-source*.svg
```

## Tests (`npm test`)

- ICT : détection FVG + order block, inversion en IFVG et invalidation, sweeps de liquidité, biais HH/HL et LH/LL, MSS, agrégation M1/M5 et clôture des jours (PDH/PDL).
- Brain : scénario complet d'entrée BUY sur FVG en kill zone, anti-réentrée de zone, durcissement hors KZ, rejet R:R < 1.3, silence sans historique ou sans zone au contact.
- Sizing : 1 % risqué exact pour une distance SL donnée, anti-martingale, arrondi de lot.
- Déclenchement SL/TP sur séquences de ticks synthétiques (bid pour BUY, ask pour SELL).
- Cooldown après 3 pertes · halt quotidien à −3 % · levée du halt au jour UTC suivant.
- Failover : live silencieux → SimFeed en < 60 s → retour au live à la reconnexion (et refus de simuler sans ancre réelle).
- Rattrapage post-suspension : clôture correcte au SL/TP sur le range manqué, cas pire SL prioritaire.
