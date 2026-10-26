import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { appData, scenario } from '../../tests/unit/fixtures';
import { Repository, type KV } from '../storage/repository';
import { createAppStore } from './store';

let seq = 0;
const memKV = (): KV & { map: Map<string, unknown>; failSet: boolean } => {
  const map = new Map<string, unknown>();
  const kv = {
    map,
    failSet: false,
    get: async (k: string) => structuredClone(map.get(k)),
    set: async (k: string, v: unknown) => {
      if (kv.failSet) throw new Error('書き込み失敗（テスト）');
      map.set(k, structuredClone(v));
    },
    del: async (k: string) => void map.delete(k),
  };
  return kv;
};

describe('アプリストア', () => {
  it('初回起動は新規データで ready', async () => {
    const store = createAppStore(new Repository(`s-${++seq}`), { debounceMs: 0 });
    await store.getState().init();
    expect(store.getState().loadState).toBe('ready');
    expect(store.getState().data?.scenarios).toHaveLength(1);
  });

  it('編集 → pending → 保存成功で saved。再読み込みで保持', async () => {
    const kv = memKV();
    const store = createAppStore(new Repository(kv), { debounceMs: 0 });
    await store.getState().init();
    store.getState().updateActiveScenario((s) => ({ ...s, name: '変更後' }));
    expect(store.getState().saveState).toBe('pending');
    await store.getState().flush();
    expect(store.getState().saveState).toBe('saved');

    const store2 = createAppStore(new Repository(kv));
    await store2.getState().init();
    expect(store2.getState().data?.scenarios[0]!.name).toBe('変更後');
  });

  it('保存に失敗したら saved にせず error を表示し、メモリ上のデータは保持する', async () => {
    const kv = memKV();
    const store = createAppStore(new Repository(kv), { debounceMs: 0 });
    await store.getState().init();
    kv.failSet = true;
    store.getState().updateActiveScenario((s) => ({ ...s, name: '未保存' }));
    await store.getState().flush();
    expect(store.getState().saveState).toBe('error');
    expect(store.getState().saveError).toContain('書き込み失敗');
    expect(store.getState().data?.scenarios[0]!.name).toBe('未保存');
    // 復旧後の再試行で保存される
    kv.failSet = false;
    await store.getState().retrySave();
    expect(store.getState().saveState).toBe('saved');
  });

  it('保存中に編集された場合は saved にせず再保存する', async () => {
    const kv = memKV();
    let release: () => void = () => {};
    const slow: KV = {
      ...kv,
      set: (k, v) =>
        new Promise<void>((res) => {
          release = () => {
            kv.map.set(k, structuredClone(v));
            res();
          };
        }),
    };
    const store = createAppStore(new Repository(slow), { debounceMs: 0 });
    await store.getState().init();
    store.getState().updateActiveScenario((s) => ({ ...s, name: '1' }));
    const p = store.getState().flush();
    await Promise.resolve();
    store.getState().updateActiveScenario((s) => ({ ...s, name: '2' }));
    release();
    await p;
    expect(store.getState().saveState).not.toBe('saved');
    await new Promise((r) => setTimeout(r, 5));
    release();
    await store.getState().flush();
    expect(store.getState().saveState).toBe('saved');
    expect((kv.map.get('data') as any).scenarios[0].name).toBe('2');
  });

  it('破損データでは corrupt になり、新規開始時に元データを退避する', async () => {
    const kv = memKV();
    kv.map.set('data', { app: 'lifeplan', schemaVersion: 1, broken: true });
    const repo = new Repository(kv);
    const store = createAppStore(repo, { debounceMs: 0 });
    await store.getState().init();
    expect(store.getState().loadState).toBe('corrupt');
    // この時点でデータは消えていない
    expect(kv.map.get('data')).toEqual({ app: 'lifeplan', schemaVersion: 1, broken: true });
    await store.getState().startFreshFromCorrupt();
    expect(store.getState().loadState).toBe('ready');
    const backups = await repo.listBackups();
    expect(backups[0]!.reason).toBe('corrupt');
    expect(backups[0]!.data).toEqual({ app: 'lifeplan', schemaVersion: 1, broken: true });
  });

  it('replaceAll（インポート）が失敗したら画面の状態を変えない', async () => {
    const kv = memKV();
    const store = createAppStore(new Repository(kv), { debounceMs: 0 });
    await store.getState().init();
    const before = store.getState().data;
    kv.failSet = true;
    await expect(store.getState().replaceAll(appData([scenario({ name: 'X' })]), 'import')).rejects.toThrow();
    expect(store.getState().data).toBe(before);
  });

  it('シナリオの複製・削除。最後の 1 件は削除できない', async () => {
    const store = createAppStore(new Repository(memKV()), { debounceMs: 0 });
    await store.getState().init();
    const firstId = store.getState().data!.activeScenarioId;
    const copyId = store.getState().duplicateScenario(firstId, '複製');
    expect(store.getState().data!.scenarios).toHaveLength(2);
    expect(store.getState().data!.activeScenarioId).toBe(copyId);
    store.getState().updateScenario(copyId, (s) => ({ ...s, name: '複製を変更' }));
    expect(store.getState().data!.scenarios.find((s) => s.id === firstId)!.name).toBe('基本プラン');
    store.getState().deleteScenario(copyId);
    store.getState().deleteScenario(firstId);
    expect(store.getState().data!.scenarios).toHaveLength(1);
  });
});
