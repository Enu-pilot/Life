// アプリ状態とユースケース（architecture.md §2 アプリ層）。
// 保存は編集後 500ms のデバウンスで行い、成功を確認してから「保存済み」にする。

import { createStore, type StoreApi } from 'zustand/vanilla';
import { duplicateScenario, newAppData, newScenario } from '../domain/factory';
import { sampleScenario } from '../domain/sample';
import type { AppData, Scenario, Settings } from '../domain/schema';
import type { MigrateResult } from '../storage/migrations';
import type { BackupReason, Repository } from '../storage/repository';

export type LoadState = 'loading' | 'ready' | 'corrupt' | 'fatal';
export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export type AppState = {
  loadState: LoadState;
  data: AppData | null;
  corrupt: { raw: unknown; error: Extract<MigrateResult, { ok: false }> } | null;
  fatalError: string | null;
  migratedFrom: number | null;
  saveState: SaveState;
  saveError: string | null;
  /** 編集回数。保存中に編集されたかの判定に使う */
  revision: number;

  init(): Promise<void>;
  updateScenario(id: string, fn: (s: Scenario) => Scenario): void;
  updateActiveScenario(fn: (s: Scenario) => Scenario): void;
  setActiveScenario(id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  createScenario(name: string): string;
  duplicateScenario(id: string, name: string): string;
  /** サンプルシナリオを追加して表示する */
  addSampleScenario(): string;
  deleteScenario(id: string): void;
  /** インポート・復元・初期化。成功するまで画面の状態は変えない */
  replaceAll(next: AppData | null, reason: BackupReason): Promise<void>;
  /** 破損データを退避してから新規データで開始する */
  startFreshFromCorrupt(): Promise<void>;
  retrySave(): Promise<void>;
  flush(): Promise<void>;
};

export type AppStore = StoreApi<AppState>;

export function createAppStore(repo: Repository, opts: { now?: () => Date; debounceMs?: number } = {}): AppStore {
  const now = opts.now ?? (() => new Date());
  const debounceMs = opts.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  return createStore<AppState>((setState, getState) => {
    const doSave = async (): Promise<void> => {
      const { data, revision } = getState();
      if (!data) return;
      setState({ saveState: 'saving' });
      const toSave: AppData = { ...data, savedAt: now().toISOString() };
      try {
        await repo.save(toSave);
        if (getState().revision === revision) {
          setState({ saveState: 'saved', saveError: null });
        } else {
          schedule();
        }
      } catch (e) {
        setState({ saveState: 'error', saveError: e instanceof Error ? e.message : String(e) });
      }
    };
    const runSave = (): Promise<void> => {
      timer = null;
      inflight = doSave().finally(() => {
        inflight = null;
      });
      return inflight;
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      setState({ saveState: 'pending' });
      timer = setTimeout(() => void runSave(), debounceMs);
    };
    const mutate = (fn: (d: AppData) => AppData) => {
      const d = getState().data;
      if (!d) return;
      setState({ data: fn(d), revision: getState().revision + 1 });
      schedule();
    };

    return {
      loadState: 'loading',
      data: null,
      corrupt: null,
      fatalError: null,
      migratedFrom: null,
      saveState: 'saved',
      saveError: null,
      revision: 0,

      async init() {
        try {
          const r = await repo.load();
          if (r.status === 'empty') {
            setState({ loadState: 'ready', data: newAppData(now()), saveState: 'saved' });
          } else if (r.status === 'ok') {
            setState({ loadState: 'ready', data: r.data, migratedFrom: r.migratedFrom ?? null, saveState: 'saved' });
          } else {
            setState({ loadState: 'corrupt', corrupt: { raw: r.raw, error: r.error } });
          }
        } catch (e) {
          setState({ loadState: 'fatal', fatalError: e instanceof Error ? e.message : String(e) });
        }
      },

      updateScenario(id, fn) {
        mutate((d) => ({
          ...d,
          scenarios: d.scenarios.map((s) => (s.id === id ? { ...fn(s), updatedAt: now().toISOString() } : s)),
        }));
      },
      updateActiveScenario(fn) {
        const d = getState().data;
        if (d) getState().updateScenario(d.activeScenarioId, fn);
      },
      setActiveScenario(id) {
        mutate((d) => (d.scenarios.some((s) => s.id === id) ? { ...d, activeScenarioId: id } : d));
      },
      updateSettings(patch) {
        mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      },
      createScenario(name) {
        const base = getState().data?.scenarios.find((s) => s.id === getState().data?.activeScenarioId);
        const s = newScenario(name, now());
        // 世帯構成は新規作成時にも引き継がない（空から作成）。開始年月は現在のシナリオに合わせる
        if (base) s.assumptions = { ...s.assumptions, startYm: base.assumptions.startYm };
        mutate((d) => ({ ...d, scenarios: [...d.scenarios, s], activeScenarioId: s.id }));
        return s.id;
      },
      duplicateScenario(id, name) {
        const src = getState().data?.scenarios.find((s) => s.id === id);
        if (!src) throw new Error('複製元のシナリオが見つかりません');
        const copy = duplicateScenario(src, name, now());
        mutate((d) => ({ ...d, scenarios: [...d.scenarios, copy], activeScenarioId: copy.id }));
        return copy.id;
      },
      addSampleScenario() {
        const s = sampleScenario(now());
        mutate((d) => ({ ...d, scenarios: [...d.scenarios, s], activeScenarioId: s.id }));
        return s.id;
      },
      deleteScenario(id) {
        mutate((d) => {
          if (d.scenarios.length <= 1) return d;
          const scenarios = d.scenarios.filter((s) => s.id !== id);
          return { ...d, scenarios, activeScenarioId: d.activeScenarioId === id ? scenarios[0]!.id : d.activeScenarioId };
        });
      },

      async replaceAll(next, reason) {
        if (timer) clearTimeout(timer);
        timer = null;
        if (inflight) await inflight;
        await repo.replace(next ? { ...next, savedAt: now().toISOString() } : null, reason);
        setState({
          data: next ?? newAppData(now()),
          revision: getState().revision + 1,
          saveState: 'saved',
          saveError: null,
          loadState: 'ready',
          corrupt: null,
          migratedFrom: null,
        });
      },

      async startFreshFromCorrupt() {
        const c = getState().corrupt;
        if (c) await repo.pushBackup('corrupt', c.raw);
        await repo.clear();
        setState({ loadState: 'ready', corrupt: null, data: newAppData(now()), saveState: 'saved' });
      },

      async retrySave() {
        if (timer) clearTimeout(timer);
        await runSave();
      },
      async flush() {
        if (timer) {
          clearTimeout(timer);
          await runSave();
        } else if (inflight) {
          await inflight;
        }
      },
    };
  });
}
