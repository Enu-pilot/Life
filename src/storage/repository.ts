// IndexedDB への保存・読み込み・退避世代（architecture.md §5.3）。
// データはこのブラウザ内にのみ保存し、外部へ送信しない。

import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { AppData } from '../domain/schema';
import { migrate, type MigrateResult } from './migrations';

const DATA_KEY = 'data';
const BACKUPS_KEY = 'backups';
export const MAX_BACKUPS = 5; // Q-16

export type BackupReason = 'import' | 'reset' | 'migration' | 'restore' | 'daily' | 'corrupt';

export type BackupEntry = {
  id: string;
  createdAt: string;
  reason: BackupReason;
  /** 退避時点の生データ（旧バージョンの可能性あり。復元時に migrate する） */
  data: unknown;
};

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData; migratedFrom?: number }
  | { status: 'corrupt'; raw: unknown; error: Extract<MigrateResult, { ok: false }> };

/** キー・値ストア（既定は IndexedDB。テストで失敗を注入するために差し替え可能） */
export type KV = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
};

export function idbKV(dbName = 'lifeplan', storeName = 'kv'): KV {
  const store: UseStore = createStore(dbName, storeName);
  return {
    get: (k) => get(k, store),
    set: (k, v) => set(k, v, store),
    del: (k) => del(k, store),
  };
}

export class Repository {
  readonly kv: KV;

  constructor(kvOrDbName: KV | string = 'lifeplan', storeName = 'kv') {
    this.kv = typeof kvOrDbName === 'string' ? idbKV(kvOrDbName, storeName) : kvOrDbName;
  }

  async load(): Promise<LoadResult> {
    const raw = await this.kv.get(DATA_KEY);
    if (raw === undefined) return { status: 'empty' };
    const r = migrate(raw);
    if (!r.ok) return { status: 'corrupt', raw, error: r };
    if (r.fromVersion !== r.data.schemaVersion) {
      // 移行前のデータを退避してから移行後データを保存する
      await this.pushBackup('migration', raw);
      await this.save(r.data);
      return { status: 'ok', data: r.data, migratedFrom: r.fromVersion };
    }
    return { status: 'ok', data: r.data };
  }

  /** 失敗時は例外を投げる（呼び出し側で保存失敗を表示する）。 */
  async save(data: AppData): Promise<void> {
    await this.kv.set(DATA_KEY, data);
  }

  async clear(): Promise<void> {
    await this.kv.del(DATA_KEY);
  }

  async listBackups(): Promise<BackupEntry[]> {
    const v = await this.kv.get(BACKUPS_KEY);
    return Array.isArray(v) ? (v as BackupEntry[]) : [];
  }

  async pushBackup(reason: BackupReason, data: unknown, now = new Date()): Promise<void> {
    const list = await this.listBackups();
    const entry: BackupEntry = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now.toISOString(),
      reason,
      data,
    };
    await this.kv.set(BACKUPS_KEY, [entry, ...list].slice(0, MAX_BACKUPS));
  }

  /**
   * データを置き換える（インポート・復元・初期化）。置換前のデータを退避世代に保存してから書き込む。
   * 書き込みに失敗した場合は元のデータを書き戻し、例外を投げる。
   */
  async replace(next: AppData | null, reason: BackupReason): Promise<void> {
    const prev = await this.kv.get(DATA_KEY);
    if (prev !== undefined) await this.pushBackup(reason, prev);
    try {
      if (next === null) await this.kv.del(DATA_KEY);
      else {
        await this.kv.set(DATA_KEY, next);
        // 書き込み結果を読み戻して確認する（不一致なら書き戻して失敗扱い）
        const check = await this.kv.get(DATA_KEY);
        if (JSON.stringify(check) !== JSON.stringify(next)) throw new Error('保存したデータの確認に失敗しました');
      }
    } catch (e) {
      if (prev !== undefined) {
        try {
          await this.kv.set(DATA_KEY, prev);
        } catch {
          // 書き戻しにも失敗した場合でも、退避世代には残っている
        }
      }
      throw e;
    }
  }
}

/** ブラウザによる自動削除の抑止を要求する。結果（許可されたか）を返す。 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // 非対応
  }
  return null;
}
