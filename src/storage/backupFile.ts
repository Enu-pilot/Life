// エクスポート / インポート用のバックアップファイル（architecture.md §5.4）。

import type { AppData } from '../domain/schema';
import { migrate, STAGE_LABELS, type MigrateStage } from './migrations';

export const BACKUP_KIND = 'lifeplan-backup';
export const BACKUP_FILE_VERSION = 1;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export type BackupFile = {
  kind: typeof BACKUP_KIND;
  fileVersion: number;
  exportedAt: string;
  engineVersion: string;
  notice: string;
  integrity: { algorithm: 'SHA-256'; value: string };
  data: AppData;
};

export const PERSONAL_DATA_NOTICE =
  'このファイルには家族構成・生年月・収入・資産などの個人情報が含まれます。取り扱いに注意してください。';

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildBackupFile(data: AppData, engineVersion: string, now: Date): Promise<string> {
  const file: BackupFile = {
    kind: BACKUP_KIND,
    fileVersion: BACKUP_FILE_VERSION,
    exportedAt: now.toISOString(),
    engineVersion,
    notice: PERSONAL_DATA_NOTICE,
    integrity: { algorithm: 'SHA-256', value: await sha256Hex(JSON.stringify(data)) },
    data,
  };
  return JSON.stringify(file, null, 2);
}

export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `lifeplan-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

export type ImportPreview = {
  data: AppData;
  fromVersion: number;
  exportedAt: string | undefined;
  integrity: 'ok' | 'mismatch' | 'missing';
  scenarioNames: string[];
};

export type ImportError = { stage: MigrateStage | 'size' | 'json' | 'kind'; label: string; message: string; issues?: string[] };

/** 検証のみを行い、保存はしない。既存データに一切触れない。 */
export async function parseBackupFile(text: string): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: ImportError }> {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: { stage: 'size', label: 'ファイルサイズ', message: 'ファイルが大きすぎます（上限 20MB）' } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { stage: 'json', label: 'ファイル形式', message: 'JSON として読み込めません。ファイルが壊れている可能性があります' } };
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== BACKUP_KIND) {
    return { ok: false, error: { stage: 'kind', label: 'アプリ識別', message: 'LifePlan のバックアップファイルではありません' } };
  }
  const file = parsed as Partial<BackupFile>;
  if (typeof file.fileVersion !== 'number' || file.fileVersion > BACKUP_FILE_VERSION) {
    return { ok: false, error: { stage: 'version', label: 'ファイル形式のバージョン', message: '対応していないバックアップ形式です' } };
  }
  let integrity: ImportPreview['integrity'] = 'missing';
  if (file.integrity && typeof file.integrity.value === 'string') {
    integrity = (await sha256Hex(JSON.stringify(file.data))) === file.integrity.value ? 'ok' : 'mismatch';
  }
  const r = migrate(file.data);
  if (!r.ok) {
    return { ok: false, error: { stage: r.stage, label: STAGE_LABELS[r.stage], message: r.message, ...(r.issues ? { issues: r.issues } : {}) } };
  }
  return {
    ok: true,
    preview: {
      data: r.data,
      fromVersion: r.fromVersion,
      exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : undefined,
      integrity,
      scenarioNames: r.data.scenarios.map((s) => s.name),
    },
  };
}
