import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import type { AppStore } from '../app/store';
import type { Repository } from '../storage/repository';
import { AppProvider, useApp, useAppStore } from './AppContext';
import { Banner } from './components/common';
import { downloadText } from './download';
import { Layout } from './Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { FinancesPage } from './pages/FinancesPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { RepositoryProvider } from './RepositoryContext';
import { STAGE_LABELS } from '../storage/migrations';
import { EventsPage } from './pages/EventsPage';
import { ProjectionPage } from './pages/ProjectionPage';
import { ScenariosPage } from './pages/ScenariosPage';

function CorruptScreen() {
  const corrupt = useApp((s) => s.corrupt);
  const store = useAppStore();
  if (!corrupt) return null;
  return (
    <div className="page page--center">
      <h1>保存データを読み込めませんでした</h1>
      <Banner kind="error">
        {STAGE_LABELS[corrupt.error.stage]}: {corrupt.error.message}
        {corrupt.error.issues && (
          <ul>
            {corrupt.error.issues.map((i) => (
              <li key={i}>
                <code>{i}</code>
              </li>
            ))}
          </ul>
        )}
      </Banner>
      <p>データはまだ削除されていません。次のいずれかを選んでください。</p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => downloadText('lifeplan-unreadable-data.json', JSON.stringify(corrupt.raw, null, 2), 'application/json')}>
          読み込めなかったデータをファイルに保存
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            if (window.confirm('読み込めなかったデータを退避領域に移し、新しいデータで開始しますか？')) void store.getState().startFreshFromCorrupt();
          }}
        >
          退避して新規に開始
        </button>
      </div>
      <p className="muted small">新規に開始した後でも「データ管理 → 自動退避」から元のデータをファイルとして保存できます。</p>
    </div>
  );
}

function Shell() {
  const loadState = useApp((s) => s.loadState);
  const fatal = useApp((s) => s.fatalError);
  const migratedFrom = useApp((s) => s.migratedFrom);
  const store = useAppStore();
  const saveState = useApp((s) => s.saveState);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const st = store.getState().saveState;
      if (st === 'pending' || st === 'saving' || st === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [store]);

  if (loadState === 'loading') return <p className="page">読み込み中…</p>;
  if (loadState === 'fatal')
    return (
      <div className="page page--center">
        <h1>データ保存領域を利用できません</h1>
        <Banner kind="error">
          ブラウザの保存領域（IndexedDB）にアクセスできませんでした。プライベートブラウズや保存の無効化が原因の可能性があります。（{fatal}）
        </Banner>
      </div>
    );
  if (loadState === 'corrupt') return <CorruptScreen />;
  return (
    <HashRouter>
      {migratedFrom !== null && saveState !== 'error' && (
        <div className="topnote">保存データを v{migratedFrom} から現在の形式へ移行しました（移行前のデータは自動退避に保存されています）。</div>
      )}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="finances" element={<FinancesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="projection" element={<ProjectionPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export function App({ store, repo }: { store: AppStore; repo: Repository }) {
  useEffect(() => {
    void store.getState().init();
  }, [store]);
  return (
    <RepositoryProvider repo={repo}>
      <AppProvider store={store}>
        <Shell />
      </AppProvider>
    </RepositoryProvider>
  );
}
