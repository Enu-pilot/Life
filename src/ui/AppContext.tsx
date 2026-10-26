import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { AppState, AppStore } from '../app/store';
import type { AppData, Scenario } from '../domain/schema';

const Ctx = createContext<AppStore | null>(null);

export function AppProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useAppStore(): AppStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('AppProvider がありません');
  return s;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useAppStore(), selector);
}

/** ready 状態でのみ使う */
export function useData(): AppData {
  const d = useApp((s) => s.data);
  if (!d) throw new Error('データが読み込まれていません');
  return d;
}

export function useActiveScenario(): Scenario {
  const d = useData();
  const s = d.scenarios.find((x) => x.id === d.activeScenarioId);
  if (!s) throw new Error('シナリオが見つかりません');
  return s;
}

export function useUnit() {
  return useApp((s) => s.data?.settings.displayUnit ?? 'man');
}
