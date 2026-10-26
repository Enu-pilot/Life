// 保存データのバージョン検査とマイグレーション（architecture.md §5.2）。
// 旧版 → 現行版へ逐次変換し、最後に Zod で検証する。既存データは変更しない（新しいオブジェクトを返す）。

import { CURRENT_SCHEMA_VERSION, parseAppData, type AppData } from '../../domain/schema';

type RawObject = Record<string, unknown>;
/** キー n のマイグレーションは version n → n+1 に変換する */
export const MIGRATIONS: Record<number, (raw: RawObject) => RawObject> = {};

export type MigrateStage = 'format' | 'app' | 'version' | 'migration' | 'schema';
export type MigrateResult =
  | { ok: true; data: AppData; fromVersion: number }
  | { ok: false; stage: MigrateStage; message: string; issues?: string[] };

export const STAGE_LABELS: Record<MigrateStage, string> = {
  format: 'ファイル形式',
  app: 'アプリ識別',
  version: 'データバージョン',
  migration: 'データ移行',
  schema: '項目の検証',
};

export function migrate(
  raw: unknown,
  migrations = MIGRATIONS,
  current = CURRENT_SCHEMA_VERSION,
  parse: (raw: unknown) => ReturnType<typeof parseAppData> = parseAppData,
): MigrateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, stage: 'format', message: 'データがオブジェクト形式ではありません' };
  }
  const obj = raw as RawObject;
  if (obj.app !== 'lifeplan') {
    return { ok: false, stage: 'app', message: 'LifePlan のデータではありません' };
  }
  const v = obj.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { ok: false, stage: 'version', message: 'データバージョン（schemaVersion）が不正です' };
  }
  if (v > current) {
    return {
      ok: false,
      stage: 'version',
      message: `このデータはより新しいバージョンのアプリで作成されています（データ: v${v}、アプリ: v${current}）。アプリを更新してください。`,
    };
  }
  let cur: RawObject = structuredClone(obj);
  for (let ver = v; ver < current; ver++) {
    const step = migrations[ver];
    if (!step) return { ok: false, stage: 'migration', message: `v${ver} から v${ver + 1} への移行処理がありません` };
    try {
      cur = step(cur);
    } catch (e) {
      return { ok: false, stage: 'migration', message: `v${ver} → v${ver + 1} の移行に失敗しました: ${String(e)}` };
    }
    if (cur.schemaVersion !== ver + 1) {
      return { ok: false, stage: 'migration', message: `v${ver} の移行結果のバージョンが不正です` };
    }
  }
  const parsed = parse(cur);
  if (!parsed.ok) return { ok: false, stage: 'schema', message: 'データの項目に不正な値があります', issues: parsed.issues };
  return { ok: true, data: parsed.data, fromVersion: v };
}
