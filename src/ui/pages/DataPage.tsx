import { useEffect, useState } from 'react';
import type { AppData } from '../../domain/schema';
import { ENGINE_VERSION } from '../../engine/version';
import { backupFileName, buildBackupFile, parseBackupFile, PERSONAL_DATA_NOTICE, type ImportError, type ImportPreview } from '../../storage/backupFile';
import { migrate } from '../../storage/migrations';
import type { BackupEntry } from '../../storage/repository';
import { useApp, useAppStore, useData } from '../AppContext';
import { useRepository } from '../RepositoryContext';
import { Banner, Dialog } from '../components/common';
import { downloadText } from '../download';

const REASON: Record<string, string> = {
  import: 'インポート前',
  reset: '全データ削除前',
  migration: 'データ形式の移行前',
  restore: '復元前',
  daily: '自動',
  corrupt: '読み込めなかったデータ',
};

export function DataPage() {
  const data = useData();
  const store = useAppStore();
  const repo = useRepository();
  const saveState = useApp((s) => s.saveState);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [confirmReset, setConfirmReset] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadBackups = () => {
    repo
      .listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  };
  useEffect(reloadBackups, [repo]);

  const doExport = async () => {
    const now = new Date();
    // 未保存の変更を先に保存してから出力する
    await store.getState().flush();
    const text = await buildBackupFile(data, ENGINE_VERSION, now);
    downloadText(backupFileName(now), text, 'application/json');
    store.getState().updateSettings({ lastExportedAt: now.toISOString() });
    setMessage({ kind: 'info', text: `エクスポートしました（${backupFileName(now)}）。${PERSONAL_DATA_NOTICE}` });
  };

  const onFile = async (file: File | undefined) => {
    setImportError(null);
    setPreview(null);
    setMessage(null);
    if (!file) return;
    const text = await file.text();
    const r = await parseBackupFile(text);
    if (r.ok) setPreview(r.preview);
    else setImportError(r.error);
  };

  const applyImport = async (next: AppData) => {
    setBusy(true);
    try {
      await store.getState().replaceAll(next, 'import');
      setPreview(null);
      setMessage({ kind: 'info', text: 'インポートしました。以前のデータは「自動退避」に保存されています。' });
      reloadBackups();
    } catch (e) {
      setMessage({ kind: 'error', text: `インポートに失敗しました。現在のデータは変更されていません。（${String(e)}）` });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (b: BackupEntry) => {
    const r = migrate(b.data);
    if (!r.ok) {
      setMessage({ kind: 'error', text: `この退避データは復元できません: ${r.message}` });
      return;
    }
    if (!window.confirm(`${new Date(b.createdAt).toLocaleString('ja-JP')} の退避データで現在のデータを置き換えますか？（現在のデータは退避されます）`)) return;
    setBusy(true);
    try {
      await store.getState().replaceAll(r.data, 'restore');
      setMessage({ kind: 'info', text: '復元しました。' });
      reloadBackups();
    } catch (e) {
      setMessage({ kind: 'error', text: `復元に失敗しました。現在のデータは変更されていません。（${String(e)}）` });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await store.getState().replaceAll(null, 'reset');
      setConfirmReset('');
      setMessage({ kind: 'info', text: '全データを削除しました。削除前のデータは「自動退避」に残っています。' });
      reloadBackups();
    } catch (e) {
      setMessage({ kind: 'error', text: `削除に失敗しました。（${String(e)}）` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>データ管理</h1>
      <Banner kind="info">
        データはこのブラウザ内（IndexedDB）にのみ保存され、外部には送信されません。ブラウザのデータ消去や端末の変更で失われるため、定期的にエクスポートしてください。
      </Banner>
      {message && <Banner kind={message.kind === 'error' ? 'error' : 'info'}>{message.text}</Banner>}

      <section className="card">
        <h2>エクスポート（バックアップ）</h2>
        <p>全シナリオ・前提条件・イベントを含む JSON ファイルを保存します。</p>
        <Banner kind="warn">{PERSONAL_DATA_NOTICE}</Banner>
        <p className="muted small">
          最終エクスポート: {data.settings.lastExportedAt ? new Date(data.settings.lastExportedAt).toLocaleString('ja-JP') : '未実施'}
        </p>
        <button type="button" className="btn btn--primary" onClick={() => void doExport()} disabled={saveState === 'error'}>
          エクスポート
        </button>
        {saveState === 'error' && <p className="field__error">保存エラー中は、画面上の最新データをエクスポートできない可能性があります。保存を再試行してください。</p>}
      </section>

      <section className="card">
        <h2>インポート（復元）</h2>
        <p>エクスポートしたファイルを読み込み、現在のデータを置き換えます。確認画面で内容を確かめてから置き換えます。</p>
        <label className="file">
          <span>ファイルを選択</span>
          <input type="file" accept="application/json,.json" aria-label="インポートするファイル" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {importError && (
          <Banner kind="error">
            <strong>読み込めませんでした（{importError.label}）</strong>: {importError.message}
            {importError.issues && (
              <ul>
                {importError.issues.map((i) => (
                  <li key={i}>
                    <code>{i}</code>
                  </li>
                ))}
              </ul>
            )}
            <div>現在のデータは変更されていません。</div>
          </Banner>
        )}
      </section>

      <section className="card">
        <h2>自動退避</h2>
        <p className="muted small">インポート・復元・全削除・データ形式の移行の直前に、その時点のデータを最大 5 件まで自動で退避します。</p>
        {backups.length === 0 ? (
          <p className="muted">退避データはありません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>日時</th>
                <th>理由</th>
                <th>
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString('ja-JP')}</td>
                  <td>{REASON[b.reason] ?? b.reason}</td>
                  <td className="table__actions">
                    <button type="button" className="btn btn--small" disabled={busy} onClick={() => void restore(b)}>
                      復元
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => downloadText(`lifeplan-retained-${b.id}.json`, JSON.stringify(b.data, null, 2), 'application/json')}
                    >
                      生データを保存
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card--danger">
        <h2>全データ削除（初期化）</h2>
        <p>すべてのシナリオと設定を削除し、初期状態に戻します。削除前のデータは自動退避に残ります。</p>
        <label className="field">
          確認のため「削除」と入力してください
          <input type="text" value={confirmReset} onChange={(e) => setConfirmReset(e.target.value)} aria-label="削除の確認入力" />
        </label>
        <button type="button" className="btn btn--danger" disabled={confirmReset !== '削除' || busy} onClick={() => void reset()}>
          全データを削除
        </button>
      </section>

      {preview && (
        <Dialog
          title="インポートの確認"
          onClose={() => setPreview(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                キャンセル
              </button>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void applyImport(preview.data)}>
                現在のデータを置き換える
              </button>
            </>
          }
        >
          <dl className="dl">
            <dt>シナリオ</dt>
            <dd>
              {preview.scenarioNames.length} 件（{preview.scenarioNames.join('、')}）
            </dd>
            <dt>エクスポート日時</dt>
            <dd>{preview.exportedAt ? new Date(preview.exportedAt).toLocaleString('ja-JP') : '不明'}</dd>
            <dt>データ形式</dt>
            <dd>
              v{preview.fromVersion}
              {preview.fromVersion !== preview.data.schemaVersion && `（v${preview.data.schemaVersion} に移行して読み込みます）`}
            </dd>
          </dl>
          {preview.integrity === 'mismatch' && (
            <Banner kind="warn">ファイルの内容がエクスポート時から変更されています（整合性チェック不一致）。内容を確認したうえで続行してください。</Banner>
          )}
          {preview.integrity === 'missing' && <Banner kind="warn">整合性情報がありません。</Banner>}
          <Banner kind="warn">現在のデータはこのファイルの内容で置き換えられます（置き換え前のデータは自動退避されます）。</Banner>
        </Dialog>
      )}
    </div>
  );
}
