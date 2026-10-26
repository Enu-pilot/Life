import { NavLink, Outlet, Link } from 'react-router';
import { formatPercent } from '../domain/format';
import { useActiveScenario, useApp, useAppStore, useData } from './AppContext';

const NAV = [
  { to: '/', label: 'ダッシュボード', end: true },
  { to: '/profile', label: 'プロフィール・前提' },
  { to: '/finances', label: '収入・支出・資産' },
  { to: '/events', label: '人生イベント' },
  { to: '/projection', label: '資産推移' },
  { to: '/scenarios', label: 'シナリオ' },
  { to: '/data', label: 'データ管理' },
  { to: '/settings', label: '設定・計算前提' },
];

function SaveStatus() {
  const saveState = useApp((s) => s.saveState);
  const saveError = useApp((s) => s.saveError);
  const store = useAppStore();
  if (saveState === 'error') {
    return (
      <span className="save save--error" role="alert">
        保存できません{saveError ? `（${saveError}）` : ''}
        <button type="button" className="btn btn--small" onClick={() => void store.getState().retrySave()}>
          再試行
        </button>
        <Link to="/data">エクスポート</Link>
      </span>
    );
  }
  const label = saveState === 'saved' ? '保存済み ✓' : saveState === 'saving' ? '保存中…' : '未保存の変更あり';
  return (
    <span className={`save save--${saveState}`} role="status" aria-live="polite" data-testid="save-status">
      {label}
    </span>
  );
}

export function Layout() {
  const data = useData();
  const scenario = useActiveScenario();
  const store = useAppStore();
  const a = scenario.assumptions;
  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="header__brand">
          LifePlan
        </Link>
        <label className="header__scenario">
          <span className="visually-hidden">表示中のシナリオ</span>
          <select
            value={data.activeScenarioId}
            onChange={(e) => store.getState().setActiveScenario(e.target.value)}
            aria-label="表示中のシナリオ"
          >
            {data.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Link to="/settings" className="header__chips" title="計算前提を確認">
          <span className="chip">物価 {formatPercent(a.inflationRate)}</span>
          <span className="chip">収入は手取り入力</span>
          <span className="chip">月次計算</span>
        </Link>
        <SaveStatus />
      </header>
      <nav className="nav" aria-label="メインメニュー">
        <ul>
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
