// Persistance IndexedDB (idb-keyval) : l'app reprend où elle en était.

import { get, set, del } from "idb-keyval";
import type { EngineState } from "../engine/types";

const ENGINE_KEY = "aurum-engine-state-v1";

export async function loadEngineState(): Promise<EngineState | null> {
  try {
    const state = await get<EngineState>(ENGINE_KEY);
    if (!state || typeof state.balance !== "number") return null;
    return state;
  } catch {
    return null;
  }
}

export async function saveEngineState(state: EngineState): Promise<void> {
  try {
    // Copie structurée pour éviter de persister des proxys.
    await set(ENGINE_KEY, JSON.parse(JSON.stringify(state)) as EngineState);
  } catch {
    // Stockage plein ou indisponible : on continue en mémoire.
  }
}

export async function clearEngineState(): Promise<void> {
  try {
    await del(ENGINE_KEY);
  } catch {
    // ignore
  }
}
